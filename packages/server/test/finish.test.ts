import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FinishHooks, RunningServer } from '../src/index.js';
import { startServer } from '../src/index.js';

let tempRoot: string;
let prDir: string;
let steps: string[];
const running: RunningServer[] = [];

const hooks: FinishHooks = {
  clean(purge) {
    steps.push(purge ? 'spawn --purge' : 'spawn');
  },
  exit() {
    steps.push('exit');
  },
};

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'review-cockpit-finish-'));
  prDir = join(tempRoot, 'owner', 'repo', 'pr-1');
  await mkdir(prDir, { recursive: true });
  steps = [];
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
  await rm(tempRoot, { recursive: true, force: true });
});

async function start(): Promise<RunningServer> {
  const server = await startServer({ prDir, finish: hooks });
  running.push(server);
  return server;
}

async function writeDrafts(count: number, filename = 'drafts.json'): Promise<void> {
  const drafts = Array.from({ length: count }, (_unused, index) => ({
    id: `d${index}`,
    path: 'a.ts',
    line: index + 1,
    side: 'RIGHT',
    body: 'note',
    commitId: 'abc',
  }));
  await writeFile(
    join(prDir, filename),
    JSON.stringify({
      schemaVersion: '1.3.0',
      pr: { owner: 'owner', repo: 'repo', number: 1 },
      verdict: null,
      summaryBody: '',
      drafts,
    }),
    'utf8',
  );
}

function settle(): Promise<void> {
  return new Promise((wake) => setTimeout(wake, 50));
}

async function finish(server: RunningServer, body: unknown): Promise<Response> {
  return fetch(`${server.url}/api/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Reads the event stream until the shutdown line arrives or the server closes it. */
async function readShutdown(url: string): Promise<string | null> {
  const response = await fetch(`${url}/api/events`);
  const body = response.body;
  if (body === null) return null;
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    text += decoder.decode(chunk, { stream: true });
    const shutdown = /data: (\{"type":"shutdown".*?\})/.exec(text);
    if (shutdown !== null) return shutdown[1] ?? null;
  }
  return null;
}

describe('POST /api/finish', () => {
  it('answers, announces the shutdown, spawns the teardown and exits, in that order', async () => {
    const server = await start();
    const shutdown = readShutdown(server.url);
    // The stream has to be attached before the finish, or there is nobody to announce to.
    await settle();

    const response = await finish(server, { purge: false });

    // A whole body is the proof that the answer came first: the teardown closes every
    // connection, so a response flushed after it would arrive truncated or not at all.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'finishing', purge: false });

    expect(await shutdown).toBe('{"type":"shutdown","reason":"finished"}');

    await settle();
    expect(steps).toEqual(['spawn', 'exit']);
  });

  it('passes the purge through to the teardown', async () => {
    const server = await start();
    const response = await finish(server, { purge: true, confirmDrafts: true });

    expect(await response.json()).toEqual({ status: 'finishing', purge: true });
    await settle();
    expect(steps).toEqual(['spawn --purge', 'exit']);
  });

  it('refuses a purge that would delete unsent drafts', async () => {
    await writeDrafts(2);
    const server = await start();

    const response = await finish(server, { purge: true });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'unsent_drafts', count: 2 });
    expect(steps).toEqual([]);
  });

  it('counts the drafts a re-analysis set aside as unsent too', async () => {
    await writeDrafts(1);
    await writeDrafts(3, 'drafts.orphaned.json');
    const server = await start();

    const response = await finish(server, { purge: true });

    expect(await response.json()).toMatchObject({ code: 'unsent_drafts', count: 4 });
  });

  it('goes ahead on a second request that confirms the drafts', async () => {
    await writeDrafts(2);
    const server = await start();

    expect((await finish(server, { purge: true })).status).toBe(409);
    const confirmed = await finish(server, { purge: true, confirmDrafts: true });

    expect(confirmed.status).toBe(200);
    await settle();
    expect(steps).toEqual(['spawn --purge', 'exit']);
  });

  it('keeps unsent drafts out of the way of a finish that keeps the files', async () => {
    await writeDrafts(2);
    const server = await start();

    const response = await finish(server, { purge: false });

    expect(response.status).toBe(200);
  });
});
