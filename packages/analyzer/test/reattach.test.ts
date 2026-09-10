import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Draft, DraftsFile, ReviewDocument } from '@review-cockpit/schema';
import { SCHEMA_VERSION } from '@review-cockpit/schema/version';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDiff } from '../src/diff.js';
import { reattachDrafts, reattachStoredDrafts } from '../src/reattach.js';

const OLD_HEAD = 'a'.repeat(40);
const NEW_HEAD = 'b'.repeat(40);
const NOW = '2026-09-10T12:00:00Z';

/** Only paths, lines and the head sha are read, so the rest of the document is left out. */
function documentOf(diff: string, headSha: string): ReviewDocument {
  const files = parseDiff(diff).map((file, index) => ({
    id: `f${index + 1}`,
    path: file.path,
    hunks: file.hunks.map((hunk, at) => ({ id: `f${index + 1}.h${at + 1}`, lines: hunk.lines })),
  }));
  return { pr: { head: { sha: headSha } }, files } as unknown as ReviewDocument;
}

const BEFORE = `diff --git a/ledger/ledger.go b/ledger/ledger.go
--- a/ledger/ledger.go
+++ b/ledger/ledger.go
@@ -10,7 +10,9 @@ package ledger
 func Add(entries []Entry, e Entry) ([]Entry, error) {
 	if e.ID == "" {
 		return nil, ErrEmptyID
 	}
+	if e.Weight < 0 {
+		return nil, ErrNegative
+	}
 	return append(entries, e), nil
 }
`;

/** One line added above the drafted lines, so everything below it shifts by one. */
const SHIFTED = `diff --git a/ledger/ledger.go b/ledger/ledger.go
--- a/ledger/ledger.go
+++ b/ledger/ledger.go
@@ -10,7 +10,10 @@ package ledger
 func Add(entries []Entry, e Entry) ([]Entry, error) {
+	defer trace("Add")
 	if e.ID == "" {
 		return nil, ErrEmptyID
 	}
+	if e.Weight < 0 {
+		return nil, ErrNegative
+	}
 	return append(entries, e), nil
 }
`;

/** The drafted line is gone from the new head. */
const DELETED = `diff --git a/ledger/ledger.go b/ledger/ledger.go
--- a/ledger/ledger.go
+++ b/ledger/ledger.go
@@ -10,7 +10,8 @@ package ledger
 func Add(entries []Entry, e Entry) ([]Entry, error) {
 	if e.ID == "" {
 		return nil, ErrEmptyID
 	}
+	if e.Weight < 0 {
+		return nil, ErrOverloaded
+	}
 	return append(entries, e), nil
 }
`;

const RENAMED = `diff --git a/ledger/entries.go b/ledger/entries.go
--- a/ledger/entries.go
+++ b/ledger/entries.go
@@ -10,7 +10,9 @@ package ledger
 func Add(entries []Entry, e Entry) ([]Entry, error) {
 	if e.ID == "" {
 		return nil, ErrEmptyID
 	}
+	if e.Weight < 0 {
+		return nil, ErrNegative
+	}
 	return append(entries, e), nil
 }
`;

function draft(over: Partial<Draft> = {}): Draft {
  return {
    id: 'd1',
    path: 'ledger/ledger.go',
    line: 14,
    side: 'RIGHT',
    startLine: null,
    startSide: null,
    body: 'Return the weight in the error.',
    commitId: OLD_HEAD,
    createdAt: '2026-09-10T11:00:00Z',
    updatedAt: '2026-09-10T11:00:00Z',
    ...over,
  };
}

function reattach(drafts: Draft[], to: string): ReturnType<typeof reattachDrafts> {
  return reattachDrafts({
    drafts,
    previous: documentOf(BEFORE, OLD_HEAD),
    fresh: documentOf(to, NEW_HEAD),
    headSha: NEW_HEAD,
    now: NOW,
  });
}

