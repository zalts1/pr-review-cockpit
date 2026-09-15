import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { openedFile, prDir, resolveRef, run } from '@review-cockpit/analyzer';
import type { PrRef } from '@review-cockpit/analyzer';
import { readServerFile, serverIsAlive } from '@review-cockpit/server';

export interface OpenFlags {
  cwd: string;
  force: boolean;
}

export interface OpenDeps {
  open(url: string): void;
}

const defaults: OpenDeps = {
  open(url) {
    run('open', [url]);
  },
};

interface OpenedMarker {
  pid: number;
  url: string;
  at: string;
}

function readMarker(file: string): OpenedMarker | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<OpenedMarker>;
    if (typeof parsed.pid !== 'number' || typeof parsed.url !== 'string') return null;
    return { pid: parsed.pid, url: parsed.url, at: parsed.at ?? '' };
  } catch {
    return null;
  }
}

/**
 * Records which server's tab is already open, so calling `cockpit open` again — which the skill
 * does on a re-analysis — does not put a second tab on the same cockpit.
 */
export function markOpened(ref: PrRef, url: string, pid: number): void {
  const file = openedFile(ref);
  mkdirSync(prDir(ref), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ pid, url, at: new Date().toISOString() }, null, 2)}\n`, 'utf8');
}

export function openCommand(prArg: string, flags: OpenFlags, deps: OpenDeps = defaults): number {
  const ref = resolveRef(prArg, flags.cwd);
  const target = `${ref.owner}/${ref.repo}#${ref.number}`;
  const server = readServerFile(prDir(ref));

  if (server === null || !serverIsAlive(server)) {
    console.error(`no cockpit server is running for ${target}. Run cockpit run ${prArg} first.`);
    return 1;
  }

  const marker = readMarker(openedFile(ref));
  if (!flags.force && marker !== null && marker.pid === server.pid && marker.url === server.url) {
    console.error(`[open] ${target} is already open at ${server.url}`);
    console.log(server.url);
    return 0;
  }

  deps.open(server.url);
  markOpened(ref, server.url, server.pid);
  console.error(`[open] ${target} at ${server.url}`);
  console.log(server.url);
  return 0;
}
