import type { Draft, DraftsFile, PrInfo } from '@review-cockpit/schema';
import { SCHEMA_VERSION } from '@review-cockpit/schema/version';

/** A draft plus the two ids the renderer needs to place it under its hunk. */
export interface CockpitDraft extends Draft {
  fileId: string;
  hunkId: string;
}

export function draftsKey(pr: PrInfo, fixture: string): string {
  return `review-cockpit:drafts:${pr.owner}/${pr.repo}#${pr.number}:${fixture}`;
}

export function draftsFileOf(pr: PrInfo, drafts: CockpitDraft[]): DraftsFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    pr: { owner: pr.owner, repo: pr.repo, number: pr.number },
    verdict: null,
    summaryBody: '',
    drafts,
  };
}

export function loadDrafts(key: string): CockpitDraft[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Drafts were stored as a bare array before the drafts file had a schema.
    const drafts = Array.isArray(parsed)
      ? parsed
      : ((parsed as Partial<DraftsFile> | null)?.drafts ?? []);
    return (drafts as Array<Partial<CockpitDraft>>).filter(isDraft).map(withUpdatedAt);
  } catch {
    return [];
  }
}

export function saveDrafts(key: string, file: DraftsFile): void {
  try {
    localStorage.setItem(key, JSON.stringify(file));
  } catch {
    // A browser with site data blocked keeps the drafts in memory for this session only.
  }
}

function isDraft(value: Partial<CockpitDraft>): boolean {
  return typeof value.id === 'string' && typeof value.hunkId === 'string';
}

function withUpdatedAt(draft: Partial<CockpitDraft>): CockpitDraft {
  const full = draft as CockpitDraft;
  return { ...full, updatedAt: full.updatedAt ?? full.createdAt };
}

export function draftTarget(draft: Draft): string {
  const range = draft.startLine !== null && draft.startLine !== draft.line
    ? `${draft.startLine}–${draft.line}`
    : `${draft.line}`;
  return `${draft.path}:${range} (${draft.side})`;
}

export function preview(body: string, length = 60): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length)}…` : flat;
}
