import type { ChildProcess } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectGarbage } from '../src/commands/gc.js';

const DAY_MS = 86_400_000;

/** Stands in for a real `cockpit serve`: its command line is what the liveness check reads. */
const FAKE_SERVER = 'setInterval(() => undefined, 1000);\n';

let root: string;
let cache: string;
let source: string;
const children: ChildProcess[] = [];

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'review-cockpit-gc-'));
  cache = join(root, 'cache');
  source = join(root, 'source');

  mkdirSync(source, { recursive: true });
  git(source, ['init', '--quiet', '--initial-branch', 'main']);
  git(source, ['config', 'user.email', 'test@example.invalid']);
  git(source, ['config', 'user.name', 'Test']);
  writeFileSync(join(source, 'README.md'), '# source\n', 'utf8');
  git(source, ['add', 'README.md']);
  git(source, ['commit', '--quiet', '-m', 'first']);
});

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  rmSync(root, { recursive: true, force: true });
});

interface Staged {
  dir: string;
  worktree: string;
  gitRef: string;
  protected: string[];
}

function stagePr(number: number, ageDays: number): Staged {
  const dir = join(cache, 'owner', 'repo', `pr-${number}`);
  mkdirSync(dir, { recursive: true });

  const head = git(source, ['rev-parse', 'HEAD']).trim();
  const gitRef = `refs/review-cockpit/pr-${number}`;
  git(source, ['update-ref', gitRef, head]);

  const worktree = join(dir, 'worktree');
  git(source, ['worktree', 'add', '--quiet', '--detach', worktree, head]);

  const document = join(dir, 'review.json');
  writeFileSync(
    document,
    JSON.stringify({ pr: { owner: 'owner', repo: 'repo', number }, checkout: { mode: 'worktree', path: worktree, sourceRepo: source } }),
    'utf8',
  );

  const kept = [
    document,
    join(dir, 'drafts.json'),
    join(dir, 'judgment.json'),
    join(dir, 'submitted-2026-09-01T00-00-00.json'),
  ];
  for (const path of kept.slice(1)) writeFileSync(path, '{}', 'utf8');

  const when = (Date.now() - ageDays * DAY_MS) / 1000;
  for (const path of kept) utimesSync(path, when, when);

  return { dir, worktree, gitRef, protected: kept };
}

function hasRef(gitRef: string): boolean {
  return spawnSync('git', ['rev-parse', '--verify', '--quiet', gitRef], { cwd: source }).status === 0;
}

describe('cockpit gc', () => {
  it('removes nothing on a dry run, and says what it would remove', () => {
    const staged = stagePr(1, 30);

    const result = collectGarbage({ days: 7, dryRun: true, root: cache });

    expect(result.removed).toHaveLength(1);
    expect(result.lines[0]).toContain('would remove');
    expect(result.lines[0]).toContain('owner/repo#1');
    expect(result.summary).toContain('would collect 1 checkout');
    expect(existsSync(staged.worktree)).toBe(true);
    expect(hasRef(staged.gitRef)).toBe(true);
  });

  it('removes the worktree and the ref, and keeps everything the review is made of', () => {
    const staged = stagePr(2, 30);

    const result = collectGarbage({ days: 7, dryRun: false, root: cache });

    expect(result.lines[0]).toContain('removed');
    expect(existsSync(staged.worktree)).toBe(false);
    expect(hasRef(staged.gitRef)).toBe(false);
    expect(git(source, ['worktree', 'list'])).not.toContain(staged.worktree);

    for (const path of staged.protected) expect(existsSync(path)).toBe(true);
    expect(readFileSync(join(staged.dir, 'review.json'), 'utf8')).toContain('"number":2');
  });

  it('keeps a review that is younger than the window and collects one that is older', () => {
    const young = stagePr(3, 6);
    const old = stagePr(4, 8);

    const result = collectGarbage({ days: 7, dryRun: false, root: cache });

    expect(result.removed.map((removal) => removal.target)).toEqual(['owner/repo#4']);
    expect(existsSync(young.worktree)).toBe(true);
    expect(existsSync(old.worktree)).toBe(false);
    expect(result.summary).toContain('kept 1 newer than 7 days');
  });

  it('leaves a worktree another tool registered in the same clone alone', () => {
    const staged = stagePr(5, 30);
    const theirs = join(root, 'somebody-elses-worktree');
    git(source, ['worktree', 'add', '--quiet', '--detach', theirs, git(source, ['rev-parse', 'HEAD']).trim()]);

    collectGarbage({ days: 7, dryRun: false, root: cache });

    expect(existsSync(staged.worktree)).toBe(false);
    expect(existsSync(theirs)).toBe(true);
    expect(git(source, ['worktree', 'list'])).toContain(theirs);
  });

  it('keeps a pull request whose server is still running', async () => {
    const staged = stagePr(6, 30);
    const entry = join(root, 'cockpit.js');
    writeFileSync(entry, FAKE_SERVER, 'utf8');
    const child = spawn(process.execPath, [entry, 'serve', 'owner/repo#6'], { stdio: 'ignore' });
    children.push(child);
    await new Promise((wake) => setTimeout(wake, 100));

    writeFileSync(
      join(staged.dir, 'server.json'),
      JSON.stringify({ port: 1, pid: child.pid, url: 'http://127.0.0.1:1', startedAt: '', token: 'x' }),
      'utf8',
    );

    const result = collectGarbage({ days: 7, dryRun: false, root: cache });

    expect(result.removed).toEqual([]);
    expect(result.summary).toContain('1 in use');
    expect(existsSync(staged.worktree)).toBe(true);
  });

  it('collects a pull request whose server.json names a process that is gone', () => {
    const staged = stagePr(7, 30);
    const gone = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    writeFileSync(
      join(staged.dir, 'server.json'),
      JSON.stringify({ port: 1, pid: gone.pid, url: 'http://127.0.0.1:1', startedAt: '', token: 'x' }),
      'utf8',
    );

    const result = collectGarbage({ days: 7, dryRun: false, root: cache });

    expect(result.removed.map((removal) => removal.target)).toEqual(['owner/repo#7']);
    expect(existsSync(staged.worktree)).toBe(false);
  });

  it('reports an empty cache as nothing to collect', () => {
    mkdirSync(join(cache, 'owner', 'repo', 'pr-9'), { recursive: true });
    const result = collectGarbage({ days: 7, dryRun: false, root: cache });
    expect(result.removed).toEqual([]);
    expect(result.summary).toBe('nothing to collect (1 already collected)');
  });
});
