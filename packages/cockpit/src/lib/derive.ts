import type {
  Comment,
  Group,
  Hunk,
  PathStep,
  ReviewDocument,
  ReviewFile,
  RiskLevel,
  Summary,
} from '../types';

export const SUPPORTED_MAJOR = 1;

export const levelRank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export function majorOf(version: string): number {
  return Number.parseInt(version.split('.')[0] ?? '', 10);
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export interface HunkLocation {
  hunk: Hunk;
  file: ReviewFile;
}

export interface Derived {
  hunkById: Map<string, HunkLocation>;
  fileById: Map<string, ReviewFile>;
  groupById: Map<string, Group>;
  groupOfHunk: Map<string, Group>;
  commentsByHunk: Map<string, Comment[]>;
  outdatedComments: Comment[];
  heatByFile: Map<string, RiskLevel>;
  standaloneFiles: Array<{ file: ReviewFile; hunks: Hunk[] }>;
  groupFiles: Map<string, Array<{ file: ReviewFile; hunks: Hunk[] }>>;
  highHunkIds: string[];
  steps: PathStep[];
  pathIsFallback: boolean;
  summary: Summary | null;
  totals: { hunks: number; high: number; skimmable: number };
}

function fallbackPath(files: ReviewFile[], grouped: Map<string, Group>): PathStep[] {
  const steps: PathStep[] = [];
  for (const file of files) {
    const hunks = file.hunks.filter((h) => !grouped.has(h.id));
    const ordered = [...hunks].sort(
      (a, b) => levelRank[b.risk.level] - levelRank[a.risk.level],
    );
    for (const h of ordered) {
      steps.push({
        step: steps.length + 1,
        ref: { kind: 'hunk', id: h.id },
        phase: 'other',
        note: null,
      });
    }
  }
  return steps;
}

export function derive(doc: ReviewDocument): Derived {
  const hunkById = new Map<string, HunkLocation>();
  const fileById = new Map<string, ReviewFile>();
  const heatByFile = new Map<string, RiskLevel>();

  for (const file of doc.files) {
    fileById.set(file.id, file);
    let heat: RiskLevel = 'low';
    for (const hunk of file.hunks) {
      hunkById.set(hunk.id, { hunk, file });
      if (levelRank[hunk.risk.level] > levelRank[heat]) heat = hunk.risk.level;
    }
    heatByFile.set(file.id, heat);
  }

  const groupById = new Map<string, Group>();
  const groupOfHunk = new Map<string, Group>();
  const groupsReady = doc.status.groups.state === 'ready' || doc.groups.length > 0;
  if (groupsReady) {
    for (const group of doc.groups) {
      groupById.set(group.id, group);
      for (const id of group.hunkIds) {
        if (hunkById.has(id)) groupOfHunk.set(id, group);
      }
    }
  }

  const commentsByHunk = new Map<string, Comment[]>();
  const outdatedComments: Comment[] = [];
  for (const comment of doc.comments) {
    if (comment.hunkId && hunkById.has(comment.hunkId)) {
      const list = commentsByHunk.get(comment.hunkId) ?? [];
      list.push(comment);
      commentsByHunk.set(comment.hunkId, list);
    } else {
      outdatedComments.push(comment);
    }
  }

  const standaloneFiles: Derived['standaloneFiles'] = [];
  const groupFiles = new Map<string, Array<{ file: ReviewFile; hunks: Hunk[] }>>();
  for (const file of doc.files) {
    const free = file.hunks.filter((h) => !groupOfHunk.has(h.id));
    if (free.length > 0) standaloneFiles.push({ file, hunks: free });
    const byGroup = new Map<string, Hunk[]>();
    for (const hunk of file.hunks) {
      const group = groupOfHunk.get(hunk.id);
      if (!group) continue;
      const list = byGroup.get(group.id) ?? [];
      list.push(hunk);
      byGroup.set(group.id, list);
    }
    for (const [groupId, hunks] of byGroup) {
      const entries = groupFiles.get(groupId) ?? [];
      entries.push({ file, hunks });
      groupFiles.set(groupId, entries);
    }
  }

  const allHunks = doc.files.flatMap((f) => f.hunks);
  const highHunkIds = allHunks.filter((h) => h.risk.level === 'high').map((h) => h.id);

  const pathReady = doc.status.path.state === 'ready' && doc.path.length > 0;
  const steps = pathReady ? doc.path : fallbackPath(doc.files, groupOfHunk);

  const summaryReady = doc.status.summary.state === 'ready' && 'oneLiner' in doc.summary;

  return {
    hunkById,
    fileById,
    groupById,
    groupOfHunk,
    commentsByHunk,
    outdatedComments,
    heatByFile,
    standaloneFiles,
    groupFiles,
    highHunkIds,
    steps,
    pathIsFallback: !pathReady,
    summary: summaryReady ? (doc.summary as Summary) : null,
    totals: {
      hunks: allHunks.length,
      high: highHunkIds.length,
      skimmable: allHunks.filter((h) => h.risk.mode === 'skim').length,
    },
  };
}

export function groupLineCount(entries: Array<{ hunks: Hunk[] }>): number {
  return entries.reduce(
    (n, entry) => n + entry.hunks.reduce((m, h) => m + h.lines.length, 0),
    0,
  );
}

export function hunkIdsOfStep(step: PathStep, derived: Derived): string[] {
  if (step.ref.kind === 'hunk') return [step.ref.id];
  const group = derived.groupById.get(step.ref.id);
  return group ? group.hunkIds : [];
}

export function factorText(hunk: Hunk): string {
  return hunk.risk.factors
    .map((f) => (f.detail ? `${f.signal}: ${f.detail}` : f.signal))
    .join(' · ');
}

export function fileOfHunk(id: string, derived: Derived): ReviewFile | undefined {
  return derived.hunkById.get(id)?.file;
}
