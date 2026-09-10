import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Comment, ReviewDocument } from '@review-cockpit/schema';
import { derive, threadsOf } from '../src/lib/derive';
import { description } from '../src/lib/prBody';

function fixture(name: string): ReviewDocument {
  const path = fileURLToPath(new URL(`../../../fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as ReviewDocument;
}

const doc = fixture('pr-fake-1');
const derived = derive(doc);

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    source: { kind: 'human', name: 'danat' },
    author: 'danat',
    path: 'api/service/tenant/record.go',
    line: 101,
    side: 'RIGHT',
    hunkId: 'f7.h2',
    body: 'Is last-write-wins acceptable?',
    url: 'https://github.com/northwind-labs/tenant-platform/pull/1234#discussion_r1',
    createdAt: '2026-09-08T10:00:00Z',
    resolved: false,
    severity: null,
    ...over,
  };
}

describe('threadsOf', () => {
  it('groups replies under the comment that opened the thread', () => {
    const threads = threadsOf([
      comment({ id: 'c2', threadId: 't1', createdAt: '2026-09-08T11:00:00Z' }),
      comment({ id: 'c1', threadId: 't1', createdAt: '2026-09-08T10:00:00Z' }),
      comment({ id: 'c3', threadId: 't2' }),
    ]);

    expect(threads.map((thread) => [thread.id, thread.root.id, thread.replies.length])).toEqual([
      ['t1', 'c1', 1],
      ['t2', 'c3', 0],
    ]);
  });

  it('treats a comment with no thread id as its own thread', () => {
    const threads = threadsOf([comment({ id: 'c1' }), comment({ id: 'c2' })]);
    expect(threads.map((thread) => thread.id)).toEqual(['c1', 'c2']);
  });

  it('is resolved when the thread is resolved', () => {
    const threads = threadsOf([
      comment({ id: 'c1', threadId: 't1', resolved: true }),
      comment({ id: 'c2', threadId: 't1', resolved: true }),
    ]);
    expect(threads[0]?.resolved).toBe(true);
  });
});

describe('the fixture as the cockpit reads it', () => {
  it('shows the two-comment thread as one chip with one reply', () => {
    const threads = derived.threadsByHunk.get('f7.h2') ?? [];
    const thread = threads.find((held) => held.id === 'PRRT_2');
    expect(thread?.replies).toHaveLength(1);
    expect(thread?.resolved).toBe(false);
  });

  it('dims the resolved thread and keeps its answer', () => {
    const threads = derived.threadsByHunk.get('f9.h1') ?? [];
    expect(threads).toHaveLength(1);
    expect(threads[0]?.resolved).toBe(true);
    expect(threads[0]?.replies).toHaveLength(1);
  });

  it('lists the comment outside the diff as outdated', () => {
    expect(derived.outdatedComments.map((held) => held.id)).toEqual(['c21']);
  });
});

describe('description', () => {
  it('drops the bot summary block the header pill already shows', () => {
    const shown = description(doc.pr.body);
    expect(doc.pr.body).toContain('CURSOR_SUMMARY');
    expect(shown).not.toContain('CURSOR_SUMMARY');
    expect(shown).not.toContain('Medium Risk');
    expect(shown).toContain('## What');
  });

  it('leaves a body with no block alone', () => {
    expect(description('## What\n\nA plain description.')).toBe('## What\n\nA plain description.');
  });

  it('leaves an unterminated block alone, because its end is unknown', () => {
    const body = '## What\n\n<!-- CURSOR_SUMMARY -->\n> [!NOTE]\n> **Low Risk**';
    expect(description(body)).toBe(body);
  });
});
