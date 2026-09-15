import type { ChildProcess } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanAllCommand, cleanOne, surveyCache } from '../src/commands/clean.js';

/** Stands in for a real `cockpit serve`: its command line is what the liveness check reads. */
const FAKE_SERVER = 'setInterval(() => undefined, 1000);\n';

let root: string;
let cache: string;
let source: string;
const children: ChildProcess[] = [];
const servers: Server[] = [];

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'review-cockpit-clean-'));
  cache = join(root, 'cache');
  source = join(root, 'source');
  process.env['REVIEW_COCKPIT_CACHE'] = cache;

  mkdirSync(source, { recursive: true });
  git(source, ['init', '--quiet', '--initial-branch', 'main']);
  git(source, ['config', 'user.email', 'test@example.invalid']);
  git(source, ['config', 'user.name', 'Test']);
  writeFileSync(join(source, 'README.md'), '# source\n', 'utf8');
  git(source, ['add', 'README.md']);
  git(source, ['commit', '--quiet', '-m', 'first']);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) child.kill('SIGKILL');
  await Promise.all(
    servers.splice(0).map((server) => new Promise((closed) => server.close(closed))),
  );
  delete process.env['REVIEW_COCKPIT_CACHE'];
  rmSync(root, { recursive: true, force: true });
});

interface Staged {
  dir: string;
  worktree: string;
  gitRef: string;
  files: string[];
}

function stagePr(number: number, drafts = 0): Staged {
  const dir = join(cache, 'owner', 'repo', `pr-${number}`);
  mkdirSync(dir, { recursive: true });

  const head = git(source, ['rev-parse', 'HEAD']).trim();
  const gitRef = `refs/review-cockpit/pr-${number}`;
  git(source, ['update-ref', gitRef, head]);

  const worktree = join(dir, 'worktree');
  git(source, ['worktree', 'add', '--quiet', '--detach', worktree, head]);

  const files = [
    join(dir, 'review.json'),
    join(dir, 'drafts.json'),
    join(dir, 'judgment.json'),
    join(dir, 'compact.md'),
    join(dir, 'submitted-2026-09-01T00-00-00.json'),
    join(dir, 'log.txt'),
  ];
  writeFileSync(
    files[0] as string,
    JSON.stringify({
      pr: { owner: 'owner', repo: 'repo', number },
      checkout: { mode: 'worktree', path: worktree, sourceRepo: source },
    }),
    'utf8',
  );
  writeFileSync(
    files[1] as string,
    JSON.stringify({
      pr: { owner: 'owner', repo: 'repo', number },
      drafts: Array.from({ length: drafts }, (_unused, index) => ({ id: `d${index}` })),
    }),
    'utf8',
  );
  for (const path of files.slice(2)) writeFileSync(path, '{}', 'utf8');

  return { dir, worktree, gitRef, files };
}

function hasRef(gitRef: string): boolean {
  return spawnSync('git', ['rev-parse', '--verify', '--quiet', gitRef], { cwd: source }).status === 0;
}

/** A server that answers /api/health the way `cockpit ps` proves a server is ours. */
async function stageServer(staged: Staged, clients: number): Promise<void> {
  const token = 'token-for-the-test';
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, token, clients, idleSeconds: 0 }));
  });
  servers.push(server);
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');

  const entry = join(root, `cockpit-${staged.gitRef.slice(-1)}.js`);
  writeFileSync(entry, FAKE_SERVER, 'utf8');
  const child = spawn(process.execPath, [entry, 'serve', 'owner/repo'], { stdio: 'ignore' });
  children.push(child);
  await new Promise((wake) => setTimeout(wake, 100));

  writeFileSync(
    join(staged.dir, 'server.json'),
    JSON.stringify({
      port: address.port,
      pid: child.pid,
      url: `http://127.0.0.1:${address.port}`,
      startedAt: new Date().toISOString(),
      token,
    }),
    'utf8',
  );
}

function stderr(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return lines;
}

