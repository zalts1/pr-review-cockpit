import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import type { DraftsFile } from '@review-cockpit/schema';
import { validateDrafts } from '@review-cockpit/schema';
import { readDrafts, readOrphanedDrafts, writeDrafts } from './drafts.js';
import { DocumentWatcher, EventStreamHub } from './events.js';
import { DOCUMENT_FILENAME } from './paths.js';
import type { IngestFn, RefreshOutcome } from './refresh.js';
import { refreshFromGitHub } from './refresh.js';
import { removeServerFile, writeServerFile } from './server-file.js';
import type { GhCommand, Verdict } from './submit.js';
import { ghCommand, submitReview, VERDICTS } from './submit.js';
import { resolveUiHtmlPath } from './ui-path.js';

export {
  DOCUMENT_FILENAME,
  DRAFTS_FILENAME,
  ORPHANED_DRAFTS_FILENAME,
  SERVER_FILENAME,
} from './paths.js';
export {
  emptyDrafts,
  prIdentity,
  readDrafts,
  readOrphanedDrafts,
  rotateSubmittedDrafts,
  submittedDraftsFilename,
  writeDrafts,
} from './drafts.js';
export { ghCommand, reviewPayload, submitReview, VERDICTS } from './submit.js';
export type {
  GhCommand,
  GhResult,
  ReviewPayload,
  SubmitBody,
  SubmitOutcome,
  Verdict,
} from './submit.js';
export { refreshFromGitHub } from './refresh.js';
export type { IngestFn, RefreshBody, RefreshCounts, RefreshOutcome } from './refresh.js';
export { readServerFile, removeServerFile, serverIsAlive, writeServerFile } from './server-file.js';
export { resolveUiHtmlPath, UI_PATH_ENV_VAR } from './ui-path.js';
export type { ServerFile } from './server-file.js';

/** A drafts file larger than this is a bug or a paste of the whole diff, not a review. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface ServerOptions {
  prDir: string;
  port?: number;
  uiPath?: string;
  /** Injected so a test posts nothing; the default runs the gh command line. */
  gh?: GhCommand;
  /** Injected so a test reaches no network; the default is the analyzer's ingestion. */
  ingest?: IngestFn;
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

interface RequestContext {
  prDir: string;
  uiPath: string | undefined;
  hub: EventStreamHub;
  startedAt: number;
  port: number;
  gh: GhCommand;
  ingest: IngestFn | undefined;
}

const ROUTE_METHODS: Record<string, string[]> = {
  '/': ['GET'],
  '/api/document': ['GET'],
  '/api/events': ['GET'],
  '/api/health': ['GET'],
  '/api/drafts': ['GET', 'PUT'],
  '/api/submit': ['POST'],
  '/api/refresh': ['POST'],
  '/api/ask': ['POST'],
};

const NOT_IMPLEMENTED: Record<string, { milestone: string; what: string }> = {
  '/api/ask': { milestone: 'post-v1', what: 'asking the agent a question from the cockpit' },
};

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const prDir = resolve(options.prDir);
  await mkdir(prDir, { recursive: true });

  const watcher = new DocumentWatcher(prDir);
  const context: RequestContext = {
    prDir,
    uiPath: options.uiPath,
    hub: new EventStreamHub(prDir, watcher),
    startedAt: Date.now(),
    port: 0,
    gh: options.gh ?? ghCommand,
    ingest: options.ingest,
  };

  const server = createServer((req, res) => {
    void handle(req, res, context).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'The local server failed to handle the request.' });
      res.end();
    });
  });

  await new Promise<void>((listening, failed) => {
    server.once('error', failed);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.removeListener('error', failed);
      listening();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The local server did not bind to a TCP port.');
  }
  context.port = address.port;
  const url = `http://127.0.0.1:${address.port}`;

  await writeServerFile(prDir, {
    port: address.port,
    pid: process.pid,
    url,
    startedAt: new Date(context.startedAt).toISOString(),
  });

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      context.hub.close();
      watcher.close();
      await new Promise<void>((closed) => {
        server.close(() => closed());
        server.closeAllConnections();
      });
      await removeServerFile(prDir, process.pid);
    })();
    return closing;
  };

  return { url, port: address.port, close };
}

