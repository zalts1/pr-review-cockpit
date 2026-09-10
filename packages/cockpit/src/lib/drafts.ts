import type { Draft, DraftsFile, PrInfo, ReviewFile, Side } from '@review-cockpit/schema';
import { SCHEMA_VERSION } from '@review-cockpit/schema/version';

/** A draft plus the two ids the renderer needs to place it under its hunk. */
export interface CockpitDraft extends Draft {
  fileId: string;
  hunkId: string;
}

export interface DraftsContent {
  drafts: CockpitDraft[];
  verdict: DraftsFile['verdict'];
  summaryBody: string;
  updatedAt: string | null;
}

export function draftsKey(pr: PrInfo, fixture: string): string {
  return `review-cockpit:drafts:${pr.owner}/${pr.repo}#${pr.number}:${fixture}`;
}

export function draftsFileOf(pr: PrInfo, content: DraftsContent): DraftsFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    pr: { owner: pr.owner, repo: pr.repo, number: pr.number },
    verdict: content.verdict,
    summaryBody: content.summaryBody,
    drafts: content.drafts,
    ...(content.updatedAt === null ? {} : { updatedAt: content.updatedAt }),
  };
}

export function loadDraftsFile(key: string): DraftsFile | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // Drafts were stored as a bare array before the drafts file had a schema.
    if (Array.isArray(parsed)) {
      return {
        schemaVersion: SCHEMA_VERSION,
        pr: { owner: '', repo: '', number: 0 },
        verdict: null,
        summaryBody: '',
        drafts: draftsOf(parsed as Draft[]),
      };
    }
    const file = parsed as DraftsFile | null;
    if (file === null || !Array.isArray(file.drafts)) return null;
    return { ...file, drafts: draftsOf(file.drafts) };
  } catch {
    return null;
  }
}

export function saveDrafts(key: string, file: DraftsFile): void {
  try {
    localStorage.setItem(key, JSON.stringify(file));
  } catch {
    // A browser with site data blocked keeps the drafts in memory for this session only.
  }
}

export function draftsOf(drafts: readonly Draft[]): CockpitDraft[] {
  return drafts.filter(isDraft).map(withUpdatedAt);
}

function isDraft(value: Draft): boolean {
  return typeof value.id === 'string' && typeof value.path === 'string';
}

function withUpdatedAt(draft: Draft): CockpitDraft {
  const full = draft as CockpitDraft;
  return { ...full, updatedAt: full.updatedAt ?? full.createdAt };
}

function lineKey(path: string, side: Side, line: number): string {
  return `${path} ${side} ${line}`;
}

/** Which file and hunk holds each line the reviewer can comment on. */
export function lineOwners(files: readonly ReviewFile[]): Map<string, { fileId: string; hunkId: string }> {
  const owners = new Map<string, { fileId: string; hunkId: string }>();
  for (const file of files) {
    for (const hunk of file.hunks) {
      const at = { fileId: file.id, hunkId: hunk.id };
      for (const line of hunk.lines) {
        if (line.oldNo !== null) owners.set(lineKey(file.path, 'LEFT', line.oldNo), at);
        if (line.newNo !== null) owners.set(lineKey(file.path, 'RIGHT', line.newNo), at);
      }
    }
  }
  return owners;
}

/**
 * Puts each draft under the hunk that now holds its line. A re-analysis
 * renumbers hunk ids, so the ids stored with a draft are a hint and the line
 * is the truth.
 */
export function placeDrafts(
  drafts: readonly CockpitDraft[],
  owners: ReadonlyMap<string, { fileId: string; hunkId: string }>,
): CockpitDraft[] {
  return drafts.map((draft) => {
    const at = owners.get(lineKey(draft.path, draft.side, draft.line));
    return at === undefined ? draft : { ...draft, ...at };
  });
}

export function draftTarget(draft: Draft): string {
  const range = draft.startLine !== null && draft.startLine !== draft.line
    ? `${draft.startLine}–${draft.line}`
    : `${draft.line}`;
  return `${draft.path}:${range} (${draft.side})`;
}

/**
 * A one-line preview. Inline markdown markers are stripped rather than
 * rendered, because a chip that shows `**bold**` reads as a bug.
 */
export function preview(body: string, length = 60): string {
  const flat = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > length ? `${flat.slice(0, length)}…` : flat;
}
