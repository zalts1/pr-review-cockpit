import type {
  Group,
  Hunk,
  PathStep,
  ReviewDocument,
  RiskLevel,
} from './generated/document.js';
import type { Judgment } from './generated/judgment.js';
import { REASON_MAX_LENGTH, summaryCounts } from './validate.js';

export interface MergeLogEntry {
  rule: string;
  hunkId?: string;
  detail: string;
}

export interface MergeResult {
  document: ReviewDocument;
  log: MergeLogEntry[];
}

export interface MergeOptions {
  now?: string;
}

const levelRank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

function nextGroupNumber(groups: Group[]): number {
  let highest = 0;
  for (const group of groups) {
    const match = /^g(\d+)$/.exec(group.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

export function merge(
  document: ReviewDocument,
  judgment: Judgment,
  options: MergeOptions = {},
): MergeResult {
  const merged = structuredClone(document);
  const log: MergeLogEntry[] = [];
  const note = (rule: string, detail: string, hunkId?: string): void => {
    log.push(hunkId === undefined ? { rule, detail } : { rule, hunkId, detail });
  };
  const now = options.now ?? new Date().toISOString();

  const hunkById = new Map<string, Hunk>();
  for (const file of merged.files) {
    for (const hunk of file.hunks) hunkById.set(hunk.id, hunk);
  }

  applyRiskAdjustments(judgment, hunkById, note);
  const groupOfHunk = applyGroups(merged, judgment, hunkById, note);
  applyPath(merged, judgment, groupOfHunk, hunkById, note);
  applyReasons(judgment, hunkById, note);

  merged.summary = {
    oneLiner: judgment.summary.oneLiner,
    reviewFocus: [...judgment.summary.reviewFocus],
    counts: summaryCounts(merged),
  };

  for (const section of ['groups', 'path', 'summary'] as const) {
    merged.status[section] = { state: 'ready', updatedAt: now };
  }

  return { document: merged, log };
}

type Note = (rule: string, detail: string, hunkId?: string) => void;

function applyRiskAdjustments(
  judgment: Judgment,
  hunkById: Map<string, Hunk>,
  note: Note,
): void {
  const seen = new Set<string>();

  for (const proposal of judgment.riskAdjustments ?? []) {
    const hunk = hunkById.get(proposal.hunkId);
    if (!hunk) {
      note('risk-adjustment-unknown-hunk', 'no such hunk in the document', proposal.hunkId);
      continue;
    }
    if (seen.has(proposal.hunkId)) {
      note('risk-adjustment-duplicate', 'a second adjustment for the same hunk', proposal.hunkId);
      continue;
    }
    seen.add(proposal.hunkId);

    if (levelRank[proposal.level] < levelRank[hunk.risk.floor]) {
      note(
        'risk-adjustment-below-floor',
        `proposed ${proposal.level}, below the deterministic floor ${hunk.risk.floor}`,
        proposal.hunkId,
      );
      continue;
    }
    if (levelRank[proposal.level] <= levelRank[hunk.risk.level]) {
      note(
        'risk-adjustment-no-raise',
        `proposed ${proposal.level}, which is not above the current level ${hunk.risk.level}`,
        proposal.hunkId,
      );
      continue;
    }

    hunk.risk.adjustedBy = { from: hunk.risk.floor, to: proposal.level, why: proposal.why };
    hunk.risk.level = proposal.level;
    hunk.risk.mode = proposal.level === 'low' ? 'skim' : 'scrutinize';
  }
}

function applyGroups(
  merged: ReviewDocument,
  judgment: Judgment,
  hunkById: Map<string, Hunk>,
  note: Note,
): Map<string, Group> {
  const kept = merged.groups.filter((group) => group.producedBy === 'stage1');
  const owner = new Map<string, Group>();
  for (const group of kept) {
    for (const hunkId of group.hunkIds) owner.set(hunkId, group);
  }

  let number = nextGroupNumber(kept);
  const added: Group[] = [];

  for (const proposal of judgment.groups ?? []) {
    const id = `g${number}`;
    const hunkIds: string[] = [];

    for (const hunkId of proposal.hunkIds) {
      const hunk = hunkById.get(hunkId);
      if (!hunk) {
        note('group-unknown-hunk', `dropped from group "${proposal.title}"`, hunkId);
        continue;
      }
      const claimed = owner.get(hunkId);
      if (claimed) {
        note(
          'group-duplicate-hunk',
          `dropped from group "${proposal.title}" because group ${claimed.id} already holds it`,
          hunkId,
        );
        continue;
      }
      if (proposal.mode === 'skim' && hunk.risk.floor === 'high') {
        note(
          'skim-group-high-floor',
          `dropped from the skim group "${proposal.title}" because its floor is high`,
          hunkId,
        );
        continue;
      }
      hunkIds.push(hunkId);
    }

    if (hunkIds.length === 0) {
      note('group-empty', `group "${proposal.title}" kept no hunks and was dropped`);
      continue;
    }

    let collapsedByDefault = proposal.collapsedByDefault ?? (proposal.mode === 'skim');
    if (proposal.mode === 'scrutinize' && collapsedByDefault) {
      note(
        'group-collapsed-scrutinize',
        `group "${proposal.title}" asked to be collapsed while asking to be scrutinized; it is expanded`,
      );
      collapsedByDefault = false;
    }

    const group: Group = {
      id,
      kind: proposal.kind,
      title: proposal.title,
      description: proposal.description ?? '',
      hunkIds,
      mode: proposal.mode,
      collapsedByDefault,
      producedBy: 'stage2',
    };
    for (const hunkId of hunkIds) owner.set(hunkId, group);
    added.push(group);
    number += 1;
  }

  merged.groups = [...kept, ...added];
  return owner;
}

function applyPath(
  merged: ReviewDocument,
  judgment: Judgment,
  groupOfHunk: Map<string, Group>,
  hunkById: Map<string, Hunk>,
  note: Note,
): void {
  const groupById = new Map(merged.groups.map((group) => [group.id, group]));
  const steps: PathStep[] = [];
  const walkedGroups = new Set<string>();
  const walkedHunks = new Set<string>();

  const push = (ref: PathStep['ref'], phase: PathStep['phase'], text: string | null): void => {
    if (ref.kind === 'group') walkedGroups.add(ref.id);
    else walkedHunks.add(ref.id);
    steps.push({ step: steps.length + 1, ref, phase, note: text });
  };

  for (const proposal of judgment.path ?? []) {
    if (proposal.ref.kind === 'group') {
      if (!groupById.has(proposal.ref.id)) {
        note('path-unknown-ref', `no group ${proposal.ref.id} in the document`);
        continue;
      }
      if (walkedGroups.has(proposal.ref.id)) {
        note('path-duplicate-ref', `group ${proposal.ref.id} is already in the walk`);
        continue;
      }
      push({ kind: 'group', id: proposal.ref.id }, proposal.phase, proposal.note ?? null);
      continue;
    }

    const hunkId = proposal.ref.id;
    if (!hunkById.has(hunkId)) {
      note('path-unknown-ref', 'no such hunk in the document', hunkId);
      continue;
    }
    const group = groupOfHunk.get(hunkId);
    if (group) {
      if (walkedGroups.has(group.id)) {
        note(
          'path-duplicate-ref',
          `group ${group.id}, which holds this hunk, is already in the walk`,
          hunkId,
        );
        continue;
      }
      note('path-hunk-in-group', `walked as group ${group.id}, which holds it`, hunkId);
      push({ kind: 'group', id: group.id }, proposal.phase, proposal.note ?? null);
      continue;
    }
    if (walkedHunks.has(hunkId)) {
      note('path-duplicate-ref', 'already in the walk', hunkId);
      continue;
    }
    push({ kind: 'hunk', id: hunkId }, proposal.phase, proposal.note ?? null);
  }

  for (const file of merged.files) {
    for (const hunk of file.hunks) {
      const group = groupOfHunk.get(hunk.id);
      if (group) {
        if (group.kind === 'generated' || walkedGroups.has(group.id)) continue;
        push({ kind: 'group', id: group.id }, 'other', null);
        note('path-missing-group', `group ${group.id} was missing from the walk and is appended`);
        continue;
      }
      if (walkedHunks.has(hunk.id)) continue;
      push({ kind: 'hunk', id: hunk.id }, 'other', null);
      note('path-missing-hunk', 'was missing from the walk and is appended', hunk.id);
    }
  }

  merged.path = steps;
}

function applyReasons(judgment: Judgment, hunkById: Map<string, Hunk>, note: Note): void {
  for (const [hunkId, reason] of Object.entries(judgment.reasons ?? {})) {
    const hunk = hunkById.get(hunkId);
    if (!hunk) {
      note('reason-unknown-hunk', 'no such hunk in the document', hunkId);
      continue;
    }
    if (reason.length > REASON_MAX_LENGTH) {
      note(
        'reason-too-long',
        `cut from ${reason.length} to ${REASON_MAX_LENGTH} characters`,
        hunkId,
      );
    }
    hunk.risk.reason = reason.slice(0, REASON_MAX_LENGTH);
  }
}
