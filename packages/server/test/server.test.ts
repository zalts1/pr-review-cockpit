import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveUiHtmlPath, startServer, UI_PATH_ENV_VAR, type RunningServer } from '../src/index.js';

const UI_HTML = '<!doctype html><title>cockpit</title><main>hello</main>';

let tempRoot: string;
let prDir: string;
let uiPath: string;
const running: RunningServer[] = [];

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'review-cockpit-server-'));
  prDir = join(tempRoot, 'owner', 'repo', 'pr-1');
  uiPath = join(tempRoot, 'index.html');
  await writeFile(uiPath, UI_HTML, 'utf8');
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
  await rm(tempRoot, { recursive: true, force: true });
});

async function start(options: { port?: number; uiPath?: string } = {}): Promise<RunningServer> {
  const server = await startServer({ prDir, uiPath: options.uiPath ?? uiPath });
  running.push(server);
  return server;
}

async function writeDocument(document: unknown): Promise<void> {
  const target = join(prDir, 'review.json');
  const temp = `${target}.incoming`;
  await writeFile(temp, JSON.stringify(document), 'utf8');
  await rename(temp, target);
}

describe('startServer', () => {
  it('binds to the loopback interface on a free port', async () => {
    const server = await start();
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
  });

  it('writes server.json on start and removes it on close', async () => {
    const server = await start();
    const path = join(prDir, 'server.json');
    const written = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    expect(written).toMatchObject({ port: server.port, pid: process.pid, url: server.url });
    expect(new Date(String(written['startedAt'])).toISOString()).toBe(written['startedAt']);

    await server.close();
    await expect(readFile(path, 'utf8')).rejects.toThrow();
  });
});

describe('GET /', () => {
  it('serves the prebuilt cockpit html', async () => {
    const server = await start();
    const response = await fetch(server.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe(UI_HTML);
  });

  it('answers 503 with build instructions when the html is missing', async () => {
    const server = await start({ uiPath: join(tempRoot, 'absent', 'index.html') });
    const response = await fetch(server.url);
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toContain('npm run build');
  });
});

describe('GET /api/document', () => {
  it('returns the document once it exists', async () => {
    const server = await start();
    await writeDocument({ schemaVersion: '1', hunks: [] });
    const response = await fetch(`${server.url}/api/document`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({ schemaVersion: '1', hunks: [] });
  });

  it('answers 503 while no document has been written', async () => {
    const server = await start();
    const response = await fetch(`${server.url}/api/document`);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/document/i);
  });
});

describe('GET /api/health', () => {
  it('reports the port, pid, directory and whether a document exists', async () => {
    const server = await start();
    const before = (await (await fetch(`${server.url}/api/health`)).json()) as Record<string, unknown>;
    expect(before).toMatchObject({ ok: true, port: server.port, pid: process.pid, prDir, document: false });
    expect(typeof before['uptimeSeconds']).toBe('number');

    await writeDocument({ schemaVersion: '1' });
    const after = (await (await fetch(`${server.url}/api/health`)).json()) as Record<string, unknown>;
    expect(after['document']).toBe(true);
  });
});

describe('GET /api/events', () => {
  it('replays a document event on connect and pushes one per atomic rewrite', async () => {
    const server = await start();
    await writeDocument({ schemaVersion: '1', revision: 1 });

    const stream = await openEvents(server.url);
    expect(await stream.next()).toBe('{"type":"document"}');

    await writeDocument({ schemaVersion: '1', revision: 2 });
    expect(await stream.next()).toBe('{"type":"document"}');

    await stream.cancel();
  });

  it('serves several concurrent clients', async () => {
    const server = await start();
    const first = await openEvents(server.url);
    const second = await openEvents(server.url);

    await writeDocument({ schemaVersion: '1', revision: 1 });
    expect(await first.next()).toBe('{"type":"document"}');
    expect(await second.next()).toBe('{"type":"document"}');

    await first.cancel();
    await second.cancel();
  });

  it('sends no event before a document exists', async () => {
    const server = await start();
    const stream = await openEvents(server.url);
    await expect(stream.next(250)).rejects.toThrow(/timed out/);
    await stream.cancel();
  });
});

describe('reserved routes', () => {
  it.each([
    ['/api/drafts', 'M6'],
    ['/api/submit', 'M6'],
    ['/api/ask', 'post-v1'],
  ])('%s answers 501 naming the milestone', async (path, milestone) => {
    const server = await start();
    const response = await fetch(`${server.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(501);
    const body = (await response.json()) as { milestone?: string; error?: string };
    expect(body.milestone).toBe(milestone);
    expect(body.error).toContain(milestone);
  });

  it('answers 405 when a known route is called with the wrong method', async () => {
    const server = await start();
    const response = await fetch(`${server.url}/api/document`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });
});

describe('unknown routes', () => {
  it('answer 404 with a JSON body', async () => {
    const server = await start();
    const response = await fetch(`${server.url}/api/nope`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('/api/nope');
  });
});

describe('resolveUiHtmlPath', () => {
  it('prefers an explicit override over the environment', () => {
    const previous = process.env[UI_PATH_ENV_VAR];
    process.env[UI_PATH_ENV_VAR] = join(tempRoot, 'from-env.html');
    try {
      expect(resolveUiHtmlPath(uiPath)).toBe(uiPath);
      expect(resolveUiHtmlPath()).toBe(join(tempRoot, 'from-env.html'));
    } finally {
      if (previous === undefined) delete process.env[UI_PATH_ENV_VAR];
      else process.env[UI_PATH_ENV_VAR] = previous;
    }
  });

  it('returns the override even when the file does not exist, so the caller can report 503', () => {
    const absent = join(tempRoot, 'absent', 'index.html');
    expect(resolveUiHtmlPath(absent)).toBe(absent);
  });

  it('discovers the workspace cockpit build when nothing is configured', () => {
    const previous = process.env[UI_PATH_ENV_VAR];
    delete process.env[UI_PATH_ENV_VAR];
    try {
      const found = resolveUiHtmlPath();
      expect(found === null || found.endsWith(join('packages', 'cockpit', 'dist', 'index.html'))).toBe(true);
    } finally {
      if (previous !== undefined) process.env[UI_PATH_ENV_VAR] = previous;
    }
  });
});

interface ChunkReader {
  read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
  cancel(): Promise<void>;
}

class EventStreamReader {
  private readonly decoder = new TextDecoder();
  private buffer = '';

  constructor(private readonly reader: ChunkReader) {}

  async next(timeoutMs = 5_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const event = this.take();
      if (event !== null) return event;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for a server-sent event');
      const chunk = await withTimeout(this.reader.read(), remaining);
      if (chunk.done || chunk.value === undefined) throw new Error('the event stream closed');
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }

  async cancel(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
  }

  private take(): string | null {
    for (;;) {
      const end = this.buffer.indexOf('\n\n');
      if (end === -1) return null;
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .join('\n');
      if (data !== '') return data;
    }
  }
}

async function openEvents(url: string): Promise<EventStreamReader> {
  const response = await fetch(`${url}/api/events`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
  const body = response.body;
  if (body === null) throw new Error('the event stream has no body');
  return new EventStreamReader(body.getReader());
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((settled, failed) => {
    const timer = setTimeout(() => failed(new Error('timed out waiting for a server-sent event')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        settled(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        failed(error);
      },
    );
  });
}
