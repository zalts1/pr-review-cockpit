import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import type { PrRef } from '@review-cockpit/analyzer';
import {
  documentFile,
  historyFile,
  judgmentFile,
  nowIso,
  prDir,
  readDocument,
  resolveRef,
  status,
  writeDocument,
} from '@review-cockpit/analyzer';
import type { ReviewDocument } from '@review-cockpit/schema';
import { readServerFile, serverIsAlive } from '@review-cockpit/server';
import type { HeadlessProgress } from '../headless.js';
import { applyEvent, judgmentFromText, newProgress, progressLine } from '../headless.js';
import { estimate, formatDuration, readHistory } from '../history.js';
import { buildPrompt } from '../prompt.js';
import { applyJudgment, printRejection } from './judgeMerge.js';

export const DEFAULT_TIMEOUT_MINUTES = 20;

/** How often the progress line is rewritten while nothing new has happened. */
const TICK_MS = 1000;

/** A pipe gets one line per change instead of a rewritten line, and not more often than this. */
const PLAIN_LINE_MS = 15_000;

/**
 * Read-only tools plus the one write the pass exists to make. Claude Code's permission rules
 * match a Bash command by prefix, and the trailing space before the star is what makes
 * `git diff *` a prefix rather than also matching `git diff-index`.
 */
export function allowedTools(judgmentPath: string): string[] {
  return [
    'Read',
    'Grep',
    'Glob',
    'Bash(git log *)',
    'Bash(git show *)',
    'Bash(git diff *)',
    'Bash(git blame *)',
    'Bash(git status *)',
    'Bash(cat *)',
    `Write(//${judgmentPath.replace(/^\/+/, '')})`,
  ];
}

const HEADLESS_POSTSCRIPT = `
## You are running headless

Nothing about this run is interactive, and no one is reading your prose. Do not run
\`cockpit judge-merge\`: the command that started you runs the merge itself the moment you stop.
Write the judgment file and stop.

If writing the file is refused, make the JSON your whole final message, with no fence around it
and no commentary before or after it, and the command writes it for you.
`;

export interface JudgeFlags {
  cwd: string;
  headless: boolean;
  model?: string;
  timeoutMinutes?: number;
}

export interface JudgeDeps {
  /** Injected in tests, which must never spawn a model. */
  invoke(options: InvokeOptions): Promise<InvokeOutcome>;
  now(): number;
}

export interface InvokeOptions {
  prompt: string;
  cwd: string;
  addDir: string;
  judgmentPath: string;
  model?: string;
  timeoutMs: number;
  onProgress(state: HeadlessProgress): void;
}

export interface InvokeOutcome {
  state: HeadlessProgress;
  code: number | null;
  timedOut: boolean;
}

export function judgeCommand(
  prArg: string,
  flags: JudgeFlags,
  deps: JudgeDeps = { invoke: invokeClaude, now: Date.now },
): Promise<number> {
  const ref = resolveRef(prArg, flags.cwd);
  const document = documentFile(ref);
  if (!existsSync(document)) {
    console.error(`no review document at ${document}. Run cockpit run ${prArg} first.`);
    return Promise.resolve(1);
  }

  const doc = readDocument(document);
  const prompt = buildPrompt(doc, { documentPath: document, judgmentPath: judgmentFile(ref) });

  if (!flags.headless) {
    process.stdout.write(prompt);
    return Promise.resolve(0);
  }
  return runHeadless(ref, prArg, doc, prompt, flags, deps);
}

function hunkCount(document: ReviewDocument): number {
  return document.files.reduce((total, file) => total + file.hunks.length, 0);
}

async function runHeadless(
  ref: PrRef,
  prArg: string,
  document: ReviewDocument,
  prompt: string,
  flags: JudgeFlags,
  deps: JudgeDeps,
): Promise<number> {
  const judgmentPath = judgmentFile(ref);
  const checkout = document.checkout.path;
  if (!existsSync(checkout)) {
    console.error(
      `the checkout at ${checkout} is gone, so the pass has no code to read. Run cockpit run ${prArg} first.`,
    );
    return 1;
  }

  const hunks = hunkCount(document);
  const expected = estimate(readHistory(historyFile(ref)), hunks);
  const started = deps.now();
  const timeoutMs = (flags.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) * 60_000;
  const render = progressRenderer(expected?.judgmentSeconds ?? null, () => deps.now() - started);

  console.error(
    `[judge] headless on ${ref.owner}/${ref.repo}#${ref.number}: ${hunks} hunks, ` +
      `${expected === null ? 'no estimate yet' : `~${formatDuration(expected.judgmentSeconds)}`}`,
  );

  let outcome = await deps.invoke({
    prompt: `${prompt}\n${HEADLESS_POSTSCRIPT}`,
    cwd: checkout,
    addDir: prDir(ref),
    judgmentPath,
    timeoutMs,
    onProgress: render.update,
    ...(flags.model === undefined ? {} : { model: flags.model }),
  });

  let merged = settle(ref, judgmentPath, outcome);
  if (!merged.ok && merged.errors.length > 0) {
    render.finish(`judgment · rejected, retrying once`);
    printRejection(merged, prArg, judgmentPath);
    outcome = await deps.invoke({
      prompt: `${prompt}\n${HEADLESS_POSTSCRIPT}\n${retryNote(merged.errors)}`,
      cwd: checkout,
      addDir: prDir(ref),
      judgmentPath,
      timeoutMs,
      onProgress: render.update,
      ...(flags.model === undefined ? {} : { model: flags.model }),
    });
    merged = settle(ref, judgmentPath, outcome);
  }

  const durationSeconds = Math.round((deps.now() - started) / 1000);

  if (!merged.ok) {
    render.finish(`judgment · failed after ${formatDuration(durationSeconds)}`);
    printRejection(merged, prArg, judgmentPath);
    markStage2Failed(ref, headlineFor(merged.errors, outcome));
    report('failed', durationSeconds, ref);
    return 1;
  }

  render.finish(`judgment · ready in ${formatDuration(durationSeconds)} · ${merged.summary}`);
  report('ready', durationSeconds, ref);
  return 0;
}

