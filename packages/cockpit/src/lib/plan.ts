import type {
  Hunk,
  PathStep,
  Phase,
  PrInfo,
  ReviewFile,
  ReviewMode,
  RiskLevel,
} from '@review-cockpit/schema';
import type { Derived } from './derive';
import { levelRank } from './derive';

export const PHASE_ORDER: Phase[] = ['models', 'core', 'callsites', 'tests', 'config', 'other'];

export const PHASE_LABELS: Record<Phase, string> = {
  models: 'models',
  core: 'core',
  callsites: 'call sites',
  tests: 'tests',
  config: 'config',
  other: 'other',
};

export interface PhaseProgress {
  phase: Phase;
  label: string;
  done: number;
  total: number;
  current: boolean;
}

/**
 * One bar per phase the walk actually uses. `done` counts the steps the reviewer
 * has reached rather than the hunks marked reviewed, so the bars and "Step i of N"
 * always tell the same story.
 */
export function phaseProgress(steps: PathStep[], index: number): PhaseProgress[] {
  const current = steps[index]?.phase ?? null;
  const totals = new Map<Phase, { done: number; total: number }>();
  for (const [at, step] of steps.entries()) {
    const count = totals.get(step.phase) ?? { done: 0, total: 0 };
    count.total += 1;
    if (at <= index) count.done += 1;
    totals.set(step.phase, count);
  }
  return PHASE_ORDER.filter((phase) => totals.has(phase)).map((phase) => {
    const count = totals.get(phase) as { done: number; total: number };
    return {
      phase,
      label: PHASE_LABELS[phase],
      done: count.done,
      total: count.total,
      current: phase === current,
    };
  });
}

export type RailEntry =
  | {
      kind: 'file';
      id: string;
      fileId: string;
      stepIndex: number;
      step: number;
      path: string;
      note: string | null;
      symbol: string | null;
      heat: RiskLevel;
      hunkIds: string[];
    }
  | {
      kind: 'group';
      id: string;
      groupId: string;
      stepIndex: number;
      step: number;
      title: string;
      note: string | null;
      fileCount: number;
      hunkCount: number;
      mode: ReviewMode;
    };

export interface SkippableEntry {
  id: string;
  title: string;
  fileCount: number;
  hunkCount: number;
  /** Where the walk visits this group, or null when the walk skips it entirely. */
  stepIndex: number | null;
}

export interface ReviewOrder {
  entries: RailEntry[];
  skippable: SkippableEntry[];
}

function isSkippableGroup(kind: string, mode: ReviewMode): boolean {
  return mode === 'skim' || kind === 'generated';
}

/**
 * The walk as one row per file, in step order. A file changed at several steps
 * appears once, at the first, because the rail is a place to jump to and a file
 * has one place. Groups the reviewer only skims move out of the order entirely.
 */
export function reviewOrder(derived: Derived): ReviewOrder {
  const entries: RailEntry[] = [];
  const seenFiles = new Set<string>();
  const groupStep = new Map<string, number>();

  for (const [stepIndex, step] of derived.steps.entries()) {
    if (step.ref.kind === 'hunk') {
      const at = derived.hunkById.get(step.ref.id);
      if (at === undefined || seenFiles.has(at.file.id)) continue;
      seenFiles.add(at.file.id);
      entries.push({
        kind: 'file',
        id: at.file.id,
        fileId: at.file.id,
        stepIndex,
        step: step.step,
        path: at.file.path,
        note: step.note,
        symbol: at.hunk.symbols[0] ?? null,
        heat: derived.heatByFile.get(at.file.id) ?? 'low',
        hunkIds: at.file.hunks.map((hunk) => hunk.id),
      });
      continue;
    }

    const group = derived.groupById.get(step.ref.id);
    if (group === undefined) continue;
    groupStep.set(group.id, stepIndex);
    if (isSkippableGroup(group.kind, group.mode)) continue;
    const files = derived.groupFiles.get(group.id) ?? [];
    entries.push({
      kind: 'group',
      id: group.id,
      groupId: group.id,
      stepIndex,
      step: step.step,
      title: group.title,
      note: step.note ?? group.description,
      fileCount: files.length,
      hunkCount: group.hunkIds.length,
      mode: group.mode,
    });
  }

  const skippable: SkippableEntry[] = [];
  for (const group of derived.groupById.values()) {
    if (!isSkippableGroup(group.kind, group.mode)) continue;
    skippable.push({
      id: group.id,
      title: group.title,
      fileCount: (derived.groupFiles.get(group.id) ?? []).length,
      hunkCount: group.hunkIds.length,
      stepIndex: groupStep.get(group.id) ?? null,
    });
  }

  return { entries, skippable };
}

