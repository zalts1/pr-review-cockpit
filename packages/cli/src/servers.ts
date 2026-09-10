import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PrRef } from '@review-cockpit/analyzer';
import { cacheRoot, run } from '@review-cockpit/analyzer';
import type { ServerFile } from '@review-cockpit/server';
import { readServerFile, serverIsAlive } from '@review-cockpit/server';

/** A server that does not answer this fast is treated as wedged, not as absent. */
const PROBE_MS = 400;

export interface CachedPr {
  ref: PrRef;
  dir: string;
}

export interface RecordedServer extends CachedPr {
  file: ServerFile;
}

export interface Health {
  clients: number;
  idleSeconds: number;
}

/**
 * `cockpit … serve` is what the server's own command line looks like. Trusted only when the
 * server cannot answer for itself: a name is weaker evidence than a token it wrote and served.
 */
const COCKPIT_COMMAND = /cockpit(?:\.js)?\b[^\n]*\bserve\b/;

export type Identity =
  /** The pid is alive and proved it is this server.json's server. */
  | 'cockpit'
  /** The pid is alive and nothing says it is ours, so it is left alone. */
  | 'foreign'
  /** No such process: the server.json outlived its server. */
  | 'gone';

/** Every `<owner>/<repo>/pr-<n>` directory in the cache, whether a server ever ran for it. */
export function cachedPrs(root: string = cacheRoot()): CachedPr[] {
  const found: CachedPr[] = [];
  for (const owner of directories(root)) {
    for (const repo of directories(join(root, owner))) {
      for (const entry of directories(join(root, owner, repo))) {
        const number = Number(/^pr-(\d+)$/.exec(entry)?.[1] ?? 0);
        if (!Number.isInteger(number) || number <= 0) continue;
        found.push({ ref: { owner, repo, number }, dir: join(root, owner, repo, entry) });
      }
    }
  }
  return found.sort((left, right) => target(left.ref).localeCompare(target(right.ref)));
}

export function recordedServers(root: string = cacheRoot()): RecordedServer[] {
  const found: RecordedServer[] = [];
  for (const pr of cachedPrs(root)) {
    const file = readServerFile(pr.dir);
    if (file !== null) found.push({ ...pr, file });
  }
  return found;
}

export function target(ref: PrRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

/**
 * The token in `server.json` is also what `/api/health` answers with, so a match proves the
 * process listening on that port is the one that wrote the file — which a pid cannot, because
 * pids are reused and a stale file would otherwise name an unrelated process.
 */
export async function identify(file: ServerFile): Promise<Identity> {
  if (!serverIsAlive(file)) return 'gone';

  const health = await probe(file.url);
  if (health !== null && file.token !== '' && health.token === file.token) return 'cockpit';

  return isCockpitProcess(file.pid) ? 'cockpit' : 'foreign';
}

/** The identity check for a caller that cannot await a probe. Weaker: it trusts the name only. */
export function isCockpitProcess(pid: number): boolean {
  return COCKPIT_COMMAND.test(commandLineOf(pid));
}

export function hasLiveServer(dir: string): boolean {
  const file = readServerFile(dir);
  if (file === null || !serverIsAlive(file)) return false;
  return isCockpitProcess(file.pid);
}

export async function healthOf(url: string): Promise<Health | null> {
  const health = await probe(url);
  if (health === null) return null;
  return {
    clients: typeof health.clients === 'number' ? health.clients : 0,
    idleSeconds: typeof health.idleSeconds === 'number' ? health.idleSeconds : 0,
  };
}

export function commandLineOf(pid: number): string {
  return run('ps', ['-p', String(pid), '-o', 'command=']).stdout.trim();
}

interface HealthBody {
  token?: unknown;
  clients?: unknown;
  idleSeconds?: unknown;
}

async function probe(url: string): Promise<HealthBody | null> {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(PROBE_MS) });
    if (!response.ok) return null;
    return (await response.json()) as HealthBody;
  } catch {
    return null;
  }
}

function directories(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
