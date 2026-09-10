import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AnalyzeOptions, AnalyzeResult, PrRef } from '@review-cockpit/analyzer';
import {
  analyze,
  compactFile,
  documentFile,
  judgmentFile,
  logFile,
  prDir,
  prepare,
  readDocument,
  resolvePr,
  run as execute,
  worktreeDir,
} from '@review-cockpit/analyzer';
import { readServerFile, serverIsAlive } from '@review-cockpit/server';
import { progress } from '../progress.js';

export interface RunFlags {
  cwd: string;
  reuseServer: boolean;
  open: boolean;
  skipGraph: boolean;
  port?: number;
  idleMinutes?: number;
  sessionId?: string;
}

/** What the detached `cockpit serve` is started with. */
export interface ServeSpawn {
  port?: number;
  idleMinutes?: number;
  sessionId?: string;
}

export interface ServeOutcome {
  url: string;
  port: number;
  pid: number;
  /** False when a server was already up for this pull request and was used as it is. */
  started: boolean;
}

/** Injected whole in tests, so `run` is exercised without gh, git or a real server. */
export interface RunDeps {
  resolve(prArg: string, cwd: string): { ref: PrRef; headSha: string; title: string };
  cachedHead(ref: PrRef): string | null;
  restoreCheckout(prArg: string, cwd: string, step: (message: string) => void): void;
  analyze(options: AnalyzeOptions): Promise<AnalyzeResult>;
  serve(ref: PrRef, spawn: ServeSpawn): Promise<ServeOutcome>;
  open(url: string): void;
}

export const CLI_ENTRY = fileURLToPath(new URL('../cockpit.js', import.meta.url));

export function targetOf(ref: PrRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

const defaults: RunDeps = {
  resolve(prArg, cwd) {
    const resolved = resolvePr(prArg, cwd);
    return { ref: resolved.ref, headSha: resolved.pr.head.sha, title: resolved.pr.title };
  },
  cachedHead(ref) {
    const file = documentFile(ref);
    if (!existsSync(file)) return null;
    try {
      return readDocument(file).pr.head.sha;
    } catch {
      return null;
    }
  },
  restoreCheckout(prArg, cwd, step) {
    prepare(prArg, cwd, step);
  },
  analyze,
  serve: startDetachedServer,
  open(url) {
    execute('open', [url]);
  },
};

/**
 * The server has to outlive this process: the resident session runs `cockpit run`, gets its
 * JSON back, and then works in the same terminal. So the server is a detached `cockpit serve`
 * whose own server.json is the handshake, rather than an http server in this process.
 */
export async function startDetachedServer(ref: PrRef, spawnWith: ServeSpawn): Promise<ServeOutcome> {
  const directory = prDir(ref);
  const existing = readServerFile(directory);
  if (existing !== null && serverIsAlive(existing)) {
    return { url: existing.url, port: existing.port, pid: existing.pid, started: false };
  }

  mkdirSync(directory, { recursive: true });
  const log = openSync(logFile(ref), 'a');
  const child = spawn(
    process.execPath,
    [
      CLI_ENTRY,
      'serve',
      targetOf(ref),
      ...(spawnWith.port === undefined ? [] : ['--port', String(spawnWith.port)]),
      ...(spawnWith.idleMinutes === undefined ? [] : ['--idle-minutes', String(spawnWith.idleMinutes)]),
      ...(spawnWith.sessionId === undefined ? [] : ['--session', spawnWith.sessionId]),
    ],
    { detached: true, stdio: ['ignore', log, log] },
  );
  child.unref();

  const pid = child.pid;
  if (pid === undefined) throw new Error('the server process could not be started');

  const deadline = Date.now() + 15_000;
  for (;;) {
    const file = readServerFile(directory);
    if (file !== null && file.pid === pid && (await answers(file.url))) {
      return { url: file.url, port: file.port, pid, started: true };
    }
    if (child.exitCode !== null) {
      throw new Error(
        `the server exited with code ${child.exitCode} before it answered. Its output is in ${logFile(ref)}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(`the server did not answer within 15 seconds. Its output is in ${logFile(ref)}`);
    }
    await new Promise((wake) => setTimeout(wake, 100));
  }
}

async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function runCommand(
  prArg: string,
  flags: RunFlags,
  deps: RunDeps = defaults,
): Promise<number> {
  const step = progress('run');

  const { ref, headSha, title } = deps.resolve(prArg, flags.cwd);
  const target = targetOf(ref);
  step(`${target} at ${headSha.slice(0, 12)}: "${title}"`);

  const cached = deps.cachedHead(ref);
  const analyzed = cached !== headSha;

  const box: { served: ServeOutcome | null } = { served: null };
  const serveAndOpen = async (): Promise<void> => {
    const served = await deps.serve(ref, {
      ...(flags.port === undefined ? {} : { port: flags.port }),
      ...(flags.idleMinutes === undefined ? {} : { idleMinutes: flags.idleMinutes }),
      ...(flags.sessionId === undefined ? {} : { sessionId: flags.sessionId }),
    });
    box.served = served;
    step(
      served.started
        ? `serving ${served.url} (pid ${served.pid})`
        : `reusing the server already on ${served.url} (pid ${served.pid})`,
    );
    if (!flags.open) return;
    if (!served.started && flags.reuseServer) {
      step('browser not opened: the tab on the running server is already showing this pull request');
      return;
    }
    deps.open(served.url);
    step('browser opened');
  };

  if (analyzed) {
    await deps.analyze({
      prArg,
      cwd: flags.cwd,
      expectJudgment: true,
      skipGraph: flags.skipGraph,
      onProgress: step,
      onStage1: async (handoff) => {
        const hunks = handoff.document.files.reduce((total, file) => total + file.hunks.length, 0);
        step(`stage 1 ready: ${handoff.document.files.length} files, ${hunks} hunks (${handoff.stage1Ms} ms)`);
        await serveAndOpen();
      },
    });
  } else {
    step('cached document at this head: no analysis, serving what is on disk');
    if (!existsSync(worktreeDir(ref))) {
      step('the checkout is gone, so it is made again; the document is kept');
      deps.restoreCheckout(prArg, flags.cwd, step);
    }
    await serveAndOpen();
  }

  if (box.served === null) throw new Error('stage 1 finished without starting a server');
  const { url } = box.served;

  console.error(`Cockpit: ${url}`);
  console.log(
    JSON.stringify({
      url,
      prDir: prDir(ref),
      compact: compactFile(ref),
      judgmentOut: judgmentFile(ref),
      headSha,
    }),
  );
  return 0;
}
