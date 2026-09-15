import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { JudgmentMode } from '@review-cockpit/analyzer';

export interface HistoryEntry {
  hunks: number;
  files: number;
  stage1Seconds: number;
  graphSeconds: number;
  judgmentSeconds: number;
  mode: JudgmentMode;
  timestamp: string;
}

/** Twenty runs is a few weeks of reviewing one repository, which is as far back as a median is worth taking. */
export const HISTORY_KEPT = 20;

/** Seconds. Outside these a past run was measuring something else: a cold clone, a laptop asleep mid-pass. */
export const STAGE1_BOUNDS: readonly [number, number] = [2, 180];
export const JUDGMENT_BOUNDS: readonly [number, number] = [45, 900];

export function readHistory(file: string): HistoryEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isEntry);
}

function isEntry(value: unknown): value is HistoryEntry {
  const entry = value as Partial<HistoryEntry> | null;
  return (
    typeof entry?.hunks === 'number' &&
    typeof entry.stage1Seconds === 'number' &&
    typeof entry.judgmentSeconds === 'number' &&
    (entry.mode === 'session' || entry.mode === 'headless')
  );
}

export function appendHistory(file: string, entry: HistoryEntry): HistoryEntry[] {
  const kept = [...readHistory(file), entry].slice(-HISTORY_KEPT);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(kept, null, 2)}\n`, 'utf8');
  return kept;
}

export function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export function clamp(seconds: number, [low, high]: readonly [number, number]): number {
  return Math.min(high, Math.max(low, seconds));
}

export interface Estimate {
  stage1Seconds: number;
  judgmentSeconds: number;
  runs: number;
}

/**
 * The median of the past runs, scaled by hunk count when the caller knows it. Both stages grow
 * with the number of hunks, so a 400-hunk pull request on a repository whose past runs were 40
 * hunks is not a 40-hunk estimate.
 */
export function estimate(history: HistoryEntry[], hunks: number | null): Estimate | null {
  if (history.length === 0) return null;

  const scale = (pick: (entry: HistoryEntry) => number): number | null => {
    if (hunks === null || hunks <= 0) return median(history.map(pick));
    const perHunk = median(
      history.filter((entry) => entry.hunks > 0).map((entry) => pick(entry) / entry.hunks),
    );
    return perHunk === null ? median(history.map(pick)) : perHunk * hunks;
  };

  const stage1 = scale((entry) => entry.stage1Seconds);
  const judgment = scale((entry) => entry.judgmentSeconds);
  if (stage1 === null || judgment === null) return null;

  return {
    stage1Seconds: clamp(stage1, STAGE1_BOUNDS),
    judgmentSeconds: clamp(judgment, JUDGMENT_BOUNDS),
    runs: history.length,
  };
}

export const NO_HISTORY_LINE =
  'estimate: no history for this repo yet; judgment usually takes 3 to 6 minutes';

export function estimateLine(of: Estimate | null): string {
  if (of === null) return NO_HISTORY_LINE;
  const minutes = Math.max(1, Math.round(of.judgmentSeconds / 60));
  const runs = `${of.runs} past run${of.runs === 1 ? '' : 's'}`;
  return `estimate: stage 1 ~${Math.round(of.stage1Seconds)}s, judgment ~${minutes}m (from ${runs} on this repo)`;
}

export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m${String(whole % 60).padStart(2, '0')}s`;
}
