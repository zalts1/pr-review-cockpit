import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Draft, DraftsFile } from '@review-cockpit/schema';
import { SCHEMA_VERSION } from '@review-cockpit/schema/version';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GhCommand, GhResult, RunningServer } from '../src/index.js';
import { startServer } from '../src/index.js';

const HEAD = 'a'.repeat(40);
const MOVED = 'b'.repeat(40);

let tempRoot: string;
let prDir: string;
const running: RunningServer[] = [];

interface GhCall {
  args: string[];
  input: string | undefined;
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'review-cockpit-drafts-'));
  prDir = join(tempRoot, 'northwind-labs', 'tenant-platform', 'pr-7');
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
  await rm(tempRoot, { recursive: true, force: true });
});

async function start(gh?: GhCommand): Promise<RunningServer> {
  const server = await startServer({ prDir, uiPath: join(tempRoot, 'index.html'), ...(gh ? { gh } : {}) });
  running.push(server);
  return server;
}

function ghStub(replies: (call: GhCall) => GhResult): { gh: GhCommand; calls: GhCall[] } {
  const calls: GhCall[] = [];
  const gh: GhCommand = (args, input) => {
    const call = { args: [...args], input };
    calls.push(call);
    return replies(call);
  };
  return { gh, calls };
}

function head(sha = HEAD): GhResult {
  return { code: 0, stdout: `${JSON.stringify({ headRefOid: sha })}\n`, stderr: '' };
}

function created(): GhResult {
  return {
    code: 0,
    stdout: JSON.stringify({
      id: 4242,
      html_url: 'https://github.com/northwind-labs/tenant-platform/pull/7#pullrequestreview-4242',
    }),
    stderr: '',
  };
}

async function writeDocument(sha = HEAD): Promise<void> {
  await writeFile(
    join(prDir, 'review.json'),
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      pr: { owner: 'northwind-labs', repo: 'tenant-platform', number: 7, head: { sha } },
    }),
    'utf8',
  );
}

function draft(over: Partial<Draft> = {}): Draft {
  return {
    id: 'd1',
    path: 'api/service/record.go',
    line: 92,
    side: 'RIGHT',
    startLine: null,
    startSide: null,
    body: 'status.Error drops the cause here.',
    commitId: HEAD,
    createdAt: '2026-09-10T12:00:00Z',
    updatedAt: '2026-09-10T12:00:00Z',
    ...over,
  };
}

function draftsFile(drafts: Draft[] = [draft()]): DraftsFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    pr: { owner: 'northwind-labs', repo: 'tenant-platform', number: 7 },
    verdict: 'COMMENT',
    summaryBody: 'Two things to fix.',
    drafts,
    updatedAt: '2026-09-10T12:00:00Z',
  };
}

async function put(server: RunningServer, file: unknown): Promise<Response> {
  return fetch(`${server.url}/api/drafts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(file),
  });
}

async function submit(server: RunningServer, body: unknown): Promise<Response> {
  return fetch(`${server.url}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/drafts', () => {
  it('answers with an empty valid file when the reviewer has drafted nothing', async () => {
    const server = await start();
    const response = await fetch(`${server.url}/api/drafts`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as DraftsFile;
    expect(body).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      pr: { owner: 'northwind-labs', repo: 'tenant-platform', number: 7 },
      verdict: null,
      summaryBody: '',
      drafts: [],
    });
    expect(body.updatedAt).toBeUndefined();
  });

  it('carries the drafts a re-analysis could not re-attach', async () => {
    const server = await start();
    await put(server, draftsFile());
    await writeFile(
      join(prDir, 'drafts.orphaned.json'),
      JSON.stringify(draftsFile([draft({ id: 'd9', line: 7 })])),
      'utf8',
    );
    const body = (await (await fetch(`${server.url}/api/drafts`)).json()) as DraftsFile;
    expect(body.drafts).toHaveLength(1);
    expect(body.orphaned?.map((d) => d.id)).toEqual(['d9']);
  });
});

describe('PUT /api/drafts', () => {
  it('round trips the file and stamps when it was written', async () => {
    const server = await start();
    const stored = (await (await put(server, draftsFile())).json()) as DraftsFile;
    expect(stored.drafts[0]?.body).toBe('status.Error drops the cause here.');
    expect(stored.updatedAt).not.toBe('2026-09-10T12:00:00Z');

    const onDisk = JSON.parse(await readFile(join(prDir, 'drafts.json'), 'utf8')) as DraftsFile;
    expect(onDisk).toEqual(stored);

    const served = (await (await fetch(`${server.url}/api/drafts`)).json()) as DraftsFile;
    expect(served).toEqual(stored);
  });

  it('refuses a file that does not validate and writes nothing', async () => {
    const server = await start();
    const response = await put(server, draftsFile([draft({ commitId: 'HEAD' })]));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { errors: Array<{ rule: string }> };
    expect(body.errors.map((e) => e.rule)).toContain('draft-commit-id');
    await expect(readFile(join(prDir, 'drafts.json'), 'utf8')).rejects.toThrow();
  });

  it('does not store an orphan list the cockpit sent back', async () => {
    const server = await start();
    const file = { ...draftsFile(), orphaned: [draft({ id: 'd9' })] };
    const stored = (await (await put(server, file)).json()) as DraftsFile;
    expect(stored.orphaned).toBeUndefined();
  });
});

