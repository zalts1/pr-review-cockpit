import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
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
 * Reading only. A `Write` allow rule for an absolute path outside the working directory is
 * refused in a `-p` run whatever the permission mode, so the pass returns its judgment as its
 * final message and this command writes the file. Claude Code matches a Bash rule by prefix,
 * and the space before the star is what keeps `git diff *` from also matching `git diff-index`.
 */
export const ALLOWED_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Bash(git log *)',
  'Bash(git show *)',
  'Bash(git diff *)',
  'Bash(git blame *)',
  'Bash(git status *)',
  'Bash(cat *)',
] as const;

const HEADLESS_POSTSCRIPT = `
## You are running headless, and this section wins

This run is not interactive and nobody reads prose from it. Two instructions above do not hold
here, and this section replaces them:

- **Do not write any file.** You cannot: every write is refused. Return the judgment as your
  **whole final message** — the JSON object and nothing else, no fence around it and no sentence
  before or after it. The command that started you writes it to the judgment path and merges it.
- **Do not run \`cockpit judge-merge\`,** or any other command that changes anything. That
  command runs by itself the moment you stop.

Read the code first, exactly as the sections above tell you to. Only the last step changed.
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

/**
 * The pass writes nothing, so the file on disk is always this run's final message. A judgment an
 * earlier run left behind is removed rather than merged, which would pass off stale work as new.
 */
function settle(
  ref: PrRef,
  judgmentPath: string,
  outcome: InvokeOutcome,
): ReturnType<typeof applyJudgment> {
  rmSync(judgmentPath, { force: true });
  const json = judgmentFromText(outcome.state.finalText);
  if (json !== null) writeFileSync(judgmentPath, `${json}\n`, 'utf8');
  return applyJudgment(ref, judgmentPath);
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
  return 'the headless judgment pass returned no judgment';
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
    '--allowedTools',
    ALLOWED_TOOLS.join(','),
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
