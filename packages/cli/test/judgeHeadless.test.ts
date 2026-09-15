import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReviewDocument } from '@review-cockpit/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvokeOptions, InvokeOutcome, JudgeDeps } from '../src/commands/judge.js';
import { judgeCommand } from '../src/commands/judge.js';
import { newProgress } from '../src/headless.js';

const PR = 'northwind-labs/tenant-platform#1234';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixtures = join(repoRoot, 'fixtures');

let cache: string;
let prDir: string;
let checkout: string;
let out: string[];
let err: string[];

function goodJudgment(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixtures, 'judgment', 'pr-fake-1.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

function document(): ReviewDocument {
  return JSON.parse(readFileSync(join(prDir, 'review.json'), 'utf8')) as ReviewDocument;
}

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), 'cockpit-headless-'));
  process.env['REVIEW_COCKPIT_CACHE'] = cache;
  prDir = join(cache, 'northwind-labs', 'tenant-platform', 'pr-1234');
  mkdirSync(prDir, { recursive: true });

  const stage1 = JSON.parse(
    readFileSync(join(fixtures, 'pr-fake-1.stage1.json'), 'utf8'),
  ) as ReviewDocument;
  checkout = join(prDir, 'worktree');
  mkdirSync(checkout, { recursive: true });
  stage1.checkout = { ...stage1.checkout, path: checkout };
  writeFileSync(join(prDir, 'review.json'), JSON.stringify(stage1, null, 2));
  copyFileSync(join(fixtures, 'pr-fake-1.stage1.json'), join(cache, 'stage1.json'));

  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args) => err.push(args.join(' ')));
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['REVIEW_COCKPIT_CACHE'];
  rmSync(cache, { recursive: true, force: true });
});

/** Stands in for the model: it writes what the test tells it to, and records what it was asked. */
function fakeInvoke(
  writes: Array<Record<string, unknown> | 'nothing' | 'in-the-message'>,
): { deps: JudgeDeps; prompts: string[] } {
  const prompts: string[] = [];
  let turn = 0;
  const deps: JudgeDeps = {
    now: () => 1_000_000 + turn * 60_000,
    invoke: (options: InvokeOptions): Promise<InvokeOutcome> => {
      prompts.push(options.prompt);
      const state = newProgress();
      state.reads = 4;
      const answer = writes[turn] ?? 'nothing';
      turn += 1;
      if (answer === 'in-the-message') {
        state.finalText = JSON.stringify(goodJudgment());
      } else if (answer !== 'nothing') {
        writeFileSync(options.judgmentPath, JSON.stringify(answer, null, 2));
      }
      state.done = true;
      return Promise.resolve({ state, code: 0, timedOut: false });
    },
  };
  return { deps, prompts };
}

function headless(deps: JudgeDeps): Promise<number> {
  return judgeCommand(PR, { cwd: repoRoot, headless: true }, deps);
}

describe('cockpit judge --headless', () => {
  it('merges what the pass wrote and reports ready', async () => {
    const { deps } = fakeInvoke([goodJudgment()]);

    expect(await headless(deps)).toBe(0);

    expect(document().status.summary.state).toBe('ready');
    expect(JSON.parse(out.at(-1) as string)).toEqual({
      status: 'ready',
      durationSeconds: 60,
      url: null,
    });
  });

  it('writes the judgment from the final message when the file was never written', async () => {
    const { deps } = fakeInvoke(['in-the-message']);

    expect(await headless(deps)).toBe(0);
    expect(existsSync(join(prDir, 'judgment.json'))).toBe(true);
    expect(document().status.summary.state).toBe('ready');
  });

  it('retries once with the errors appended, and succeeds', async () => {
    const broken = goodJudgment();
    delete broken['summary'];
    const { deps, prompts } = fakeInvoke([broken, goodJudgment()]);

    expect(await headless(deps)).toBe(0);

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain('Your first attempt was rejected');
    expect(prompts[1]).toContain('Your first attempt was rejected');
    expect(prompts[1]).toContain('summary');
    expect(document().status.summary.state).toBe('ready');
  });

  it('marks stage 2 failed after a second rejection', async () => {
    const broken = goodJudgment();
    delete broken['summary'];
    const { deps, prompts } = fakeInvoke([broken, broken]);

    expect(await headless(deps)).toBe(1);

    expect(prompts).toHaveLength(2);
    const { status } = document();
    expect([status.groups.state, status.path.state, status.summary.state]).toEqual([
      'failed',
      'failed',
      'failed',
    ]);
    expect(status.summary.message).toContain('rejected twice');
    expect(JSON.parse(out.at(-1) as string)).toMatchObject({ status: 'failed' });
  });

  it('fails without a retry when the pass produced no judgment at all', async () => {
    const { deps, prompts } = fakeInvoke(['nothing']);

    expect(await headless(deps)).toBe(1);
    expect(prompts).toHaveLength(1);
    expect(document().status.summary.state).toBe('failed');
  });

  it('tells the pass not to run the merge itself', async () => {
    const { deps, prompts } = fakeInvoke([goodJudgment()]);
    await headless(deps);

    expect(prompts[0]).toContain('You are running headless');
    expect(prompts[0]).toContain('Do not run');
  });

  it('refuses when the checkout is gone', async () => {
    rmSync(checkout, { recursive: true, force: true });
    const { deps, prompts } = fakeInvoke([goodJudgment()]);

    expect(await headless(deps)).toBe(1);
    expect(prompts).toHaveLength(0);
    expect(err.join('\n')).toContain('Run cockpit run');
  });
});
