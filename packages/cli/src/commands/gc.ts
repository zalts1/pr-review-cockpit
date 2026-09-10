import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PrRef } from '@review-cockpit/analyzer';
import { cacheRoot, cloneDir, git, prRefName, readDocument, worktreeHost } from '@review-cockpit/analyzer';
import { cachedPrs, hasLiveServer, target } from '../servers.js';

/** A week is longer than any review stays interesting and shorter than a laptop's disk lasts. */
export const GC_DEFAULT_DAYS = 7;

const DOCUMENT = 'review.json';
const WORKTREE = 'worktree';

export interface GcOptions {
  days: number;
  dryRun: boolean;
  root?: string;
}

export interface GcRemoval {
  target: string;
  ageDays: number;
  worktree: string | null;
  gitRef: string | null;
}

export interface GcResult {
  removed: GcRemoval[];
  /** One line per removal, in the order they happened. */
  lines: string[];
  summary: string;
}

/**
 * Removes what a review can regenerate in seconds and nothing else. The worktree and the
 * `refs/review-cockpit/` ref are a checkout of a commit GitHub still has; `review.json`, the
 * drafts and the posted reviews are the only things here that cannot be made again.
 */
export function collectGarbage(options: GcOptions): GcResult {
  const cutoff = Date.now() - options.days * 86_400_000;
  const removed: GcRemoval[] = [];
  const lines: string[] = [];
  let live = 0;
  let recent = 0;
  let empty = 0;

  for (const pr of cachedPrs(options.root ?? cacheRoot())) {
    const worktree = join(pr.dir, WORKTREE);
    if (!existsSync(worktree) && !existsSync(join(pr.dir, DOCUMENT))) {
      empty += 1;
      continue;
    }

    if (hasLiveServer(pr.dir)) {
      live += 1;
      continue;
    }

    const touched = lastTouched(pr.dir);
    if (touched > cutoff) {
      recent += 1;
      continue;
    }

    // Reading the document to find its clone is the expensive step, so it waits until the
    // pull request has already earned collection.
    const host = hostOf(pr.ref, pr.dir);
    const hasRef = git(host, ['rev-parse', '--verify', '--quiet', prRefName(pr.ref)]).code === 0;
    if (!existsSync(worktree) && !hasRef) {
      empty += 1;
      continue;
    }

    const ageDays = Math.floor((Date.now() - touched) / 86_400_000);
    const removal: GcRemoval = {
      target: target(pr.ref),
      ageDays,
      worktree: existsSync(worktree) ? worktree : null,
      gitRef: hasRef ? prRefName(pr.ref) : null,
    };

    if (!options.dryRun) {
      if (removal.worktree !== null) removeWorktree(host, worktree);
      if (removal.gitRef !== null) git(host, ['update-ref', '-d', prRefName(pr.ref)]);
    }

    removed.push(removal);
    lines.push(describe(removal, options.dryRun, host));
  }

  const kept = [
    live === 1 ? '1 in use' : live > 1 ? `${live} in use` : null,
    recent > 0 ? `${recent} newer than ${options.days} days` : null,
    empty > 0 ? `${empty} already collected` : null,
  ].filter((part): part is string => part !== null);

  const verb = options.dryRun ? 'would collect' : 'collected';
  const summary =
    removed.length === 0
      ? `nothing to collect${kept.length === 0 ? '' : ` (${kept.join(', ')})`}`
      : `${verb} ${removed.length} checkout${removed.length === 1 ? '' : 's'}${kept.length === 0 ? '' : `, kept ${kept.join(', ')}`}`;

  return { removed, lines, summary };
}

export function gcCommand(options: GcOptions): number {
  const result = collectGarbage(options);
  for (const line of result.lines) console.log(line);
  console.log(`[gc] ${result.summary}`);
  if (options.dryRun && result.removed.length > 0) {
    console.log('[gc] nothing was removed: drop --dry-run to do it');
  }
  return 0;
}

function describe(removal: GcRemoval, dryRun: boolean, host: string): string {
  const parts = [
    removal.worktree === null ? null : 'worktree',
    removal.gitRef === null ? null : `${removal.gitRef} in ${host}`,
  ].filter((part): part is string => part !== null);
  return `[gc] ${dryRun ? 'would remove' : 'removed'} ${parts.join(' and ')} for ${removal.target}, last used ${removal.ageDays} days ago`;
}

/**
 * Only this pull request's own worktree path is ever named, and `git worktree prune` is never
 * run: prune would drop registrations belonging to other tools in the same clone.
 */
function removeWorktree(host: string, worktree: string): void {
  git(host, ['worktree', 'remove', '--force', worktree]);
  rmSync(worktree, { recursive: true, force: true });
}

function hostOf(ref: PrRef, dir: string): string {
  const document = join(dir, DOCUMENT);
  if (!existsSync(document)) return cloneDir(ref);
  try {
    return worktreeHost(readDocument(document).checkout, ref);
  } catch {
    return cloneDir(ref);
  }
}

/**
 * The document's own mtime is the age of the review: `cockpit run` rewrites it on every
 * analysis, and the server rewrites it after a post.
 */
function lastTouched(dir: string): number {
  return mtimeOf(join(dir, DOCUMENT)) ?? mtimeOf(dir) ?? 0;
}

function mtimeOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}