function settle(
  ref: PrRef,
  judgmentPath: string,
  outcome: InvokeOutcome,
): ReturnType<typeof applyJudgment> {
  rescueJudgment(judgmentPath, outcome.state);
  return applyJudgment(ref, judgmentPath);
}

/** A run whose Write was refused still holds the answer in its last message. */
function rescueJudgment(judgmentPath: string, state: HeadlessProgress): void {
  if (existsSync(judgmentPath)) return;
  const json = judgmentFromText(state.finalText);
  if (json === null) return;
  writeFileSync(judgmentPath, `${json}\n`, 'utf8');
  console.error(`[judge] the pass could not write the file, so its final message was written to ${judgmentPath}`);
}

function retryNote(errors: string[]): string {
  return [
    '## Your first attempt was rejected',
    '',
    'The merge rejected the file you wrote. Fix exactly these and write it again:',
    '',
    ...errors.map((message) => `- ${message}`),
  ].join('\n');
}

function headlineFor(errors: string[], outcome: InvokeOutcome): string {
  if (errors.length > 0) return `the judgment pass was rejected twice: ${errors[0]}`;
  if (outcome.timedOut) return 'the headless judgment pass ran out of time';
  if (outcome.state.error !== null) return `the headless judgment pass failed: ${outcome.state.error}`;
  return 'the headless judgment pass wrote no judgment file';
}

function markStage2Failed(ref: PrRef, message: string): void {
  const file = documentFile(ref);
  if (!existsSync(file)) return;
  const document = readDocument(file);
  const failed = status('failed', nowIso(), message.slice(0, 300));
  for (const section of ['groups', 'path', 'summary'] as const) document.status[section] = failed;
  writeDocument(file, document);
  console.error(`[judge] stage 2 marked failed: ${message}`);
}

function report(state: 'ready' | 'failed', durationSeconds: number, ref: PrRef): void {
  const server = readServerFile(prDir(ref));
  const url = server !== null && serverIsAlive(server) ? server.url : null;
  console.log(JSON.stringify({ status: state, durationSeconds, url }));
}

interface Renderer {
  update(state: HeadlessProgress): void;
  finish(line: string): void;
}

/** A terminal gets one line rewritten in place; a pipe or a log gets a new line now and then. */
export function progressRenderer(
  estimateSeconds: number | null,
  elapsedMs: () => number,
  stream: NodeJS.WriteStream = process.stderr,
): Renderer {
  const tty = stream.isTTY === true;
  let last = '';
  let lastWrittenAt = 0;
  let timer: NodeJS.Timeout | null = null;

  const write = (state: HeadlessProgress, force: boolean): void => {
    const line = progressLine(state, elapsedMs() / 1000, estimateSeconds);
    if (tty) {
      stream.write(`\r[2K${line}`);
      last = line;
      return;
    }
    const sameShape = line.replace(/\d+m?\d*s/g, '') === last.replace(/\d+m?\d*s/g, '');
    if (!force && sameShape && elapsedMs() - lastWrittenAt < PLAIN_LINE_MS) return;
    stream.write(`${line}\n`);
    last = line;
    lastWrittenAt = elapsedMs();
  };

  return {
    update(state) {
      write(state, false);
      if (timer !== null) clearTimeout(timer);
      if (state.done || !tty) return;
      timer = setTimeout(() => write(state, false), TICK_MS);
      timer.unref();
    },
    finish(line) {
      if (timer !== null) clearTimeout(timer);
      stream.write(tty ? `\r[2K${line}\n` : `${line}\n`);
    },
  };
}

export const CLAUDE_BIN = process.env['REVIEW_COCKPIT_CLAUDE'] ?? 'claude';

export function claudeArgs(options: InvokeOptions): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'dontAsk',
    '--add-dir',
    options.addDir,
    '--allowedTools',
    allowedTools(options.judgmentPath).join(','),
    ...(options.model === undefined ? [] : ['--model', options.model]),
  ];
}

export function invokeClaude(options: InvokeOptions): Promise<InvokeOutcome> {
  return new Promise((settled) => {
    const state = newProgress();
    const child = spawn(CLAUDE_BIN, claudeArgs(options), {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'review-cockpit' },
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);
    timer.unref();

    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line !== '') {
          try {
            applyEvent(state, JSON.parse(line), options.judgmentPath);
          } catch {
            // A line that is not an event is claude's own noise, not a reason to stop.
          }
          options.onProgress(state);
        }
        newline = buffer.indexOf('\n');
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      state.error = `${CLAUDE_BIN} could not be started: ${error.message}`;
      state.isError = true;
      settled({ state, code: null, timedOut });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) state.error = 'the run was stopped when it ran out of time';
      settled({ state, code, timedOut });
    });

    child.stdin.end(options.prompt);
  });
}