async function handle(req: IncomingMessage, res: ServerResponse, context: RequestContext): Promise<void> {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  const methods = ROUTE_METHODS[pathname];

  if (methods === undefined) {
    sendJson(res, 404, { error: `No such endpoint: ${pathname}` });
    return;
  }
  if (req.method === undefined || !methods.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    sendJson(res, 405, { error: `${pathname} accepts ${methods.join(' and ')} only.` });
    return;
  }

  const reserved = NOT_IMPLEMENTED[pathname];
  if (reserved !== undefined) {
    req.resume();
    sendJson(res, 501, {
      error: `${pathname} is reserved: ${reserved.what} arrives in ${reserved.milestone}.`,
      milestone: reserved.milestone,
    });
    return;
  }

  switch (pathname) {
    case '/':
      serveUi(res, context.uiPath);
      return;
    case '/api/document':
      await serveDocument(res, context.prDir);
      return;
    case '/api/events':
      context.hub.attach(res);
      return;
    case '/api/drafts':
      if (req.method === 'GET') await serveDrafts(res, context.prDir);
      else await storeDrafts(req, res, context.prDir);
      return;
    case '/api/submit':
      await serveSubmit(req, res, context);
      return;
    case '/api/refresh': {
      req.resume();
      const refreshed = refresh(context);
      sendJson(res, refreshed.status, refreshed.body);
      return;
    }
    case '/api/health':
      sendJson(res, 200, {
        ok: true,
        port: context.port,
        pid: process.pid,
        prDir: context.prDir,
        document: existsSync(join(context.prDir, DOCUMENT_FILENAME)),
        uptimeSeconds: Number(((Date.now() - context.startedAt) / 1000).toFixed(3)),
      });
      return;
    default:
      sendJson(res, 404, { error: `No such endpoint: ${pathname}` });
  }
}

function serveUi(res: ServerResponse, uiPath: string | undefined): void {
  const htmlPath = resolveUiHtmlPath(uiPath);
  if (htmlPath === null || !existsSync(htmlPath)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('The cockpit interface has not been built yet. Run "npm run build" in the review-cockpit checkout, then start the review again.\n');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  pipeFile(res, htmlPath);
}

async function serveDocument(res: ServerResponse, prDir: string): Promise<void> {
  const documentPath = join(prDir, DOCUMENT_FILENAME);
  try {
    await stat(documentPath);
  } catch {
    sendJson(res, 503, {
      error: 'The analysis has not written a review document yet. Wait for the first stage to finish and retry.',
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  pipeFile(res, documentPath);
}

async function serveDrafts(res: ServerResponse, prDir: string): Promise<void> {
  const file = await readDrafts(prDir);
  const orphaned = await readOrphanedDrafts(prDir);
  sendJson(res, 200, orphaned === undefined ? file : { ...file, orphaned });
}

/**
 * The stored file is replaced whole. The server stamps `updatedAt` with its own
 * clock and answers with what it stored, so the cockpit's browser-storage copy
 * and the file are ordered by one clock when the two are compared on reload.
 */
async function storeDrafts(req: IncomingMessage, res: ServerResponse, prDir: string): Promise<void> {
  let incoming: unknown;
  try {
    incoming = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : 'The request body is not JSON.',
    });
    return;
  }

  const result = validateDrafts(incoming);
  if (!result.ok) {
    sendJson(res, 400, {
      error: 'The drafts file does not validate against the schema, so nothing was written.',
      errors: result.errors.slice(0, 5),
    });
    return;
  }

  const file: DraftsFile = { ...(incoming as DraftsFile), updatedAt: new Date().toISOString() };
  // The orphan list belongs to the analyzer's drafts.orphaned.json, and a cockpit
  // that echoed it back would resurrect it after the analyzer had cleared it.
  delete file.orphaned;
  await writeDrafts(prDir, file);
  sendJson(res, 200, file);
}

async function serveSubmit(
  req: IncomingMessage,
  res: ServerResponse,
  context: RequestContext,
): Promise<void> {
  let incoming: { verdict?: unknown; summaryBody?: unknown };
  try {
    incoming = JSON.parse(await readBody(req)) as { verdict?: unknown; summaryBody?: unknown };
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : 'The request body is not JSON.',
    });
    return;
  }

  const verdict = incoming.verdict;
  if (typeof verdict !== 'string' || !VERDICTS.includes(verdict as Verdict)) {
    sendJson(res, 400, { error: `verdict must be one of ${VERDICTS.join(', ')}.` });
    return;
  }
  const summaryBody = typeof incoming.summaryBody === 'string' ? incoming.summaryBody : '';

  const outcome = await submitReview({
    prDir: context.prDir,
    gh: context.gh,
    verdict: verdict as Verdict,
    summaryBody,
  });

  // The comments were posted, so the document is one fetch behind what GitHub now holds.
  // A refresh that fails costs the reviewer a stale document, never the posted review.
  if (outcome.status === 200) refresh(context);
  sendJson(res, outcome.status, outcome.body);
}

function refresh(context: RequestContext): RefreshOutcome {
  try {
    return refreshFromGitHub(context.prDir, context.ingest);
  } catch (error) {
    return {
      status: 502,
      body: {
        code: 'refresh_failed',
        message: `The comments and checks could not be refreshed: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      req.destroy();
      throw new Error(`The request body is larger than ${MAX_BODY_BYTES} bytes.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function pipeFile(res: ServerResponse, path: string): void {
  const stream = createReadStream(path);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`${JSON.stringify(body)}\n`);
}
