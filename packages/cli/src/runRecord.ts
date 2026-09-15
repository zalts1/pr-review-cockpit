import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { JudgmentMode } from '@review-cockpit/analyzer';

/**
 * What `cockpit run` measured, written beside the document. The judgment pass runs in another
 * process, so `stage1At` is the only way the merge can time it: the clock starts when the
 * cockpit became usable, not when the merge was asked for.
 */
export interface RunRecord {
  stage1At: string;
  stage1Seconds: number;
  graphSeconds: number;
  hunks: number;
  files: number;
  mode: JudgmentMode;
}

export function readRunRecord(file: string): RunRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const record = parsed as Partial<RunRecord> | null;
  if (typeof record?.stage1At !== 'string' || typeof record.hunks !== 'number') return null;
  return {
    stage1At: record.stage1At,
    stage1Seconds: record.stage1Seconds ?? 0,
    graphSeconds: record.graphSeconds ?? 0,
    hunks: record.hunks,
    files: record.files ?? 0,
    mode: record.mode === 'headless' ? 'headless' : 'session',
  };
}

export function writeRunRecord(file: string, record: RunRecord): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

export function secondsSince(iso: string, now: number = Date.now()): number {
  const started = Date.parse(iso);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, (now - started) / 1000);
}
