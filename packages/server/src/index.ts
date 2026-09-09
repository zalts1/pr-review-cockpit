import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { DocumentWatcher, EventStreamHub } from './events.js';
import { DOCUMENT_FILENAME } from './paths.js';
import { removeServerFile, writeServerFile } from './server-file.js';
import { resolveUiHtmlPath } from './ui-path.js';

export { DOCUMENT_FILENAME, SERVER_FILENAME } from './paths.js';
export { resolveUiHtmlPath, UI_PATH_ENV_VAR } from './ui-path.js';
export type { ServerFile } from './server-file.js';

export interface ServerOptions {
  prDir: string;
  port?: number;
  uiPath?: string;
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
}

const ROUTE_METHOD: Record<string, string> = {
  '/': 'GET',
  '/api/document': 'GET',
  '/api/events': 'GET',
  '/api/health': 'GET',
  '/api/drafts': 'POST',
  '/api/submit': 'POST',
  '/api/ask': 'POST',
};

const NOT_IMPLEMENTED: Record<string, { milestone: string; what: string }> = {
  '/api/drafts': { milestone: 'M6', what: 'saving draft comments and the verdict' },
  '/api/submit': { milestone: 'M6', what: 'submitting the review to the forge' },
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
  const method = ROUTE_METHOD[pathname];

  if (method === undefined) {
    sendJson(res, 404, { error: `No such endpoint: ${pathname}` });
    return;
  }
  if (req.method !== method) {
    res.setHeader('Allow', method);
    sendJson(res, 405, { error: `${pathname} accepts ${method} only.` });
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

function pipeFile(res: ServerResponse, path: string): void {
  const stream = createReadStream(path);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`${JSON.stringify(body)}\n`);
}
