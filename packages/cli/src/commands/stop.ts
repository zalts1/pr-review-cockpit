import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { PrRef } from '@review-cockpit/analyzer';
import { cacheRoot } from '@review-cockpit/analyzer';
import { pidIsAlive, SERVER_FILENAME } from '@review-cockpit/server';
import type { RecordedServer } from '../servers.js';
import { identify, recordedServers, target } from '../servers.js';

/** Long enough for a server to answer SIGTERM, short enough for the SessionEnd hook budget. */
const EXIT_MS = 600;
const POLL_MS = 25;

export type StopSelector =
  | { kind: 'pr'; ref: PrRef }
  | { kind: 'all' }
  | { kind: 'session'; sessionId: string };

export interface StopOptions {
  selector: StopSelector;
  root?: string;
}

export interface StopOutcome {
  target: string;
  /** `foreign` is a pid nothing proves is ours, and the one case where nothing is touched. */
  action: 'stopped' | 'still-running' | 'stale' | 'foreign';
  detail: string;
}

export async function stopServers(options: StopOptions): Promise<StopOutcome[]> {
  const candidates = recordedServers(options.root ?? cacheRoot()).filter((server) =>
    selected(server, options.selector),
  );
  return Promise.all(candidates.map((server) => stopOne(server)));
}

export async function stopCommand(options: StopOptions): Promise<number> {
  const outcomes = await stopServers(options);
  for (const outcome of outcomes) console.error(`[stop] ${outcome.target}: ${outcome.detail}`);

  const stopped = outcomes.filter((outcome) => outcome.action === 'stopped').length;
  console.error(
    outcomes.length === 0
      ? `[stop] no server was recorded for ${describe(options.selector)}`
      : `[stop] stopped ${stopped} of ${outcomes.length} recorded server${outcomes.length === 1 ? '' : 's'}`,
  );
  return 0;
}

function describe(selector: StopSelector): string {
  if (selector.kind === 'all') return 'any pull request';
  if (selector.kind === 'session') return `session ${selector.sessionId}`;
  return target(selector.ref);
}

function selected(server: RecordedServer, selector: StopSelector): boolean {
  if (selector.kind === 'all') return true;
  if (selector.kind === 'session') return server.file.sessionId === selector.sessionId;
  const { ref } = selector;
  return (
    server.ref.owner === ref.owner && server.ref.repo === ref.repo && server.ref.number === ref.number
  );
}

async function stopOne(server: RecordedServer): Promise<StopOutcome> {
  const name = target(server.ref);
  const identity = await identify(server.file);

  if (identity === 'gone') {
    rmSync(join(server.dir, SERVER_FILENAME), { force: true });
    return {
      target: name,
      action: 'stale',
      detail: `pid ${server.file.pid} is gone, so its server.json was removed`,
    };
  }

  if (identity === 'foreign') {
    return {
      target: name,
      action: 'foreign',
      detail: `pid ${server.file.pid} is alive but is not this cockpit server, so it was left alone`,
    };
  }

  try {
    process.kill(server.file.pid, 'SIGTERM');
  } catch (error) {
    return {
      target: name,
      action: 'still-running',
      detail: `pid ${server.file.pid} could not be signalled: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const gone = await waitForExit(server.file.pid);
  if (!gone) {
    return {
      target: name,
      action: 'still-running',
      detail: `pid ${server.file.pid} was asked to stop and had not yet by ${EXIT_MS} ms`,
    };
  }

  rmSync(join(server.dir, SERVER_FILENAME), { force: true });
  return {
    target: name,
    action: 'stopped',
    detail: `stopped the server on port ${server.file.port} (pid ${server.file.pid})`,
  };
}

async function waitForExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + EXIT_MS;
  for (;;) {
    if (!pidIsAlive(pid)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((wake) => setTimeout(wake, POLL_MS));
  }
}
