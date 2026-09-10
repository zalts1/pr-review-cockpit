import { join } from 'node:path';
import type { IngestResult } from '@review-cockpit/analyzer';
import { ingest, nowIso, readDocument, status, writeDocument } from '@review-cockpit/analyzer';
import type { PrInfo, ReviewFile } from '@review-cockpit/schema';
import { DOCUMENT_FILENAME } from './paths.js';

/** Injected so a test reaches no network; the default is the analyzer's stage 1 ingestion. */
export type IngestFn = (options: { pr: PrInfo; files: readonly ReviewFile[] }) => IngestResult;

export interface RefreshCounts {
  refreshedAt: string;
  comments: number;
  conversation: number;
  checks: number;
  commentsError: string | null;
  checksError: string | null;
}

export type RefreshBody =
  | RefreshCounts
  | { code: 'no_document'; message: string }
  | { code: 'refresh_failed'; message: string };

export interface RefreshOutcome {
  status: number;
  body: RefreshBody;
}

/**
 * Re-reads the comments and the checks from GitHub and rewrites the document, so a review
 * the reviewer just posted comes back as pinned threads. Nothing else in the document is
 * touched: the diff, the risk and the judgment belong to the analysis, not to this fetch.
 */
export function refreshFromGitHub(prDir: string, ingestFn: IngestFn = ingest): RefreshOutcome {
  const documentPath = join(prDir, DOCUMENT_FILENAME);
  let document;
  try {
    document = readDocument(documentPath);
  } catch {
    return {
      status: 503,
      body: {
        code: 'no_document',
        message:
          'There is no analysed review document for this pull request, so there is nothing to refresh. Run cockpit analyze first.',
      },
    };
  }

  const fetched = ingestFn({ pr: document.pr, files: document.files });
  const at = nowIso();

  if (fetched.commentsError === null) {
    document.comments = fetched.comments;
    document.conversation = fetched.conversation;
    document.status.comments = status('ready', at);
  } else {
    document.status.comments = status(
      'failed',
      at,
      `existing comments could not be read: ${fetched.commentsError}`,
    );
  }

  if (fetched.checksError === null) {
    document.checks = fetched.checks;
    document.status.checks = status('ready', at);
  } else {
    document.status.checks = status('failed', at, `check runs could not be read: ${fetched.checksError}`);
  }

  writeDocument(documentPath, document);

  return {
    status: 200,
    body: {
      refreshedAt: at,
      comments: document.comments.length,
      conversation: (document.conversation ?? []).length,
      checks: document.checks.length,
      commentsError: fetched.commentsError,
      checksError: fetched.checksError,
    },
  };
}
