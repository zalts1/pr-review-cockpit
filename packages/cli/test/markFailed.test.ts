import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReviewDocument } from '@review-cockpit/schema';
import { validateDocument } from '@review-cockpit/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markFailedCommand } from '../src/commands/markFailed.js';

const PR = 'northwind-labs/tenant-platform#1234';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixtures = join(repoRoot, 'fixtures');

let cache: string;
let prDir: string;
let err: string[];

function written(): ReviewDocument {
  return JSON.parse(readFileSync(join(prDir, 'review.json'), 'utf8')) as ReviewDocument;
}

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), 'cockpit-mark-failed-'));
  process.env['REVIEW_COCKPIT_CACHE'] = cache;
  prDir = join(cache, 'northwind-labs', 'tenant-platform', 'pr-1234');
  mkdirSync(prDir, { recursive: true });
  copyFileSync(join(fixtures, 'pr-fake-1.stage1.json'), join(prDir, 'review.json'));

  err = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation((...args) => err.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['REVIEW_COCKPIT_CACHE'];
  rmSync(cache, { recursive: true, force: true });
});

describe('cockpit mark-failed', () => {
  it('marks groups, path and summary failed with the message, and the document still validates', () => {
    const message = 'the judgment pass was rejected twice';
    expect(markFailedCommand(PR, { cwd: repoRoot, stage: '2', message })).toBe(0);

    const document = written();
    for (const section of ['groups', 'path', 'summary'] as const) {
      expect(document.status[section].state).toBe('failed');
      expect(document.status[section].message).toBe(message);
    }
    expect(document.status.files.state).toBe('ready');
    expect(validateDocument(document).ok).toBe(true);
  });

  it('refuses a stage it does not own', () => {
    expect(markFailedCommand(PR, { cwd: repoRoot, stage: '3', message: 'the graph broke' })).toBe(2);
    expect(written().status.groups.state).toBe('pending');
  });

  it('refuses an empty message, because the cockpit shows it to the reviewer', () => {
    expect(markFailedCommand(PR, { cwd: repoRoot, stage: '2', message: '  ' })).toBe(2);
    expect(written().status.groups.state).toBe('pending');
  });

  it('says so when there is no document to mark', () => {
    rmSync(join(prDir, 'review.json'));
    expect(markFailedCommand(PR, { cwd: repoRoot, stage: '2', message: 'rejected twice' })).toBe(1);
    expect(err.join('\n')).toContain('there is no review document');
  });
});