describe('POST /api/submit', () => {
  it('posts one review with every draft and rotates the drafts file', async () => {
    const server = await start(
      ghStub((call) => (call.args[0] === 'pr' ? head() : created())).gh,
    );
    await writeDocument();
    await put(
      server,
      draftsFile([
        draft(),
        draft({
          id: 'd2',
          path: 'db/migrations/0042.sql',
          line: 12,
          startLine: 9,
          startSide: 'RIGHT',
          body: 'Needs a default.',
        }),
        draft({ id: 'd3', path: 'api/service/record.go', line: 40, side: 'LEFT', body: 'Why did this go?' }),
      ]),
    );

    const response = await submit(server, { verdict: 'COMMENT', summaryBody: 'Two things.' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { url: string; id: number; comments: number; submitted: string };
    expect(body.id).toBe(4242);
    expect(body.url).toContain('pullrequestreview-4242');
    expect(body.comments).toBe(3);

    const submitted = JSON.parse(await readFile(join(prDir, body.submitted), 'utf8')) as DraftsFile;
    expect(submitted.drafts.map((d) => d.id)).toEqual(['d1', 'd2', 'd3']);
    expect(submitted.verdict).toBe('COMMENT');
    expect(body.submitted).toMatch(/^submitted-.*\.json$/);

    const left = JSON.parse(await readFile(join(prDir, 'drafts.json'), 'utf8')) as DraftsFile;
    expect(left.drafts).toEqual([]);
    expect(left.verdict).toBeNull();
  });

  it('sends the review in GitHub review API terms, drafts read from disk', async () => {
    const stub = ghStub((call) => (call.args[0] === 'pr' ? head() : created()));
    const server = await start(stub.gh);
    await writeDocument();
    await put(
      server,
      draftsFile([
        draft(),
        draft({ id: 'd2', line: 12, startLine: 9, startSide: 'RIGHT', body: 'A range.' }),
      ]),
    );

    await submit(server, { verdict: 'REQUEST_CHANGES', summaryBody: 'Please fix.' });

    const post = stub.calls[1];
    expect(post?.args).toEqual([
      'api',
      'repos/northwind-labs/tenant-platform/pulls/7/reviews',
      '-X',
      'POST',
      '--input',
      '-',
    ]);
    expect(JSON.parse(post?.input ?? 'null')).toEqual({
      commit_id: HEAD,
      body: 'Please fix.',
      event: 'REQUEST_CHANGES',
      comments: [
        { path: 'api/service/record.go', line: 92, side: 'RIGHT', body: 'status.Error drops the cause here.' },
        {
          path: 'api/service/record.go',
          line: 12,
          side: 'RIGHT',
          start_line: 9,
          start_side: 'RIGHT',
          body: 'A range.',
        },
      ],
    });
  });

  it('refuses when the head moved and keeps the drafts', async () => {
    const stub = ghStub(() => head(MOVED));
    const server = await start(stub.gh);
    await writeDocument();
    await put(server, draftsFile());

    const response = await submit(server, { verdict: 'COMMENT', summaryBody: '' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'head_moved',
      expected: HEAD,
      actual: MOVED,
    });
    expect(stub.calls).toHaveLength(1);

    const left = JSON.parse(await readFile(join(prDir, 'drafts.json'), 'utf8')) as DraftsFile;
    expect(left.drafts).toHaveLength(1);
    expect((await readdir(prDir)).filter((name) => name.startsWith('submitted-'))).toEqual([]);
  });

  it('maps GitHub refusing to approve your own pull request', async () => {
    const server = await start(
      ghStub((call) =>
        call.args[0] === 'pr'
          ? head()
          : {
              code: 1,
              stdout: '',
              stderr:
                'gh: Unprocessable Entity (HTTP 422)\nCan not approve your own pull request\n',
            },
      ).gh,
    );
    await writeDocument();
    await put(server, draftsFile());

    const response = await submit(server, { verdict: 'APPROVE', summaryBody: 'Looks good.' });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe('own_pr');
    expect(body.message).not.toContain('HTTP 422');

    const left = JSON.parse(await readFile(join(prDir, 'drafts.json'), 'utf8')) as DraftsFile;
    expect(left.drafts).toHaveLength(1);
  });

  it('passes the gh error and exit code back when the post fails', async () => {
    const server = await start(
      ghStub((call) =>
        call.args[0] === 'pr'
          ? head()
          : { code: 1, stdout: '', stderr: 'gh: Validation Failed (HTTP 422)\npath is not part of the diff\n' },
      ).gh,
    );
    await writeDocument();
    await put(server, draftsFile());

    const response = await submit(server, { verdict: 'COMMENT', summaryBody: '' });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: 'gh_failed',
      message: 'gh: Validation Failed (HTTP 422)\npath is not part of the diff',
      exitCode: 1,
    });
  });

  it('refuses a verdict GitHub does not have', async () => {
    const server = await start(ghStub(() => head()).gh);
    await writeDocument();
    const response = await submit(server, { verdict: 'MERGE', summaryBody: '' });
    expect(response.status).toBe(400);
  });

  it('says so when there is no analysed document to bind the comments to', async () => {
    const server = await start(ghStub(() => head()).gh);
    const response = await submit(server, { verdict: 'COMMENT', summaryBody: '' });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'no_document' });
  });
});
