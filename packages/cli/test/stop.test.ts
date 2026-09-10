import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopServers } from '../src/commands/stop.js';

/**
 * Answers /api/health with whatever token it was given, so a test can stage a server whose
 * token agrees with its server.json and one whose token does not. Its command line says
 * nothing about the cockpit, so the token is the only thing that can identify it.
 */
const HELPER = `
const { createServer } = require('node:http');
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, token: process.argv[2] }));
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(String(server.address().port) + '\\n');
});
process.on('SIGTERM', () => process.exit(0));
`;

let root: string;
let helperPath: string;
const children: ChildProcess[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'review-cockpit-stop-'));
  helperPath = join(root, 'helper.cjs');
  writeFileSync(helperPath, HELPER, 'utf8');
});

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  rmSync(root, { recursive: true, force: true });
});

async function startHelper(token: string): Promise<{ pid: number; port: number }> {
  const child = spawn(process.execPath, [helperPath, token], { stdio: ['ignore', 'pipe', 'ignore'] });
  children.push(child);
  const port = await new Promise<number>((resolve, reject) => {
    child.stdout?.once('data', (chunk: Buffer) => resolve(Number(chunk.toString('utf8').trim())));
    child.once('error', reject);
  });
  if (child.pid === undefined) throw new Error('the helper did not start');
  return { pid: child.pid, port };
}

function writeServerFile(
  number: number,
  contents: { port: number; pid: number; token: string; sessionId?: string },
): string {
  const dir = join(root, 'owner', 'repo', `pr-${number}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'server.json');
  writeFileSync(
    path,
    JSON.stringify({
      ...contents,
      url: `http://127.0.0.1:${contents.port}`,
      startedAt: new Date().toISOString(),
    }),
    'utf8',
  );
  return path;
}

/** A pid that has certainly gone: a process that has already exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await new Promise((done) => child.once('exit', done));
  if (child.pid === undefined) throw new Error('the throwaway process did not start');
  return child.pid;
}

describe('cockpit stop', () => {
  it('stops the server whose token its server.json holds', async () => {
    const mine = await startHelper('token-mine');
    writeServerFile(1, { port: mine.port, pid: mine.pid, token: 'token-mine' });

    const outcomes = await stopServers({ selector: { kind: 'all' }, root });

    expect(outcomes).toEqual([
      { target: 'owner/repo#1', action: 'stopped', detail: expect.stringContaining(String(mine.port)) },
    ]);
    expect(existsSync(join(root, 'owner', 'repo', 'pr-1', 'server.json'))).toBe(false);
  });

  it('leaves a live process whose token does not match alone', async () => {
    const other = await startHelper('token-somebody-else');
    const path = writeServerFile(2, { port: other.port, pid: other.pid, token: 'token-mine' });

    const outcomes = await stopServers({ selector: { kind: 'all' }, root });

    expect(outcomes[0]?.action).toBe('foreign');
    expect(outcomes[0]?.detail).toContain(String(other.pid));
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('token-mine');

    const stillUp = await fetch(`http://127.0.0.1:${other.port}/api/health`);
    expect(stillUp.ok).toBe(true);
  });

  it('removes a server.json whose process is gone', async () => {
    const path = writeServerFile(3, { port: 1, pid: await deadPid(), token: 'token-mine' });

    const outcomes = await stopServers({ selector: { kind: 'all' }, root });

    expect(outcomes[0]?.action).toBe('stale');
    expect(existsSync(path)).toBe(false);
  });

  it('stops only the servers a named session started', async () => {
    const mine = await startHelper('token-a');
    const theirs = await startHelper('token-b');
    writeServerFile(4, { port: mine.port, pid: mine.pid, token: 'token-a', sessionId: 'session-a' });
    writeServerFile(5, { port: theirs.port, pid: theirs.pid, token: 'token-b', sessionId: 'session-b' });

    const outcomes = await stopServers({ selector: { kind: 'session', sessionId: 'session-a' }, root });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ target: 'owner/repo#4', action: 'stopped' });
    expect((await fetch(`http://127.0.0.1:${theirs.port}/api/health`)).ok).toBe(true);
  });

  it('stops one pull request and nothing beside it', async () => {
    const first = await startHelper('token-a');
    const second = await startHelper('token-b');
    writeServerFile(6, { port: first.port, pid: first.pid, token: 'token-a' });
    writeServerFile(7, { port: second.port, pid: second.pid, token: 'token-b' });

    const outcomes = await stopServers({
      selector: { kind: 'pr', ref: { owner: 'owner', repo: 'repo', number: 7 } },
      root,
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ target: 'owner/repo#7', action: 'stopped' });
    expect((await fetch(`http://127.0.0.1:${first.port}/api/health`)).ok).toBe(true);
  });

  it('reports nothing when the cache holds no server at all', async () => {
    mkdirSync(join(root, 'owner', 'repo', 'pr-8'), { recursive: true });
    expect(await stopServers({ selector: { kind: 'all' }, root })).toEqual([]);
  });
});
