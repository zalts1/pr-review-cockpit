import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { PrRef } from '@review-cockpit/analyzer';
import {
  cacheRoot,
  cloneDir,
  documentFile,
  git,
  prDir,
  prRefName,
  readDocument,
  resolveRef,
  worktreeDir,
  worktreeHost,
} from '@review-cockpit/analyzer';
import { countUnsentDrafts, readServerFile } from '@review-cockpit/server';
import { cachedPrs, healthOf, identify, target } from '../servers.js';
import type { Column } from '../table.js';
import { renderTable } from '../table.js';
import { duration } from './ps.js';
import { stopServers } from './stop.js';

export interface CleanFlags {
  cwd: string;
  purge: boolean;
}

/** Answers a yes/no question. Injected in tests, which have no terminal to read. */
export type Confirm = (question: string) => Promise<boolean>;

export interface CleanAllFlags {
  purge: boolean;
  yes: boolean;
  force: boolean;
  root?: string;
  confirm?: Confirm;
}

export interface CleanOutcome {
  ref: PrRef;
  removed: string[];
  kept: string[];
}

export interface CachedReview {
  ref: PrRef;
  dir: string;
  server: string;
  /** Cockpits attached to this pull request's server right now, and 0 when none is running. */
  clients: number;
  drafts: number;
  age: string;
}

export async function cleanCommand(prArg: string, flags: CleanFlags): Promise<number> {
  report(await cleanOne(resolveRef(prArg, flags.cwd), flags.purge));
  return 0;
}

export async function cleanAllCommand(flags: CleanAllFlags): Promise<number> {
  const reviews = await surveyCache(flags.root ?? cacheRoot());
  if (reviews.length === 0) {
    console.error('[clean] the cache holds no pull request');
    return 0;
  }

  console.error(renderTable(COLUMNS, reviews));

  const targets = flags.force ? reviews : reviews.filter((review) => review.clients === 0);
  for (const review of reviews) {
    if (targets.includes(review)) continue;
    console.error(
      `[clean] ${target(review.ref)} has a cockpit connected, so it was left alone; --force cleans it anyway`,
    );
  }
  if (targets.length === 0) {
    console.error('[clean] nothing to clean');
    return 0;
  }

  if (!flags.yes) {
    const confirm = flags.confirm ?? askOnTty;
    if (!(await confirm(question(targets.length, flags.purge)))) {
      console.error('[clean] nothing was cleaned');
      return 0;
    }
  }

  for (const review of targets) report(await cleanOne(review.ref, flags.purge));
  console.error(
    `[clean] cleaned ${targets.length} pull request${targets.length === 1 ? '' : 's'}`,
  );
  return 0;
}

/**
 * Removes the checkout, and with `purge` the cache directory too. The worktree is deregistered
 * from its clone by path before anything is deleted: `git worktree prune` would drop the
 * registrations of every other tool sharing that clone (ADR-25).
 */
export async function cleanOne(ref: PrRef, purge: boolean): Promise<CleanOutcome> {
  const removed: string[] = [];

  for (const outcome of await stopServers({ selector: { kind: 'pr', ref } })) {
    removed.push(outcome.detail);
  }

  const host = hostOf(ref);
  const worktree = worktreeDir(ref);
  if (existsSync(worktree)) {
    const gone = git(host, ['worktree', 'remove', '--force', worktree]);
    rmSync(worktree, { recursive: true, force: true });
    removed.push(gone.code === 0 ? `removed the worktree from ${host}` : `deleted ${worktree}`);
  }

  const refName = prRefName(ref);
  if (git(host, ['rev-parse', '--verify', '--quiet', refName]).code === 0) {
    git(host, ['update-ref', '-d', refName]);
    removed.push(`deleted ${refName} from ${host}`);
  }

  const dir = prDir(ref);
  const files = reviewFiles(dir);
  if (!purge) return { ref, removed, kept: files.map((name) => join(dir, name)) };

  rmSync(dir, { recursive: true, force: true });
  removed.push(
    files.length === 0
      ? `deleted ${dir}`
      : `deleted ${dir} and everything in it: ${files.join(', ')}`,
  );
  return { ref, removed, kept: [] };
}

export async function surveyCache(root: string = cacheRoot()): Promise<CachedReview[]> {
  const reviews: CachedReview[] = [];
  for (const pr of cachedPrs(root)) {
    const { server, clients } = await serverState(pr.dir);
    reviews.push({
      ref: pr.ref,
      dir: pr.dir,
      server,
      clients,
      drafts: await countUnsentDrafts(pr.dir),
      age: age(pr.dir),
    });
  }
  return reviews;
}

const COLUMNS: Array<Column<CachedReview>> = [
  { head: 'pull request', of: (review) => target(review.ref) },
  { head: 'server', of: (review) => review.server },
  { head: 'unsent drafts', of: (review) => String(review.drafts) },
  { head: 'last used', of: (review) => review.age },
];

function report(outcome: CleanOutcome): void {
  for (const line of outcome.removed) console.error(`[clean] ${line}`);
  console.error(
    outcome.kept.length === 0
      ? `[clean] kept nothing for ${target(outcome.ref)}`
      : `[clean] kept ${outcome.kept.join(', ')}`,
  );
}

function question(count: number, purge: boolean): string {
  const what = `${count} pull request${count === 1 ? '' : 's'}`;
  return purge
    ? `Delete the analysis, the drafts and the checkout of ${what}?`
    : `Stop the server and remove the checkout of ${what}?`;
}

async function askOnTty(prompt: string): Promise<boolean> {
  if (process.stdin.isTTY !== true) {
    console.error(`[clean] ${prompt} stdin is not a terminal, so nothing was cleaned. Pass --yes to go ahead.`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(`${prompt} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

async function serverState(dir: string): Promise<{ server: string; clients: number }> {
  const file = readServerFile(dir);
  if (file === null) return { server: 'none', clients: 0 };

  const identity = await identify(file);
  if (identity === 'gone') return { server: 'stale', clients: 0 };
  if (identity === 'foreign') return { server: 'foreign pid', clients: 0 };

  const clients = (await healthOf(file.url))?.clients ?? 0;
  return { server: clients > 0 ? `${clients} connected` : 'running', clients };
}

/** The document's mtime, which every analysis and every posted review updates. */
function age(dir: string): string {
  const touched = mtimeOf(join(dir, 'review.json')) ?? mtimeOf(dir);
  return touched === null ? '?' : `${duration((Date.now() - touched) / 1000)} ago`;
}

function mtimeOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function reviewFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function hostOf(ref: PrRef): string {
  const document = documentFile(ref);
  if (!existsSync(document)) return cloneDir(ref);
  try {
    return worktreeHost(readDocument(document).checkout, ref);
  } catch {
    return cloneDir(ref);
  }
}