describe('reattachDrafts', () => {
  it('keeps a draft whose line is untouched, on the new commit', () => {
    const result = reattach([draft()], BEFORE);
    expect(result.orphaned).toEqual([]);
    expect(result.kept[0]).toMatchObject({ line: 14, commitId: NEW_HEAD, updatedAt: NOW });
  });

  it('follows a line the new commits shifted', () => {
    const result = reattach([draft()], SHIFTED);
    expect(result.orphaned).toEqual([]);
    expect(result.kept[0]?.line).toBe(15);
  });

  it('orphans a draft whose line the new commits deleted', () => {
    const result = reattach([draft({ line: 15 })], DELETED);
    expect(result.kept).toEqual([]);
    expect(result.orphaned.map((d) => d.id)).toEqual(['d1']);
  });

  it('orphans a draft whose file was renamed out from under it', () => {
    const result = reattach([draft()], RENAMED);
    expect(result.kept).toEqual([]);
    expect(result.orphaned.map((d) => d.id)).toEqual(['d1']);
  });

  it('moves a multi-line draft as one block', () => {
    const result = reattach([draft({ line: 15, startLine: 13, startSide: 'RIGHT' })], SHIFTED);
    expect(result.kept[0]).toMatchObject({ startLine: 14, line: 16 });
  });

  it('orphans a multi-line draft when only one end survived', () => {
    const result = reattach([draft({ line: 15, startLine: 11, startSide: 'RIGHT' })], DELETED);
    expect(result.orphaned.map((d) => d.id)).toEqual(['d1']);
  });

  it('keeps a draft on a deleted line by its position on the left side', () => {
    const left = draft({ id: 'd2', line: 11, side: 'LEFT', startLine: null, startSide: null });
    const result = reattach([left], SHIFTED);
    expect(result.kept[0]).toMatchObject({ id: 'd2', line: 11, side: 'LEFT' });
  });

  it('matches by position alone when there is no cached document to read the text from', () => {
    const result = reattachDrafts({
      drafts: [draft(), draft({ id: 'd2', line: 400 })],
      previous: null,
      fresh: documentOf(SHIFTED, NEW_HEAD),
      headSha: NEW_HEAD,
      now: NOW,
    });
    expect(result.kept.map((d) => d.id)).toEqual(['d1']);
    expect(result.orphaned.map((d) => d.id)).toEqual(['d2']);
  });
});

describe('reattachStoredDrafts', () => {
  let cache: string;
  const ref = { owner: 'northwind-labs', repo: 'tenant-platform', number: 7 };

  beforeEach(() => {
    cache = mkdtempSync(join(tmpdir(), 'review-cockpit-reattach-'));
    process.env['REVIEW_COCKPIT_CACHE'] = cache;
    mkdirSync(join(cache, ref.owner, ref.repo, `pr-${ref.number}`), { recursive: true });
  });

  afterEach(() => {
    delete process.env['REVIEW_COCKPIT_CACHE'];
    rmSync(cache, { recursive: true, force: true });
  });

  function prPath(name: string): string {
    return join(cache, ref.owner, ref.repo, `pr-${ref.number}`, name);
  }

  function writeDrafts(drafts: Draft[]): void {
    const file: DraftsFile = {
      schemaVersion: SCHEMA_VERSION,
      pr: ref,
      verdict: 'COMMENT',
      summaryBody: 'One thing.',
      drafts,
      updatedAt: '2026-09-10T11:00:00Z',
    };
    writeFileSync(prPath('drafts.json'), JSON.stringify(file), 'utf8');
  }

  function read(name: string): DraftsFile {
    return JSON.parse(readFileSync(prPath(name), 'utf8')) as DraftsFile;
  }

  it('splits the stored drafts into the ones that still fit and the ones that do not', () => {
    writeDrafts([draft(), draft({ id: 'd2', line: 15 })]);
    const outcome = reattachStoredDrafts(
      ref,
      documentOf(BEFORE, OLD_HEAD),
      documentOf(DELETED, NEW_HEAD),
      NOW,
    );

    expect(outcome).toEqual({ kind: 'done', kept: 1, orphaned: 1 });
    expect(read('drafts.json').drafts.map((d) => [d.id, d.line, d.commitId])).toEqual([
      ['d1', 14, NEW_HEAD],
    ]);
    expect(read('drafts.orphaned.json').drafts.map((d) => d.id)).toEqual(['d2']);
    expect(read('drafts.json').summaryBody).toBe('One thing.');
  });

  it('clears an earlier orphan list once every draft fits again', () => {
    writeDrafts([draft()]);
    writeFileSync(
      prPath('drafts.orphaned.json'),
      JSON.stringify({ ...read('drafts.json'), drafts: [draft({ id: 'd2', line: 14 })] }),
      'utf8',
    );
    const outcome = reattachStoredDrafts(
      ref,
      documentOf(BEFORE, OLD_HEAD),
      documentOf(SHIFTED, NEW_HEAD),
      NOW,
    );

    expect(outcome).toEqual({ kind: 'done', kept: 1, orphaned: 0 });
    expect(existsSync(prPath('drafts.orphaned.json'))).toBe(false);
  });

  it('leaves the drafts alone when the head has not moved', () => {
    writeDrafts([draft()]);
    const outcome = reattachStoredDrafts(
      ref,
      documentOf(BEFORE, OLD_HEAD),
      documentOf(SHIFTED, OLD_HEAD),
      NOW,
    );
    expect(outcome).toEqual({
      kind: 'skipped',
      why: 'the head has not moved since the drafts were written',
    });
    expect(read('drafts.json').drafts[0]?.line).toBe(14);
  });

  it('says so when the pull request has no drafts', () => {
    const outcome = reattachStoredDrafts(
      ref,
      documentOf(BEFORE, OLD_HEAD),
      documentOf(SHIFTED, NEW_HEAD),
      NOW,
    );
    expect(outcome.kind).toBe('skipped');
  });
});
