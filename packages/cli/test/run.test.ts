import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnalyzeOptions, PrRef } from '@review-cockpit/analyzer';
import type { ReviewDocument } from '@review-cockpit/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunDeps, ServeOutcome, ServeSpawn } from '../src/commands/run.js';
import { runCommand } from '../src/commands/run.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const document = JSON.parse(
  readFileSync(join(repoRoot, 'fixtures', 'pr-fake-1.stage1.json'), 'utf8'),
) as ReviewDocument;

const ref: PrRef = { owner: document.pr.owner, repo: document.pr.repo, number: document.pr.number };
const HEAD = document.pr.head.sha;

let cache: string;
let out: string[];
let err: string[];

interface Recorded {
  analyzed: AnalyzeOptions[];
  served: ServeSpawn[];
  opened: string[];
  restored: number;
}

function fakeDeps(
  cachedHead: string | null,
  serve: ServeOutcome,
): { deps: RunDeps; recorded: Recorded } {
  const recorded: Recorded = { analyzed: [], served: [], opened: [], restored: 0 };
  const deps: RunDeps = {
    resolve: () => ({ ref, headSha: HEAD, title: document.pr.title }),
    cachedHead: () => cachedHead,
    restoreCheckout: () => {
      recorded.restored += 1;
    },
    analyze: async (options) => {
      recorded.analyzed.push(options);
      await options.onStage1?.({
        ref,
        checkout: document.checkout,
        document,
        documentPath: join(cache, 'review.json'),
        compactPath: join(cache, 'compact.md'),
        stage1Ms: 1234,
      });
      return {
        ref,
        checkout: document.checkout,
        document,
        documentPath: join(cache, 'review.json'),
        compactPath: join(cache, 'compact.md'),
        compactBytes: 10,
        stage1Ms: 1234,
        graph: null,
        carry: { kind: 'skipped', why: 'test' },
        reattach: { kind: 'skipped', why: 'test' },
      };
    },
    serve: async (_target, spawn) => {
      recorded.served.push(spawn);
      return serve;
    },
    open: (url) => {
      recorded.opened.push(url);
    },
  };
  return { deps, recorded };
}

function lastJson(): Record<string, string> {
  const line = out.filter((text) => text.trim() !== '').at(-1) ?? '';
  return JSON.parse(line) as Record<string, string>;
}

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), 'cockpit-run-'));
  process.env['REVIEW_COCKPIT_CACHE'] = cache;
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args) => err.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['REVIEW_COCKPIT_CACHE'];
  rmSync(cache, { recursive: true, force: true });
});

const started: ServeOutcome = {
  url: 'http://127.0.0.1:8090',
  port: 8090,
  pid: 4242,
  started: true,
};

describe('cockpit run', () => {
  it('analyzes, serves and opens the browser, then prints one line of JSON', async () => {
    const { deps, recorded } = fakeDeps(null, started);

    expect(await runCommand('123', { cwd: repoRoot, reuseServer: false, open: true, skipGraph: false }, deps)).toBe(0);

    expect(recorded.analyzed).toHaveLength(1);
    expect(recorded.analyzed[0]).toMatchObject({ expectJudgment: true, skipGraph: false });
    expect(recorded.served).toEqual([{}]);
    expect(recorded.opened).toEqual(['http://127.0.0.1:8090']);

    expect(lastJson()).toEqual({
      url: 'http://127.0.0.1:8090',
      prDir: join(cache, ref.owner, ref.repo, `pr-${ref.number}`),
      compact: join(cache, ref.owner, ref.repo, `pr-${ref.number}`, 'compact.md'),
      judgmentOut: join(cache, ref.owner, ref.repo, `pr-${ref.number}`, 'judgment.json'),
      headSha: HEAD,
    });
    expect(err.at(-1)).toBe('Cockpit: http://127.0.0.1:8090');
  });

  it('serves the browser before the graph stage', async () => {
    const { deps } = fakeDeps(null, started);
    const order: string[] = [];
    const analyze = deps.analyze;
    deps.analyze = async (options) => {
      const result = await analyze({
        ...options,
        onStage1: async (handoff) => {
          await options.onStage1?.(handoff);
          order.push('stage1 handed off');
        },
      });
      order.push('graph done');
      return result;
    };
    deps.open = () => order.push('browser opened');

    await runCommand('123', { cwd: repoRoot, reuseServer: false, open: true, skipGraph: false }, deps);

    expect(order).toEqual(['browser opened', 'stage1 handed off', 'graph done']);
  });

  it('skips the analysis when the cached document is at the same head', async () => {
    const { deps, recorded } = fakeDeps(HEAD, started);

    expect(await runCommand('123', { cwd: repoRoot, reuseServer: false, open: false, skipGraph: false }, deps)).toBe(0);

    expect(recorded.analyzed).toHaveLength(0);
    expect(recorded.served).toHaveLength(1);
    expect(recorded.opened).toEqual([]);
    expect(err.some((line) => line.includes('cached document at this head'))).toBe(true);
    expect(lastJson().headSha).toBe(HEAD);
  });

  it('analyzes again when the cached document is at another head', async () => {
    const { deps, recorded } = fakeDeps('0'.repeat(40), started);

    await runCommand('123', { cwd: repoRoot, reuseServer: false, open: false, skipGraph: false }, deps);

    expect(recorded.analyzed).toHaveLength(1);
  });

  it('keeps a running server and its tab with --reuse-server', async () => {
    const running: ServeOutcome = { ...started, started: false };
    const { deps, recorded } = fakeDeps(HEAD, running);

    expect(await runCommand('123', { cwd: repoRoot, reuseServer: true, open: true, skipGraph: false }, deps)).toBe(0);

    expect(recorded.opened).toEqual([]);
    expect(err.some((line) => line.includes('reusing the server already on http://127.0.0.1:8090'))).toBe(true);
  });

  it('passes the port and --skip-graph through', async () => {
    const { deps, recorded } = fakeDeps(null, started);

    await runCommand('123', { cwd: repoRoot, reuseServer: false, open: false, skipGraph: true, port: 8090 }, deps);

    expect(recorded.served).toEqual([{ port: 8090 }]);
    expect(recorded.analyzed[0]).toMatchObject({ skipGraph: true });
  });

  it('makes the checkout again when only the document survived', async () => {
    const { deps, recorded } = fakeDeps(HEAD, started);

    await runCommand('123', { cwd: repoRoot, reuseServer: false, open: false, skipGraph: false }, deps);

    expect(recorded.restored).toBe(1);
  });
});
