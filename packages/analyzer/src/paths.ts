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

/** Per repository, not per pull request: the estimate is only useful across reviews. */
export function historyFile(ref: PrRef): string {
  return join(repoCacheDir(ref), 'history.json');
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

export function compactFile(ref: PrRef): string {
  return join(prDir(ref), 'compact.md');
}

export function judgmentFile(ref: PrRef): string {
  return join(prDir(ref), 'judgment.json');
}

export function rejectedJudgmentFile(ref: PrRef): string {
  return join(prDir(ref), 'judgment.rejected.json');
}

export function draftsFile(ref: PrRef): string {
  return join(prDir(ref), 'drafts.json');
}

export function orphanedDraftsFile(ref: PrRef): string {
  return join(prDir(ref), 'drafts.orphaned.json');
}

export function serverFile(ref: PrRef): string {
  return join(prDir(ref), 'server.json');
}

/** What the last `cockpit run` measured, so judge-merge can time the judgment against it. */
export function runFile(ref: PrRef): string {
  return join(prDir(ref), 'run.json');
}

export function openedFile(ref: PrRef): string {
  return join(prDir(ref), 'opened.json');
}

export function logFile(ref: PrRef): string {
  return join(prDir(ref), 'log.txt');
}

export function prRefName(ref: PrRef): string {
  return `refs/review-cockpit/pr-${ref.number}`;
}
