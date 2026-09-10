import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Comment, ReviewDocument } from '@review-cockpit/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GhResult, IngestFn, RunningServer } from '../src/index.js';
import { refreshFromGitHub, startServer } from '../src/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures');

let tempRoot: string;
let prDir: string;
const running: RunningServer[] = [];

async function fixtureDocument(): Promise<ReviewDocument> {
  return JSON.parse(await readFile(join(fixtures, 'pr-fake-1.stage1.json'), 'utf8')) as ReviewDocument;
}

async function writeDocument(document: ReviewDocument): Promise<void> {
  const target = join(prDir, 'review.json');
  const temp = `${target}.incoming`;
  await writeFile(temp, JSON.stringify(document, null, 2), 'utf8');
  await rename(temp, target);
}

async function storedDocument(): Promise<ReviewDocument> {
  return JSON.parse(await readFile(join(prDir, 'review.json'), 'utf8')) as ReviewDocument;
}

/** A comment on a line the fixture's first hunk really holds, so the document validates. */
function postedComment(document: ReviewDocument): Comment {
  const file = document.files.find((candidate) => candidate.hunks.length > 0);
  if (file === undefined) throw new Error('the fixture has no hunk to comment on');
  const hunk = file.hunks[0];
  if (hunk === undefined) throw new Error('the fixture has no hunk to comment on');
  const line = hunk.lines.find((candidate) => candidate.newNo !== null);
  if (line === undefined) throw new Error('the first hunk has no line on the right side');

  return {
    id: 'c-posted',
    source: { kind: 'human', name: 'reviewer' },
    author: 'reviewer',
    path: file.path,
    line: line.newNo as number,
    side: 'RIGHT',
    hunkId: hunk.id,
    body: 'The review this cockpit just posted.',
    url: `${document.pr.url}#discussion_r1`,
    createdAt: '2026-09-10T12:00:00Z',
    resolved: false,
    severity: null,
  };
}

function ingestOf(comments: Comment[], errors: { comments?: string; checks?: string } = {}): IngestFn {
  return ({ pr }) => ({
    comments: errors.comments === undefined ? comments : [],
    conversation: [],
    checks:
      errors.checks === undefined
        ? [{ name: 'lint', app: 'github-actions', status: 'success', url: pr.url, completedAt: null }]
        : [],
    botSummaries: [],
    commentsError: errors.comments ?? null,
    checksError: errors.checks ?? null,
  });
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'review-cockpit-refresh-'));
  prDir = join(tempRoot, 'northwind-labs', 'tenant-platform', 'pr-1234');
  await mkdir(prDir, { recursive: true });
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
  await rm(tempRoot, { recursive: true, force: true });
});

async function start(ingest: IngestFn, gh?: (args: readonly string[], input?: string) => GhResult): Promise<RunningServer> {
  const server = await startServer({
    prDir,
    uiPath: join(tempRoot, 'index.html'),
    ingest,
    ...(gh === undefined ? {} : { gh }),
  });
  running.push(server);
  return server;
}

describe('refreshFromGitHub', () => {
  it('replaces the comments and the checks and leaves the rest of the document alone', async () => {
    const document = await fixtureDocument();
    await writeDocument(document);
    const comment = postedComment(document);

    const outcome = refreshFromGitHub(prDir, ingestOf([comment]));

    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ comments: 1, checks: 1, commentsError: null, checksError: null });

    const stored = await storedDocument();
    expect(stored.comments).toEqual([comment]);
    expect(stored.checks.map((check) => check.name)).toEqual(['lint']);
    expect(stored.status.comments.state).toBe('ready');
    expect(stored.status.checks.state).toBe('ready');
    expect(stored.files).toEqual(document.files);
    expect(stored.status.groups).toEqual(document.status.groups);
  });

  it('marks the section failed with the gh message and keeps what it had', async () => {
    const document = await fixtureDocument();
    await writeDocument(document);

    const outcome = refreshFromGitHub(prDir, ingestOf([], { comments: 'gh: HTTP 502' }));

    expect(outcome.status).toBe(200);
    const stored = await storedDocument();
    expect(stored.status.comments.state).toBe('failed');
    expect(stored.status.comments.message).toContain('gh: HTTP 502');
    expect(stored.comments).toEqual(document.comments);
    expect(stored.status.checks.state).toBe('ready');
  });

  it('answers 503 when nothing has been analysed', () => {
    const outcome = refreshFromGitHub(prDir, ingestOf([]));
    expect(outcome.status).toBe(503);
    expect(outcome.body).toMatchObject({ code: 'no_document' });
  });
});

describe('POST /api/refresh', () => {
  it('refreshes on demand and reports what it read', async () => {
    const document = await fixtureDocument();
    await writeDocument(document);
    const server = await start(ingestOf([postedComment(document)]));

    const response = await fetch(`${server.url}/api/refresh`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ comments: 1, checks: 1 });
    expect((await storedDocument()).comments).toHaveLength(1);
  });

  it('accepts POST only', async () => {
    const server = await start(ingestOf([]));
    const response = await fetch(`${server.url}/api/refresh`);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});

describe('POST /api/submit', () => {
  it('refreshes the document from GitHub once the review is posted', async () => {
    const document = await fixtureDocument();
    await writeDocument(document);
    const comment = postedComment(document);

    const gh = (args: readonly string[]): GhResult => {
      if (args[0] === 'pr') {
        return { code: 0, stdout: JSON.stringify({ headRefOid: document.pr.head.sha }), stderr: '' };
      }
      return {
        code: 0,
        stdout: JSON.stringify({ id: 77, html_url: `${document.pr.url}#pullrequestreview-77` }),
        stderr: '',
      };
    };
    const server = await start(ingestOf([comment]), gh);

    const response = await fetch(`${server.url}/api/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict: 'COMMENT', summaryBody: 'Looks good.' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 77 });
    expect((await storedDocument()).comments).toEqual([comment]);
  });

  it('does not refresh when the post was refused', async () => {
    const document = await fixtureDocument();
    await writeDocument(document);

    const gh = (): GhResult => ({
      code: 0,
      stdout: JSON.stringify({ headRefOid: 'f'.repeat(40) }),
      stderr: '',
    });
    const server = await start(ingestOf([postedComment(document)]), gh);

    const response = await fetch(`${server.url}/api/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict: 'COMMENT', summaryBody: '' }),
    });

    expect(response.status).toBe(409);
    expect((await storedDocument()).comments).toEqual(document.comments);
  });
});
