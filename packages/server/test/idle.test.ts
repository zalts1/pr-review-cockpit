import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentWatcher, EventStreamHub } from '../src/events.js';
import { IdleWatch } from '../src/idle.js';
import { startServer, type RunningServer } from '../src/index.js';

const MINUTE = 60_000;

describe('IdleWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  interface Started {
    fired: number;
    idle: IdleWatch;
  }

  function watch(idleMinutes: number, clients: { count: number }): Started {
    const started = { fired: 0 } as Started;
    started.idle = new IdleWatch({
      idleMinutes,
      clients: () => clients.count,
      onIdle: () => {
        started.fired += 1;
      },
    });
    return started;
  }

  it('fires once the whole window has passed with no client attached', () => {
    const clients = { count: 0 };
    const started = watch(30, clients);
    started.idle.reset();

    vi.advanceTimersByTime(30 * MINUTE - 1);
    expect(started.fired).toBe(0);

    vi.advanceTimersByTime(1);
    expect(started.fired).toBe(1);
  });

  it('starts the window again on every request', () => {
    const clients = { count: 0 };
    const started = watch(30, clients);
    started.idle.reset();

    for (let elapsed = 0; elapsed < 90 * MINUTE; elapsed += 20 * MINUTE) {
      vi.advanceTimersByTime(20 * MINUTE);
      started.idle.reset();
    }
    expect(started.fired).toBe(0);

    vi.advanceTimersByTime(30 * MINUTE);
    expect(started.fired).toBe(1);
  });

  it('never fires while a cockpit holds an event stream', () => {
    const clients = { count: 1 };
    const started = watch(30, clients);
    started.idle.reset();

    vi.advanceTimersByTime(10 * 60 * MINUTE);
    expect(started.fired).toBe(0);

    clients.count = 0;
    started.idle.reset();
    vi.advanceTimersByTime(30 * MINUTE);
    expect(started.fired).toBe(1);
  });

  it('is disabled at zero minutes', () => {
    const clients = { count: 0 };
    const started = watch(0, clients);
    expect(started.idle.enabled).toBe(false);

    started.idle.reset();
    vi.advanceTimersByTime(1000 * MINUTE);
    expect(started.fired).toBe(0);
  });

  it('reports how long it has been armed, and nothing while a client is attached', () => {
    const clients = { count: 0 };
    const started = watch(30, clients);
    started.idle.reset();

    vi.advanceTimersByTime(5 * MINUTE);
    expect(started.idle.idleSeconds()).toBe(300);

    clients.count = 1;
    started.idle.reset();
    expect(started.idle.idleSeconds()).toBe(0);
  });
});

describe('EventStreamHub.announceShutdown', () => {
  it('writes one shutdown event naming the reason', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'review-cockpit-hub-'));
    try {
      const written: string[] = [];
      const hub = new EventStreamHub(dir, new DocumentWatcher(dir));
      const client = {
        writeHead: () => undefined,
        flushHeaders: () => undefined,
        write: (payload: string) => written.push(payload),
        end: () => undefined,
        on: () => undefined,
      } as unknown as ServerResponse;

      hub.attach(client);
      hub.announceShutdown('idle');
      hub.close();

      expect(written).toContain('data: {"type":"shutdown","reason":"idle"}\n\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('a server that has been left alone', () => {
  let tempRoot: string;
  let prDir: string;
  let uiPath: string;
  const running: RunningServer[] = [];

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'review-cockpit-idle-'));
    prDir = join(tempRoot, 'owner', 'repo', 'pr-7');
    uiPath = join(tempRoot, 'index.html');
    await writeFile(uiPath, '<!doctype html>', 'utf8');
  });

  afterEach(async () => {
    await Promise.all(running.splice(0).map((server) => server.close()));
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('stops itself and removes server.json once its last client has gone', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      logged.push(String(line));
    });

    const server = await startServer({ prDir, uiPath, idleMinutes: 0.004 });
    running.push(server);

    const events = await fetch(`${server.url}/api/events`);
    const reader = events.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.cancel();

    await server.idleExit;

    await expect(readFile(join(prDir, 'server.json'), 'utf8')).rejects.toThrow();
    expect(logged.filter((line) => line.includes('was connected for'))).toHaveLength(1);
    expect(logged.join('\n')).toContain('cockpit run owner/repo#7');
  });

  it('keeps running while a client is attached', async () => {
    const server = await startServer({ prDir, uiPath, idleMinutes: 0.004 });
    running.push(server);

    const events = await fetch(`${server.url}/api/events`);
    const reader = events.body?.getReader();

    const exited = await Promise.race([
      server.idleExit.then(() => 'exited'),
      new Promise((wake) => setTimeout(() => wake('still up'), 600)),
    ]);
    expect(exited).toBe('still up');
    const health = (await (await fetch(`${server.url}/api/health`)).json()) as { clients: number };
    expect(health.clients).toBe(1);

    await reader?.cancel();
  });

  it('never stops itself when the clock is disabled', async () => {
    const server = await startServer({ prDir, uiPath, idleMinutes: 0 });
    running.push(server);

    const exited = await Promise.race([
      server.idleExit.then(() => 'exited'),
      new Promise((wake) => setTimeout(() => wake('still up'), 500)),
    ]);
    expect(exited).toBe('still up');
  });

  it('tells an attached cockpit why it is stopping', async () => {
    const server = await startServer({ prDir, uiPath, idleMinutes: 0 });
    running.push(server);

    const events = await fetch(`${server.url}/api/events`);
    const reader = events.body?.getReader();
    if (reader === undefined) throw new Error('the event stream has no body');

    await server.stop('stopped');

    const decoder = new TextDecoder();
    let seen = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      seen += decoder.decode(chunk.value, { stream: true });
    }
    expect(seen).toContain('{"type":"shutdown","reason":"stopped"}');
  });
});
