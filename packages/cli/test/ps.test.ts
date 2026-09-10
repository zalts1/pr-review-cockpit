import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { duration, psRows, renderPs } from '../src/commands/ps.js';

const HELPER = `
const { createServer } = require('node:http');
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, token: process.argv[2], clients: 2, idleSeconds: 0 }));
});
server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));
`;

let root: string;
const children: ChildProcess[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'review-cockpit-ps-'));
});

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  rmSync(root, { recursive: true, force: true });
});

describe('cockpit ps', () => {
  it('lists a live server with its port, pid, age and client count', async () => {
    const helperPath = join(root, 'helper.cjs');
    writeFileSync(helperPath, HELPER, 'utf8');
    const child = spawn(process.execPath, [helperPath, 'token-mine'], { stdio: ['ignore', 'pipe', 'ignore'] });
    children.push(child);
    const port = await new Promise<number>((resolve) => {
      child.stdout?.once('data', (chunk: Buffer) => resolve(Number(chunk.toString('utf8').trim())));
    });

    const dir = join(root, 'owner', 'repo', 'pr-12');
    mkdirSync(dir, { recursive: true });
    const startedAt = new Date(Date.now() - 90 * 60_000).toISOString();
    writeFileSync(
      join(dir, 'server.json'),
      JSON.stringify({ port, pid: child.pid, url: `http://127.0.0.1:${port}`, startedAt, token: 'token-mine' }),
      'utf8',
    );

    const gone = join(root, 'owner', 'repo', 'pr-13');
    mkdirSync(gone, { recursive: true });
    writeFileSync(
      join(gone, 'server.json'),
      JSON.stringify({ port: 1, pid: 999_999, url: 'http://127.0.0.1:1', startedAt, token: 'x' }),
      'utf8',
    );

    const rows = await psRows(root);

    expect(rows).toEqual([
      { target: 'owner/repo#12', port, pid: child.pid, started: '1h30m ago', idleFor: '0s', clients: '2' },
    ]);
    const table = renderPs(rows).split('\n');
    expect(table[0]?.split(/\s{2,}/)).toEqual(['pull request', 'port', 'pid', 'started', 'idle for', 'clients']);
    expect(table[1]?.split(/\s{2,}/)).toEqual(['owner/repo#12', String(port), String(child.pid), '1h30m ago', '0s', '2']);
  });

  it('says nothing is running when no server.json names a live process', async () => {
    mkdirSync(join(root, 'owner', 'repo', 'pr-1'), { recursive: true });
    expect(await psRows(root)).toEqual([]);
  });
});

describe('duration', () => {
  it('reads as a length of time at every scale', () => {
    expect(duration(0)).toBe('0s');
    expect(duration(59)).toBe('59s');
    expect(duration(60)).toBe('1m');
    expect(duration(1800)).toBe('30m');
    expect(duration(3600)).toBe('1h00m');
    expect(duration(9000)).toBe('2h30m');
  });
});