describe('cockpit clean <pr>', () => {
  it('removes the checkout and keeps every file the review is made of', async () => {
    const staged = stagePr(1);

    const outcome = await cleanOne({ owner: 'owner', repo: 'repo', number: 1 }, false);

    expect(existsSync(staged.worktree)).toBe(false);
    expect(hasRef(staged.gitRef)).toBe(false);
    expect(git(source, ['worktree', 'list'])).not.toContain(staged.worktree);
    for (const path of staged.files) expect(existsSync(path)).toBe(true);
    expect(outcome.kept).toEqual(expect.arrayContaining(staged.files));
    expect(outcome.removed.join('\n')).toContain('removed the worktree');
  });

  it('deletes the whole cache directory with --purge, and says what went with it', async () => {
    const staged = stagePr(2);

    const outcome = await cleanOne({ owner: 'owner', repo: 'repo', number: 2 }, true);

    expect(existsSync(staged.dir)).toBe(false);
    expect(hasRef(staged.gitRef)).toBe(false);
    expect(outcome.kept).toEqual([]);
    const said = outcome.removed.join('\n');
    expect(said).toContain(staged.dir);
    for (const name of ['review.json', 'drafts.json', 'judgment.json', 'compact.md', 'log.txt']) {
      expect(said).toContain(name);
    }
    expect(said).toContain('submitted-2026-09-01T00-00-00.json');
  });

  it('leaves a worktree another tool registered in the same clone alone', async () => {
    const staged = stagePr(3);
    const theirs = join(root, 'somebody-elses-worktree');
    git(source, ['worktree', 'add', '--quiet', '--detach', theirs, git(source, ['rev-parse', 'HEAD']).trim()]);

    await cleanOne({ owner: 'owner', repo: 'repo', number: 3 }, true);

    expect(existsSync(theirs)).toBe(true);
    expect(git(source, ['worktree', 'list'])).toContain(theirs);
    expect(existsSync(staged.dir)).toBe(false);
  });
});

describe('cockpit clean --all', () => {
  it('lists every cached pull request with its server, its unsent drafts and its age', async () => {
    stagePr(1, 2);
    const busy = stagePr(2);
    await stageServer(busy, 0);

    const reviews = await surveyCache(cache);

    expect(reviews.map((review) => review.ref.number)).toEqual([1, 2]);
    expect(reviews[0]).toMatchObject({ server: 'none', drafts: 2 });
    expect(reviews[1]).toMatchObject({ server: 'running', clients: 0 });
    expect(reviews[0]?.age).toMatch(/ago$/);
  });

  it('asks before it removes anything, and removes nothing on a no', async () => {
    const staged = stagePr(1);
    const lines = stderr();

    const code = await cleanAllCommand({
      purge: true,
      yes: false,
      force: false,
      root: cache,
      confirm: async () => false,
    });

    expect(code).toBe(0);
    expect(existsSync(staged.dir)).toBe(true);
    expect(lines.join('\n')).toContain('nothing was cleaned');
  });

  it('cleans each pull request on a yes', async () => {
    const one = stagePr(1);
    const two = stagePr(2);
    const asked: string[] = [];
    stderr();

    await cleanAllCommand({
      purge: false,
      yes: false,
      force: false,
      root: cache,
      confirm: async (question) => {
        asked.push(question);
        return true;
      },
    });

    expect(asked).toEqual(['Stop the server and remove the checkout of 2 pull requests?']);
    expect(existsSync(one.worktree)).toBe(false);
    expect(existsSync(two.worktree)).toBe(false);
    expect(existsSync(join(one.dir, 'review.json'))).toBe(true);
  });

  it('skips the question with --yes', async () => {
    const staged = stagePr(1);
    stderr();

    await cleanAllCommand({
      purge: true,
      yes: true,
      force: false,
      root: cache,
      confirm: async () => {
        throw new Error('--yes must not ask');
      },
    });

    expect(existsSync(staged.dir)).toBe(false);
  });

  it('leaves a pull request with a cockpit connected alone', async () => {
    const read = stagePr(1);
    await stageServer(read, 1);
    const alone = stagePr(2);
    const lines = stderr();

    await cleanAllCommand({ purge: true, yes: true, force: false, root: cache });

    expect(existsSync(read.dir)).toBe(true);
    expect(existsSync(read.worktree)).toBe(true);
    expect(existsSync(alone.dir)).toBe(false);
    expect(lines.join('\n')).toContain('owner/repo#1 has a cockpit connected');
  });

  it('cleans a pull request with a cockpit connected when --force says so', async () => {
    const read = stagePr(1);
    await stageServer(read, 1);
    stderr();

    await cleanAllCommand({ purge: true, yes: true, force: true, root: cache });

    expect(existsSync(read.dir)).toBe(false);
  });

  it('says so and does nothing when the cache is empty', async () => {
    const lines = stderr();

    const code = await cleanAllCommand({ purge: false, yes: true, force: false, root: cache });

    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('no pull request');
  });
});
