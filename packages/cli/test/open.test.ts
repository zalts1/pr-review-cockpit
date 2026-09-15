import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openCommand } from '../src/commands/open.js';

const PR = 'northwind-labs/tenant-platform#1234';
const URL_ = 'http://127.0.0.1:8090';

let cache: string;
let prDir: string;
let opened: string[];
let err: string[];

function writeServer(pid: number): void {
  writeFileSync(
    join(prDir, 'server.json'),
    JSON.stringify({ port: 8090, pid, url: URL_, startedAt: '2026-09-15T10:00:00Z', token: 'ab' }),
  );
}

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), 'cockpit-open-'));
  process.env['REVIEW_COCKPIT_CACHE'] = cache;
  prDir = join(cache, 'northwind-labs', 'tenant-platform', 'pr-1234');
  mkdirSync(prDir, { recursive: true });
  opened = [];
  err = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => err.push(args.join(' ')));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['REVIEW_COCKPIT_CACHE'];
  rmSync(cache, { recursive: true, force: true });
});

const deps = { open: (url: string) => opened.push(url) };

describe('cockpit open', () => {
  it('opens the running server once and says so the second time', () => {
    writeServer(process.pid);

    expect(openCommand(PR, { cwd: cache, force: false }, deps)).toBe(0);
    expect(opened).toEqual([URL_]);

    expect(openCommand(PR, { cwd: cache, force: false }, deps)).toBe(0);
    expect(opened).toEqual([URL_]);
    expect(err.join('\n')).toContain('already open');
  });

  it('opens again with --force', () => {
    writeServer(process.pid);
    openCommand(PR, { cwd: cache, force: false }, deps);
    openCommand(PR, { cwd: cache, force: true }, deps);

    expect(opened).toEqual([URL_, URL_]);
  });

  it('opens again when the server it had open was replaced', () => {
    writeServer(process.pid);
    openCommand(PR, { cwd: cache, force: false }, deps);
    writeFileSync(
      join(prDir, 'server.json'),
      JSON.stringify({ port: 8091, pid: process.pid, url: 'http://127.0.0.1:8091', token: 'ab' }),
    );

    openCommand(PR, { cwd: cache, force: false }, deps);
    expect(opened).toEqual([URL_, 'http://127.0.0.1:8091']);
  });

  it('starts nothing when no server is running', () => {
    expect(openCommand(PR, { cwd: cache, force: false }, deps)).toBe(1);
    expect(opened).toEqual([]);
    expect(err.join('\n')).toContain('cockpit run');
  });
});
