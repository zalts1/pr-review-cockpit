import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckoutInfo } from '@review-cockpit/schema';
import { CommandFailed, git, gitOk, run } from './exec.js';
import type { PrRef } from './paths.js';
import { cloneDir, prDir, prRefName, worktreeDir } from './paths.js';
import { githubRemote, repoRoot } from './resolve.js';

export interface CheckoutOptions {
  ref: PrRef;
  headSha: string;
  baseSha: string;
  baseRef: string;
  cwd: string;
  workspaceRoots?: readonly string[];
  onProgress?: (message: string) => void;
}

function sameRepo(a: { owner: string; repo: string }, b: PrRef): boolean {
  return a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase();
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function findLocalClone(
  ref: PrRef,
  cwd: string,
  workspaceRoots: readonly string[] = [],
): string | null {
  const root = repoRoot(cwd);
  if (root !== null) {
    const remote = githubRemote(root);
    if (remote && sameRepo(remote, ref)) return root;
  }

  for (const workspaceRoot of workspaceRoots) {
    let entries: string[];
    try {
      entries = readdirSync(workspaceRoot);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const candidate = join(workspaceRoot, entry);
      if (!existsSync(join(candidate, '.git'))) continue;
      const remote = githubRemote(candidate);
      if (remote && sameRepo(remote, ref)) return candidate;
    }
  }

  return null;
}

function hasCommit(repo: string, sha: string): boolean {
  return git(repo, ['cat-file', '-e', `${sha}^{commit}`]).code === 0;
}

function fetchPrHead(repo: string, ref: PrRef, headSha: string, baseSha: string, baseRef: string): void {
  const refName = prRefName(ref);
  const fetch = git(repo, [
    'fetch',
    '--quiet',
    'origin',
    `+refs/pull/${ref.number}/head:${refName}`,
  ]);
  if (fetch.code !== 0 && !hasCommit(repo, headSha)) {
    const direct = git(repo, ['fetch', '--quiet', 'origin', headSha]);
    if (direct.code !== 0) {
      throw new Error(
        `could not fetch the head of pull request ${ref.number} into ${repo}: ${fetch.stderr.trim() || direct.stderr.trim()}`,
      );
    }
  }

  if (hasCommit(repo, baseSha)) return;
  if (git(repo, ['fetch', '--quiet', 'origin', baseSha]).code === 0) return;
  git(repo, ['fetch', '--quiet', 'origin', `+refs/heads/${baseRef}:refs/remotes/origin/${baseRef}`]);
}

function addWorktree(repo: string, ref: PrRef, headSha: string): string {
  const path = worktreeDir(ref);
  mkdirSync(prDir(ref), { recursive: true });

  if (existsSync(path)) {
    const head = git(path, ['rev-parse', 'HEAD']);
    if (head.code === 0 && head.stdout.trim() === headSha) return path;
    git(repo, ['worktree', 'remove', '--force', path]);
    rmSync(path, { recursive: true, force: true });
  }

  try {
    gitOk(repo, ['worktree', 'add', '--detach', path, headSha]);
  } catch (error) {
    if (!(error instanceof CommandFailed)) throw error;
    // Only reachable when our own path is registered without a directory, and
    // prune is the only way out. It also drops other stale registrations.
    git(repo, ['worktree', 'prune']);
    rmSync(path, { recursive: true, force: true });
    gitOk(repo, ['worktree', 'add', '--detach', path, headSha]);
  }
  return path;
}

function cloneIntoCache(ref: PrRef, onProgress?: (message: string) => void): string {
  const target = cloneDir(ref);
  if (isDirectory(join(target, '.git'))) {
    onProgress?.(`reusing the cached clone at ${target}`);
    return target;
  }

  mkdirSync(join(target, '..'), { recursive: true });
  onProgress?.(`no local clone found, cloning ${ref.owner}/${ref.repo} with full history`);
  const clone = run('git', ['clone', `https://github.com/${ref.owner}/${ref.repo}.git`, target]);
  if (clone.code !== 0) {
    throw new Error(`git clone of ${ref.owner}/${ref.repo} failed: ${clone.stderr.trim()}`);
  }
  return target;
}

/**
 * Nothing is written into the user's clone but the fetched objects, a ref under
 * refs/review-cockpit/ and the worktree registration.
 */
export function checkout(options: CheckoutOptions): CheckoutInfo {
  const { ref, headSha, baseSha, baseRef } = options;
  const local = findLocalClone(ref, options.cwd, options.workspaceRoots ?? []);

  if (local !== null) {
    options.onProgress?.(`local clone ${local}`);
    fetchPrHead(local, ref, headSha, baseSha, baseRef);
    const path = addWorktree(local, ref, headSha);
    return { mode: 'worktree', path, sourceRepo: local };
  }

  const cached = cloneIntoCache(ref, options.onProgress);
  fetchPrHead(cached, ref, headSha, baseSha, baseRef);
  const path = addWorktree(cached, ref, headSha);
  return { mode: 'clone', path };
}

/** Where the worktree of this pull request is registered. */
export function worktreeHost(checkoutInfo: CheckoutInfo, ref: PrRef): string {
  return checkoutInfo.sourceRepo ?? cloneDir(ref);
}
