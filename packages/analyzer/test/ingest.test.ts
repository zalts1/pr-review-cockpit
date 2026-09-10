import { describe, expect, it } from 'vitest';
import type { PrInfo } from '@review-cockpit/schema';
import { jsonValues } from '../src/gh.js';
import { ingest } from '../src/ingest.js';

const pr: PrInfo = {
  owner: 'northwind-labs',
  repo: 'tenant-platform',
  number: 7,
  url: 'https://github.com/northwind-labs/tenant-platform/pull/7',
  title: 'Add tenant profile API',
  body: '## What\n\n<!-- CURSOR_SUMMARY -->\n> [!NOTE]\n> **Low Risk**\n> Adds one column.\n<!-- /CURSOR_SUMMARY -->',
  author: 'jdoe',
  draft: false,
  labels: [],
  base: { ref: 'main', sha: 'a'.repeat(40) },
  head: { ref: 'topic', sha: 'd'.repeat(40) },
  additions: 1,
  deletions: 0,
  changedFiles: 0,
};

const reviewComments = JSON.stringify([
  {
    id: 900,
    user: { login: 'cursor[bot]', type: 'Bot' },
    body: '**High Severity**\n\nThe sentinel is dropped.',
    html_url: 'https://github.com/northwind-labs/tenant-platform/pull/7#discussion_r900',
    created_at: '2026-09-08T10:00:00Z',
    path: 'api/service/tenant/record.go',
    line: 92,
    original_line: 92,
    side: 'RIGHT',
  },
]);

const issueComments = JSON.stringify([
  {
    id: 500,
    user: { login: 'jdoe', type: 'User' },
    body: 'Migration goes first.',
    html_url: 'https://github.com/northwind-labs/tenant-platform/pull/7#issuecomment-500',
    created_at: '2026-09-08T09:00:00Z',
  },
]);

const threads = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: 'PRRT_a',
              isResolved: true,
              isOutdated: false,
              comments: { nodes: [{ databaseId: 900 }] },
            },
          ],
        },
      },
    },
  },
});

const checkRuns = JSON.stringify({
  total_count: 2,
  check_runs: [
    {
      name: 'lint-and-test',
      status: 'completed',
      conclusion: 'success',
      details_url: 'https://github.com/northwind-labs/tenant-platform/runs/1',
      started_at: '2026-09-08T11:00:00Z',
      completed_at: '2026-09-08T11:02:00Z',
      app: { slug: 'github-actions' },
    },
    {
      name: 'Wiz',
      status: 'in_progress',
      conclusion: null,
      details_url: 'https://app.wiz.io/scans/1',
      started_at: '2026-09-08T11:00:00Z',
      completed_at: null,
      app: { slug: 'wiz-io' },
    },
  ],
});

const commitStatus = JSON.stringify({
  state: 'failure',
  total_count: 1,
  statuses: [
    {
      context: 'ci/legacy',
      state: 'error',
      target_url: 'https://ci.example.test/1',
      updated_at: '2026-09-08T11:05:00Z',
    },
  ],
});

function canned(over: Record<string, string> = {}) {
  const answers: Record<string, string> = {
    'pulls/7/comments': reviewComments,
    'issues/7/comments': issueComments,
    graphql: threads,
    'check-runs': checkRuns,
    status: commitStatus,
    ...over,
  };
  const calls: string[][] = [];
  const gh = (args: readonly string[]): string => {
    calls.push([...args]);
    for (const [needle, answer] of Object.entries(answers)) {
      if (args.some((arg) => arg.includes(needle))) {
        if (answer.startsWith('!')) throw new Error(answer.slice(1));
        return answer;
      }
    }
    throw new Error(`no canned answer for ${args.join(' ')}`);
  };
  return { gh, calls };
}

describe('ingest', () => {
  it('reads comments, checks and the body summary with no network', () => {
    const { gh, calls } = canned();
    const result = ingest({ pr, files: [], gh });

    expect(result.commentsError).toBeNull();
    expect(result.checksError).toBeNull();
    expect(result.comments.map((comment) => [comment.source.name, comment.severity, comment.resolved])).toEqual([
      ['Cursor Bugbot', 'high', true],
    ]);
    expect(result.conversation.map((comment) => comment.id)).toEqual(['ic500']);
    expect(result.checks.map((check) => [check.name, check.status])).toEqual([
      ['lint-and-test', 'success'],
      ['Wiz', 'pending'],
      ['ci/legacy', 'failure'],
    ]);
    expect(result.botSummaries[0]).toMatchObject({ riskLevel: 'low', body: 'Adds one column.' });
    expect(calls).toHaveLength(5);
    expect(calls.every((call) => call[0] === 'api')).toBe(true);
  });

  it('keeps the checks when the comment fetch fails', () => {
    const { gh } = canned({ 'pulls/7/comments': '!gh: Not Found (HTTP 404)' });
    const result = ingest({ pr, files: [], gh });

    expect(result.commentsError).toBe('gh: Not Found (HTTP 404)');
    expect(result.comments).toEqual([]);
    expect(result.checks).toHaveLength(3);
    expect(result.checksError).toBeNull();
  });

  it('keeps the comments when the check fetch fails', () => {
    const { gh } = canned({ 'check-runs': '!gh: server error (HTTP 502)' });
    const result = ingest({ pr, files: [], gh });

    expect(result.checksError).toBe('gh: server error (HTTP 502)');
    expect(result.checks).toEqual([]);
    expect(result.comments).toHaveLength(1);
    expect(result.commentsError).toBeNull();
  });

  it('reads every page of a paginated fetch', () => {
    const { gh } = canned({
      'pulls/7/comments': `${reviewComments}\n${reviewComments.replace('900', '901')}`,
    });
    const result = ingest({ pr, files: [], gh });
    expect(result.comments.map((comment) => comment.id)).toEqual(['c900', 'c901']);
  });
});

describe('jsonValues', () => {
  it('reads one value and several in a row', () => {
    expect(jsonValues('[1, 2]')).toEqual([[1, 2]]);
    expect(jsonValues('{"a": 1}\n{"a": 2}')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('is not fooled by brackets and quotes inside strings', () => {
    expect(jsonValues('[{"body": "a ] \\" [ b"}]')).toEqual([[{ body: 'a ] " [ b' }]]);
  });

  it('is empty for empty output', () => {
    expect(jsonValues('')).toEqual([]);
  });
});
