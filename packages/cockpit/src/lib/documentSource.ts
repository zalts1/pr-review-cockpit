import { useEffect, useState } from 'react';
import type { ReviewDocument } from '@review-cockpit/schema';
import type { Connection, ConnectionEvent } from './connection.js';
import { hasGivenUp, initialConnection, nextConnection, shutdownReasonOf } from './connection.js';

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
  connection: Connection;
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
  const [connection, setConnection] = useState<Connection>(initialConnection);
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

    const advance = (incoming: ConnectionEvent) => {
      setConnection((current) => {
        const next = nextConnection(current, incoming);
        // Nothing is coming back, so the stream is closed rather than left retrying for
        // the life of the tab.
        if (hasGivenUp(next)) events.close();
        return next;
      });
    };

    events.onopen = () => advance({ kind: 'open' });
    // EventSource reconnects on its own, so an error means the stream is down for now, not
    // for good; readyState says whether it has already come back.
    events.onerror = () => {
      if (events.readyState !== EventSource.OPEN) advance({ kind: 'failed' });
    };
    events.onmessage = (event) => {
      const shutdown = shutdownReasonOf(event.data);
      if (shutdown !== null) {
        advance({ kind: 'shutdown', reason: shutdown });
        return;
      }
      if (isDocumentEvent(event.data)) reload();
    };
    // A server that names the event sends it to this listener instead of onmessage.
    events.addEventListener('document', reload);

    return () => {
      live = false;
      events.close();
    };
  }, [source]);

  return { load, connection, revision };
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
