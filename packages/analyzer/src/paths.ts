import { homedir } from 'node:os';
import { join } from 'node:path';

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export function cacheRoot(): string {
  return process.env.REVIEW_COCKPIT_CACHE ?? join(homedir(), '.cache', 'review-cockpit');
}

export function configFile(): string {
  return process.env.REVIEW_COCKPIT_CONFIG ?? join(homedir(), '.config', 'review-cockpit', 'config.json');
}

export function repoCacheDir(ref: PrRef): string {
  return join(cacheRoot(), ref.owner, ref.repo);
}

export function cloneDir(ref: PrRef): string {
  return join(repoCacheDir(ref), 'repo');
}

export function indexDir(ref: PrRef): string {
  return join(repoCacheDir(ref), 'index');
}

export function prDir(ref: PrRef): string {
  return join(repoCacheDir(ref), `pr-${ref.number}`);
}

export function worktreeDir(ref: PrRef): string {
  return join(prDir(ref), 'worktree');
}

export function documentFile(ref: PrRef): string {
  return join(prDir(ref), 'review.json');
}

export function serverFile(ref: PrRef): string {
  return join(prDir(ref), 'server.json');
}

export function logFile(ref: PrRef): string {
  return join(prDir(ref), 'log.txt');
}

export function prRefName(ref: PrRef): string {
  return `refs/review-cockpit/pr-${ref.number}`;
}
