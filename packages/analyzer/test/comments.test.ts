import type { ReviewFile } from '@review-cockpit/schema';
import { describe, expect, it } from 'vitest';
import {
  commentStats,
  lineIndex,
  mapComments,
  placeComment,
  severityOf,
  sourceOf,
  threadsByComment,
} from '../src/comments.js';
import type { GhReviewComment, ThreadInfo } from '../src/comments.js';

const files: ReviewFile[] = [
  {
    id: 'f1',
    path: 'api/service/tenant/record.go',
    previousPath: null,
    status: 'modified',
    language: 'go',
    binary: false,
    generated: { is: false, rule: null },
    additions: 1,
    deletions: 1,
    signals: {
      churnCommits90d: 1,
      bugfixCommits: 0,
      authorPriorCommits: 0,
      fanIn: null,
      fanOut: null,
      fanSource: null,
      complexityBefore: null,
      complexityAfter: null,
      sensitivePath: { match: false, rule: null },
      testFile: false,
      coverageDelta: null,
    },
    hunks: [
      {
        id: 'f1.h1',
        oldStart: 88,
        oldLines: 2,
        newStart: 91,
        newLines: 2,
        header: 'func (s *Service) UpdateRecord()',
        symbols: ['Service.UpdateRecord'],
        kind: 'code',
        lines: [
          { type: 'context', oldNo: 88, newNo: 91, text: 'if id == "" {' },
          { type: 'del', oldNo: 89, newNo: null, text: 'return ErrMissingID' },
          { type: 'add', oldNo: null, newNo: 92, text: 'return status.Error(...)' },
        ],
        risk: {
          floor: 'low',
          level: 'low',
          score: 0.1,
          mode: 'skim',
          factors: [],
          reason: null,
          adjustedBy: null,
        },
      },
    ],
  },
];

function reviewComment(over: Partial<GhReviewComment> = {}): GhReviewComment {
  return {
    id: 900,
    user: { login: 'danat', type: 'User' },
    body: 'Is last-write-wins acceptable here?',
    html_url: 'https://github.com/northwind-labs/tenant-platform/pull/7#discussion_r900',
    created_at: '2026-09-08T10:00:00Z',
    path: 'api/service/tenant/record.go',
    line: 92,
    original_line: 92,
    side: 'RIGHT',
    in_reply_to_id: null,
    subject_type: 'line',
    ...over,
  };
}

describe('sourceOf', () => {
  it('names a bot by the login suffix', () => {
    expect(sourceOf('cursor[bot]')).toEqual({ kind: 'bot', name: 'Cursor Bugbot' });
  });

  it('names a bot by the user type when the login has no suffix', () => {
    expect(sourceOf('review-helper', 'Bot')).toEqual({ kind: 'bot', name: 'review-helper' });
  });

  it('gives GitHub Actions its friendly name', () => {
    expect(sourceOf('github-actions[bot]')).toEqual({ kind: 'bot', name: 'GitHub Actions' });
  });

  it('falls back to the login for an unknown bot', () => {
    expect(sourceOf('coderabbitai[bot]')).toEqual({ kind: 'bot', name: 'coderabbitai[bot]' });
  });

  it('is a person otherwise, named by login', () => {
    expect(sourceOf('danat', 'User')).toEqual({ kind: 'human', name: 'danat' });
  });
});

describe('severityOf', () => {
  it('reads a level on a line of its own', () => {
    expect(severityOf('### Override drops the flag\n\n**Medium Severity**\n\nDetail.')).toBe(
      'medium',
    );
  });

  it('reads a labelled level', () => {
    expect(severityOf('**Severity:** High\n\nThe migration is destructive.')).toBe('high');
  });

  it('reads a level inside a GitHub alert', () => {
    expect(severityOf('> [!WARNING] High Risk\n> Callers compare sentinels.')).toBe('high');
  });

  it('is null when the body names no level', () => {
    expect(severityOf('This drops the wrapped cause.')).toBeNull();
  });
});

describe('line placement', () => {
  const index = lineIndex(files);

  it('places a comment on a line the diff shows', () => {
    expect(placeComment(index, 'api/service/tenant/record.go', 92, 'RIGHT')).toBe('f1.h1');
  });

  it('places a base-side comment by its old line number', () => {
    expect(placeComment(index, 'api/service/tenant/record.go', 89, 'LEFT')).toBe('f1.h1');
  });

  it('does not place a line the diff does not show', () => {
    expect(placeComment(index, 'api/service/tenant/record.go', 400, 'RIGHT')).toBeNull();
  });

  it('does not place a line of a file outside the diff', () => {
    expect(placeComment(index, 'api/service/tenant/list.go', 92, 'RIGHT')).toBeNull();
  });

  it('does not place the deleted line number on the head side', () => {
    expect(placeComment(index, 'api/service/tenant/record.go', 89, 'RIGHT')).toBeNull();
  });
});