/**
 * Hunks the reviewer may skim: those a skim group folded away, plus those the
 * risk model marked skim on their own. `summary.counts.skimmable` counts only
 * the second set, so grouping 141 hunks into two groups left it reading 81.
 */
export function skippableHunkCount(derived: Derived): number {
  const ids = new Set<string>();
  for (const group of derived.groupById.values()) {
    if (!isSkippableGroup(group.kind, group.mode)) continue;
    for (const id of group.hunkIds) {
      if (derived.hunkById.has(id)) ids.add(id);
    }
  }
  for (const [id, at] of derived.hunkById) {
    if (at.hunk.risk.mode === 'skim') ids.add(id);
  }
  return ids.size;
}

/** High-risk hunks the walk has not reached yet, counted once each. */
export function highRiskAhead(derived: Derived, index: number): number {
  const ids = new Set<string>();
  for (const [stepIndex, step] of derived.steps.entries()) {
    if (stepIndex <= index) continue;
    const hunkIds =
      step.ref.kind === 'hunk'
        ? [step.ref.id]
        : (derived.groupById.get(step.ref.id)?.hunkIds ?? []);
    for (const id of hunkIds) {
      if (derived.hunkById.get(id)?.hunk.risk.level === 'high') ids.add(id);
    }
  }
  return ids.size;
}

/** The heat of a set of hunks: the highest level any of them carries. */
export function heatOf(derived: Derived, hunkIds: string[]): RiskLevel {
  let heat: RiskLevel = 'low';
  for (const id of hunkIds) {
    const level = derived.hunkById.get(id)?.hunk.risk.level;
    if (level !== undefined && levelRank[level] > levelRank[heat]) heat = level;
  }
  return heat;
}

export interface AskContext {
  pr: PrInfo;
  checkoutPath: string;
  file: ReviewFile;
  hunk: Hunk;
}

function hunkText(hunk: Hunk): string {
  return hunk.lines
    .map((line) => `${line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}${line.text}`)
    .join('\n');
}

/**
 * The prompt "Ask Claude about this hunk" puts on the clipboard. It names the
 * checkout so the session can read the surrounding code instead of guessing
 * from the twenty lines of diff it was handed.
 */
export function askClaudePrompt({ pr, checkoutPath, file, hunk }: AskContext): string {
  const symbols = hunk.symbols.length > 0 ? hunk.symbols.join(', ') : '(no enclosing symbol)';
  const range = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
  const newTo = hunk.newStart + Math.max(0, hunk.newLines - 1);
  const risk = hunk.risk.reason
    ? `${hunk.risk.level} — ${hunk.risk.reason}`
    : `${hunk.risk.level}`;

  return [
    `I am reviewing ${pr.owner}/${pr.repo}#${pr.number}: ${pr.title}`,
    pr.url,
    `The repository is checked out at ${checkoutPath}.`,
    '',
    `File: ${file.path}`,
    `Enclosing symbol: ${symbols}`,
    `Hunk: ${range} (new lines ${hunk.newStart}-${newTo})`,
    `Risk: ${risk}`,
    '',
    '```diff',
    hunkText(hunk),
    '```',
    '',
    `Explain what this change does and what could break. The repository is checked out at ${checkoutPath}.`,
  ].join('\n');
}
