import type { Draft, DraftsFile } from '@review-cockpit/schema';
import { SCHEMA_VERSION } from '@review-cockpit/schema/version';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftsContent } from '../src/lib/drafts';
import { lineOwners, placeDrafts } from '../src/lib/drafts';
import {
  contentOf,
  debounce,
  emptyContent,
  newerCopy,
  reconcileDrafts,
  SAVE_DEBOUNCE_MS,
} from '../src/lib/draftsSync';

const EARLIER = '2026-09-10T12:00:00.000Z';
const LATER = '2026-09-10T12:05:00.000Z';

function draft(over: Partial<Draft> = {}): Draft {
  return {
    id: 'd1',
    path: 'ledger/ledger.go',
    line: 14,
    side: 'RIGHT',
    startLine: null,
    startSide: null,
    body: 'Return the weight in the error.',
    commitId: 'a'.repeat(40),
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...over,
  };
}

function file(over: Partial<DraftsFile> = {}): DraftsFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    pr: { owner: 'northwind-labs', repo: 'tenant-platform', number: 7 },
    verdict: null,
    summaryBody: '',
    drafts: [draft()],
    ...over,
  };
}

function content(over: Partial<DraftsContent> = {}): DraftsContent {
  return { ...contentOf(file()), ...over };
}

describe('newerCopy', () => {
  it('prefers the later write time', () => {
    expect(newerCopy(LATER, EARLIER)).toBe('local');
    expect(newerCopy(EARLIER, LATER)).toBe('server');
  });

  it('treats a copy that was never written as the older one', () => {
    expect(newerCopy(null, EARLIER)).toBe('server');
    expect(newerCopy(EARLIER, null)).toBe('local');
  });

  it('leaves an equal time with the server, which stamped it', () => {
    expect(newerCopy(EARLIER, EARLIER)).toBe('server');
  });
});

describe('reconcileDrafts', () => {
  it('takes the server copy when it is the newer one', () => {
    const server = content({ updatedAt: LATER, summaryBody: 'From the server.' });
    const result = reconcileDrafts(content({ updatedAt: EARLIER }), server);
    expect(result).toEqual({ use: server, replay: false });
  });

  it('replays the local copy when the server copy is older', () => {
    const local = content({ updatedAt: LATER, drafts: [] });
    const result = reconcileDrafts(local, content({ updatedAt: EARLIER }));
    expect(result).toEqual({ use: local, replay: true });
  });

  it('replays the local copy when the server holds nothing', () => {
    const local = content({ updatedAt: EARLIER });
    const result = reconcileDrafts(local, contentOf(file({ drafts: [] })));
    expect(result).toEqual({ use: local, replay: true });
  });

  it('takes the server copy when browser storage holds nothing', () => {
    const server = content({ updatedAt: EARLIER });
    expect(reconcileDrafts(null, server)).toEqual({ use: server, replay: false });
  });

  it('keeps the local copy when the server did not answer', () => {
    const local = content({ updatedAt: EARLIER });
    expect(reconcileDrafts(local, null)).toEqual({ use: local, replay: true });
  });

  it('starts empty when neither copy exists', () => {
    expect(reconcileDrafts(null, null)).toEqual({ use: emptyContent(), replay: false });
  });

  it('reads a submitted-and-cleared server file as the newer, empty copy', () => {
    const local = content({ updatedAt: EARLIER });
    const server = contentOf(file({ drafts: [], updatedAt: LATER }));
    const result = reconcileDrafts(local, server);
    expect(result.replay).toBe(false);
    expect(result.use.drafts).toEqual([]);
  });
});

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs once for a burst of changes, after the delay', () => {
    const run = vi.fn();
    const saver = debounce(run, SAVE_DEBOUNCE_MS);

    saver.schedule();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 50);
    saver.schedule();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 50);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs again for a change after the last save', () => {
    const run = vi.fn();
    const saver = debounce(run, SAVE_DEBOUNCE_MS);
    saver.schedule();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    saver.schedule();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('drops a save the caller cancelled', () => {
    const run = vi.fn();
    const saver = debounce(run, SAVE_DEBOUNCE_MS);
    saver.schedule();
    saver.cancel();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('placeDrafts', () => {
  it('moves a draft under the hunk that now holds its line', () => {
    const files = [
      {
        id: 'f1',
        path: 'ledger/ledger.go',
        hunks: [
          {
            id: 'f1.h1',
            lines: [
              { type: 'context', oldNo: 13, newNo: 13, text: '}' },
              { type: 'add', oldNo: null, newNo: 14, text: 'if e.Weight < 0 {' },
            ],
          },
        ],
      },
    ] as unknown as Parameters<typeof lineOwners>[0];

    const stale = { ...draft(), fileId: 'f9', hunkId: 'f9.h4' };
    expect(placeDrafts([stale], lineOwners(files))[0]).toMatchObject({
      fileId: 'f1',
      hunkId: 'f1.h1',
    });
  });

  it('leaves a draft alone when no hunk holds its line', () => {
    const stale = { ...draft(), line: 900, fileId: 'f9', hunkId: 'f9.h4' };
    expect(placeDrafts([stale], new Map())[0]).toMatchObject({ hunkId: 'f9.h4' });
  });
});
