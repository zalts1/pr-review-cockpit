import type { PrInfo, Side } from '../types';

export interface Draft {
  id: string;
  fileId: string;
  hunkId: string;
  path: string;
  side: Side;
  line: number;
  startLine: number | null;
  startSide: Side | null;
  body: string;
  commitId: string;
  createdAt: string;
}

export function draftsKey(pr: PrInfo, fixture: string): string {
  return `review-cockpit:drafts:${pr.owner}/${pr.repo}#${pr.number}:${fixture}`;
}

export function loadDrafts(key: string): Draft[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Draft[]) : [];
  } catch {
    return [];
  }
}

export function saveDrafts(key: string, drafts: Draft[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(drafts));
  } catch {
    // A browser with site data blocked keeps the drafts in memory for this session only.
  }
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
