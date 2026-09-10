import { useCallback, useEffect, useRef, useState } from 'react';
import type { Draft, DraftsFile, PrInfo } from '@review-cockpit/schema';
import type { CockpitDraft, DraftsContent } from './drafts';
import { draftsFileOf, draftsOf, loadDraftsFile, saveDrafts } from './drafts';

export const DRAFTS_URL = '/api/drafts';
export const SAVE_DEBOUNCE_MS = 300;

export function contentOf(file: DraftsFile): DraftsContent {
  return {
    drafts: draftsOf(file.drafts),
    verdict: file.verdict,
    summaryBody: file.summaryBody,
    updatedAt: file.updatedAt ?? null,
  };
}

export function emptyContent(): DraftsContent {
  return { drafts: [], verdict: null, summaryBody: '', updatedAt: null };
}

/**
 * Which of the two copies was written last. A copy with no write time has never
 * been written, so it loses to one that has.
 */
export function newerCopy(local: string | null, server: string | null): 'local' | 'server' {
  if (server === null) return 'local';
  if (local === null) return 'server';
  return local > server ? 'local' : 'server';
}

export interface Reconciled {
  /** The copy to work from. */
  use: DraftsContent;
  /** Whether the local copy has to be sent, because the server's is older. */
  replay: boolean;
}

/**
 * The drafts the cockpit works from, and whether the server needs catching up.
 * The two copies are ordered by one clock: the server stamps every write and
 * answers with what it stored, and the cockpit keeps that stamp in browser
 * storage, so a reload compares two times from the same source.
 */
export function reconcileDrafts(
  local: DraftsContent | null,
  server: DraftsContent | null,
): Reconciled {
  if (server === null) return { use: local ?? emptyContent(), replay: local !== null };
  if (local === null) return { use: server, replay: false };
  return newerCopy(local.updatedAt, server.updatedAt) === 'local'
    ? { use: local, replay: true }
    : { use: server, replay: false };
}

export interface Debounced {
  schedule(): void;
  cancel(): void;
}

/** Runs the last call after the delay and drops the calls it superseded. */
export function debounce(run: () => void, delayMs: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(): void {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

export interface DraftsStore extends DraftsContent {
  /** Drafts a re-analysis could not place in the new diff. */
  orphaned: Draft[];
  setDrafts(next: (current: CockpitDraft[]) => CockpitDraft[]): void;
  setVerdict(verdict: DraftsFile['verdict']): void;
  setSummaryBody(body: string): void;
  clear(): void;
}

export interface DraftsSyncOptions {
  pr: PrInfo;
  storageKey: string;
  /** False for a fixture, which has no server to talk to. */
  toServer: boolean;
  disconnected: boolean;
  /** Bumped when the document changed, which is when a re-analysis may have moved drafts. */
  documentRevision: number;
}

/**
 * Holds the drafts, the verdict and the review body, keeps browser storage in
 * step on every change and the server in step on a debounce. Browser storage is
 * written first, because it is the copy that survives a server that is not there.
 */
export function useDraftsSync(options: DraftsSyncOptions): DraftsStore {
  const { pr, storageKey, toServer, disconnected, documentRevision } = options;
  const [content, setContent] = useState<DraftsContent>(() => {
    const stored = loadDraftsFile(storageKey);
    return stored === null ? emptyContent() : contentOf(stored);
  });
  const [orphaned, setOrphaned] = useState<Draft[]>([]);

  const live = useRef(true);
  const revision = useRef(0);
  const current = useRef(content);
  current.current = content;

  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  const adopt = useCallback(
    (next: DraftsContent) => {
      setContent(next);
      current.current = next;
      saveDrafts(storageKey, draftsFileOf(pr, next));
    },
    [pr, storageKey],
  );

  const send = useCallback(async (): Promise<void> => {
    const at = revision.current;
    try {
      const response = await fetch(DRAFTS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftsFileOf(pr, current.current)),
      });
      if (!response.ok) return;
      const stored = (await response.json()) as DraftsFile;
      // A change that landed while the request was in flight already carries a
      // later time, and adopting this one would age it.
      if (live.current && revision.current === at && stored.updatedAt !== undefined) {
        adopt({ ...current.current, updatedAt: stored.updatedAt });
      }
    } catch {
      // The connection-lost banner says what happened. The next change, or the
      // reconnect, sends this again.
    }
  }, [adopt, pr]);

  const sendRef = useRef(send);
  sendRef.current = send;

  const saver = useRef<Debounced | null>(null);
  saver.current ??= debounce(() => void sendRef.current(), SAVE_DEBOUNCE_MS);
  useEffect(() => () => saver.current?.cancel(), []);

  const change = useCallback(
    (next: DraftsContent) => {
      revision.current += 1;
      adopt({ ...next, updatedAt: new Date().toISOString() });
      if (toServer) saver.current?.schedule();
    },
    [adopt, toServer],
  );

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(DRAFTS_URL, { cache: 'no-store' });
      if (!response.ok) return;
      const file = (await response.json()) as DraftsFile;
      if (!live.current) return;
      setOrphaned(draftsOf(file.orphaned ?? []));
      const reconciled = reconcileDrafts(current.current, contentOf(file));
      if (reconciled.replay) void sendRef.current();
      else adopt(reconciled.use);
    } catch {
      // Nothing to reconcile with, so the local copy stands.
    }
  }, [adopt]);

  useEffect(() => {
    if (!toServer) return;
    void load();
  }, [toServer, load, documentRevision]);

  const wasDisconnected = useRef(disconnected);
  useEffect(() => {
    const reconnected = wasDisconnected.current && !disconnected;
    wasDisconnected.current = disconnected;
    if (toServer && reconnected) void load();
  }, [disconnected, toServer, load]);

  return {
    ...content,
    orphaned,
    setDrafts: useCallback(
      (next) => change({ ...current.current, drafts: next(current.current.drafts) }),
      [change],
    ),
    setVerdict: useCallback((verdict) => change({ ...current.current, verdict }), [change]),
    setSummaryBody: useCallback(
      (summaryBody) => change({ ...current.current, summaryBody }),
      [change],
    ),
    clear: useCallback(() => {
      setOrphaned([]);
      change(emptyContent());
    }, [change]),
  };
}
