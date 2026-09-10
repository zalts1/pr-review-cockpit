import { useEffect, useState } from 'react';
import type { ReviewDocument } from '@review-cockpit/schema';

const DEFAULT_FIXTURE = 'pr-fake-1';
const DOCUMENT_URL = '/api/document';
const EVENTS_URL = '/api/events';

export type DocumentSource =
  | { mode: 'fixture'; fixture: string }
  | { mode: 'server' };

export type DocumentLoad =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; doc: ReviewDocument };

export interface DocumentState {
  load: DocumentLoad;
  disconnected: boolean;
  /** Counts the documents this page has read, so a reader can act on a re-analysis. */
  revision: number;
}

export function sourceFromSearch(search: string): DocumentSource {
  const fixture = new URLSearchParams(search).get('fixture');
  if (fixture === null) return { mode: 'server' };
  return { mode: 'fixture', fixture: fixture || DEFAULT_FIXTURE };
}

export const documentSource = sourceFromSearch(window.location.search);

export function documentUrlOf(source: DocumentSource): string {
  return source.mode === 'fixture' ? `./fixtures/${source.fixture}.json` : DOCUMENT_URL;
}

/** Keys browser storage so the two modes never read each other's drafts. */
export function storageSourceOf(source: DocumentSource): string {
  return source.mode === 'fixture' ? source.fixture : 'server';
}

export function useDocumentSource(source: DocumentSource): DocumentState {
  const [load, setLoad] = useState<DocumentLoad>({ kind: 'loading' });
  const [disconnected, setDisconnected] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const url = documentUrlOf(source);
    let live = true;

    const read = async () => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const doc = (await response.json()) as ReviewDocument;
        if (live) {
          setLoad({ kind: 'ready', doc });
          setRevision((current) => current + 1);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const message =
          source.mode === 'server' ? `GET ${url} failed: ${detail}.` : `${url}: ${detail}`;
        // A failed re-read leaves the document on screen, because tearing the cockpit
        // down would lose the drafts and progress the reviewer has built up.
        if (live) {
          setLoad((current) => (current.kind === 'ready' ? current : { kind: 'error', message }));
        }
      }
    };

    void read();
    if (source.mode === 'fixture') {
      return () => {
        live = false;
      };
    }

    const reload = () => void read();
    const events = new EventSource(EVENTS_URL);
    events.onopen = () => setDisconnected(false);
    // EventSource reconnects on its own, so an error means the stream is down for now,
    // not for good; readyState says whether it has already come back.
    events.onerror = () => setDisconnected(events.readyState !== EventSource.OPEN);
    events.onmessage = (event) => {
      if (isDocumentEvent(event.data)) reload();
    };
    // A server that names the event sends it to this listener instead of onmessage.
    events.addEventListener('document', reload);

    return () => {
      live = false;
      events.close();
    };
  }, [source]);

  return { load, disconnected, revision };
}

function isDocumentEvent(data: unknown): boolean {
  if (typeof data !== 'string') return false;
  try {
    const parsed = JSON.parse(data) as { type?: unknown } | null;
    return parsed?.type === 'document';
  } catch {
    return false;
  }
}