describe('mapComments', () => {
  const threads = new Map<number, ThreadInfo>([
    [900, { threadId: 'PRRT_a', resolved: false, outdated: false }],
    [901, { threadId: 'PRRT_a', resolved: false, outdated: false }],
    [902, { threadId: 'PRRT_b', resolved: true, outdated: false }],
    [903, { threadId: 'PRRT_c', resolved: false, outdated: true }],
  ]);

  const mapped = mapComments({
    files,
    threads,
    issueComments: [
      {
        id: 500,
        user: { login: 'jdoe', type: 'User' },
        body: 'Deploying the migration first.',
        html_url: 'https://github.com/northwind-labs/tenant-platform/pull/7#issuecomment-500',
        created_at: '2026-09-08T09:00:00Z',
      },
    ],
    reviewComments: [
      reviewComment(),
      reviewComment({ id: 901, in_reply_to_id: 900, body: 'Last-write-wins is fine.' }),
      reviewComment({
        id: 902,
        user: { login: 'cursor[bot]', type: 'Bot' },
        body: '### Empty mask\n\n**Low Severity**\n\nAn empty update mask validates every path.',
      }),
      reviewComment({ id: 903, line: null, original_line: 92 }),
    ],
  });

  it('places the comments of live threads and leaves the outdated one unplaced', () => {
    expect(mapped.comments.map((comment) => [comment.id, comment.hunkId])).toEqual([
      ['c900', 'f1.h1'],
      ['c901', 'f1.h1'],
      ['c902', 'f1.h1'],
      ['c903', null],
    ]);
  });

  it('keeps the line of an outdated comment for the outdated list', () => {
    expect(mapped.comments[3]?.line).toBe(92);
  });

  it('gives a reply the thread of the comment it answers', () => {
    expect(mapped.comments[0]?.threadId).toBe('PRRT_a');
    expect(mapped.comments[1]?.threadId).toBe('PRRT_a');
  });

  it('takes resolution from the thread, not the comment', () => {
    expect(mapped.comments.map((comment) => comment.resolved)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it('parses a severity for a bot and none for a person', () => {
    expect(mapped.comments[2]?.severity).toBe('low');
    expect(mapped.comments[0]?.severity).toBeNull();
  });

  it('keeps a top-level comment in the conversation list with no place in the diff', () => {
    expect(mapped.conversation).toEqual([
      {
        id: 'ic500',
        source: { kind: 'human', name: 'jdoe' },
        author: 'jdoe',
        path: null,
        line: null,
        side: null,
        hunkId: null,
        body: 'Deploying the migration first.',
        url: 'https://github.com/northwind-labs/tenant-platform/pull/7#issuecomment-500',
        createdAt: '2026-09-08T09:00:00Z',
        resolved: false,
        severity: null,
      },
    ]);
  });

  it('counts what was placed, what was not, and the threads', () => {
    expect(commentStats(mapped)).toEqual({
      total: 4,
      placed: 3,
      outdated: 1,
      threads: 3,
      resolvedThreads: 1,
      conversation: 1,
    });
  });

  it('falls back to the reply chain when the thread query returned nothing', () => {
    const noThreads = mapComments({
      files,
      threads: new Map(),
      issueComments: [],
      reviewComments: [reviewComment(), reviewComment({ id: 901, in_reply_to_id: 900 })],
    });
    expect(noThreads.comments.map((comment) => comment.threadId)).toEqual(['t900', 't900']);
    expect(noThreads.comments.every((comment) => !comment.resolved)).toBe(true);
  });

  it('keeps a file-level review comment out of the diff and keeps its path', () => {
    const fileLevel = mapComments({
      files,
      threads: new Map(),
      issueComments: [],
      reviewComments: [
        reviewComment({ id: 904, line: null, original_line: null, subject_type: 'file' }),
      ],
    });
    expect(fileLevel.comments).toEqual([]);
    expect(fileLevel.conversation[0]?.path).toBe('api/service/tenant/record.go');
  });
});

describe('threadsByComment', () => {
  it('joins every comment of every thread to its thread', () => {
    const page = {
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
                  comments: { nodes: [{ databaseId: 900 }, { databaseId: 901 }] },
                },
                {
                  id: 'PRRT_b',
                  isResolved: false,
                  isOutdated: true,
                  comments: { nodes: [{ databaseId: 902 }] },
                },
              ],
            },
          },
        },
      },
    };

    const threads = threadsByComment([page]);
    expect(threads.get(900)).toEqual({ threadId: 'PRRT_a', resolved: true, outdated: false });
    expect(threads.get(901)?.threadId).toBe('PRRT_a');
    expect(threads.get(902)).toEqual({ threadId: 'PRRT_b', resolved: false, outdated: true });
    expect(threads.get(903)).toBeUndefined();
  });

  it('reads every page of a paginated answer', () => {
    const page = (id: string, databaseId: number) => ({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                { id, isResolved: false, isOutdated: false, comments: { nodes: [{ databaseId }] } },
              ],
            },
          },
        },
      },
    });
    const threads = threadsByComment([page('PRRT_a', 1), page('PRRT_b', 2)]);
    expect([...threads.keys()]).toEqual([1, 2]);
  });

  it('is empty for an answer with no threads', () => {
    expect(threadsByComment([{ data: { repository: { pullRequest: null } } }]).size).toBe(0);
  });
});
