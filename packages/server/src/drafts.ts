import { randomBytes } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { DraftsFile, DraftsPr } from '@review-cockpit/schema';
import { SCHEMA_VERSION } from '@review-cockpit/schema/version';
import { DOCUMENT_FILENAME, DRAFTS_FILENAME, ORPHANED_DRAFTS_FILENAME } from './paths.js';

export function emptyDrafts(pr: DraftsPr, updatedAt: string): DraftsFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    pr,
    verdict: null,
    summaryBody: '',
    drafts: [],
    updatedAt,
  };
}

/**
 * The pull request the drafts belong to: the document holds it, and the cache
 * layout <owner>/<repo>/pr-<n> holds it too for a directory with no document yet.
 */
export async function prIdentity(prDir: string): Promise<DraftsPr> {
  const fromDocument = await readJson(join(prDir, DOCUMENT_FILENAME));
  const pr = (fromDocument as { pr?: DraftsPr } | null)?.pr;
  if (pr !== undefined && typeof pr.owner === 'string' && typeof pr.repo === 'string') {
    return { owner: pr.owner, repo: pr.repo, number: pr.number };
  }
  return prFromPath(prDir);
}

export function prFromPath(prDir: string): DraftsPr {
  const repoDir = dirname(prDir);
  const number = Number(/^pr-(\d+)$/.exec(basename(prDir))?.[1] ?? 0);
  return {
    owner: basename(dirname(repoDir)),
    repo: basename(repoDir),
    number: Number.isInteger(number) && number > 0 ? number : 0,
  };
}

/** The head the document was analysed at, which every draft is bound to. */
export async function documentHead(prDir: string): Promise<string | null> {
  const document = await readJson(join(prDir, DOCUMENT_FILENAME));
  const sha = (document as { pr?: { head?: { sha?: unknown } } } | null)?.pr?.head?.sha;
  return typeof sha === 'string' ? sha : null;
}

/** The stored drafts, or an empty file when the reviewer has written none yet. */
export async function readDrafts(prDir: string, now: string): Promise<DraftsFile> {
  const stored = await readJson(join(prDir, DRAFTS_FILENAME));
  if (stored === null) return emptyDrafts(await prIdentity(prDir), now);
  return stored as DraftsFile;
}

export async function readOrphanedDrafts(prDir: string): Promise<DraftsFile['orphaned']> {
  const stored = await readJson(join(prDir, ORPHANED_DRAFTS_FILENAME));
  const drafts = (stored as DraftsFile | null)?.drafts;
  return Array.isArray(drafts) && drafts.length > 0 ? drafts : undefined;
}

export async function writeDrafts(prDir: string, file: DraftsFile): Promise<void> {
  await writeAtomic(join(prDir, DRAFTS_FILENAME), `${JSON.stringify(file, null, 2)}\n`);
}

export function submittedDraftsFilename(when: Date): string {
  return `submitted-${when.toISOString().replace(/[:.]/g, '-')}.json`;
}

/**
 * Keeps what was posted and leaves an empty file behind, so the cockpit that
 * posted it reads zero drafts rather than the ones GitHub now holds.
 */
export async function rotateSubmittedDrafts(
  prDir: string,
  posted: DraftsFile,
  when: Date,
): Promise<string> {
  const name = submittedDraftsFilename(when);
  await writeAtomic(join(prDir, name), `${JSON.stringify(posted, null, 2)}\n`);
  await writeDrafts(prDir, emptyDrafts(posted.pr, when.toISOString()));
  await unlink(join(prDir, ORPHANED_DRAFTS_FILENAME)).catch(() => undefined);
  return name;
}

async function writeAtomic(target: string, contents: string): Promise<void> {
  const temp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, contents, 'utf8');
  try {
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

async function readJson(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
