import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../src/history.js';
import {
  appendHistory,
  clamp,
  estimate,
  estimateLine,
  formatDuration,
  HISTORY_KEPT,
  JUDGMENT_BOUNDS,
  median,
  NO_HISTORY_LINE,
  readHistory,
} from '../src/history.js';

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    hunks: 40,
    files: 20,
    stage1Seconds: 8,
    graphSeconds: 3,
    judgmentSeconds: 300,
    mode: 'session',
    timestamp: '2026-09-14T12:00:00Z',
    ...over,
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cockpit-history-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('median', () => {
  it('takes the middle of an odd list and the mean of the middle two of an even one', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 6])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('clamp', () => {
  it('keeps an estimate inside the bounds either way', () => {
    expect(clamp(5, JUDGMENT_BOUNDS)).toBe(JUDGMENT_BOUNDS[0]);
    expect(clamp(5000, JUDGMENT_BOUNDS)).toBe(JUDGMENT_BOUNDS[1]);
    expect(clamp(300, JUDGMENT_BOUNDS)).toBe(300);
  });
});

describe('the history file', () => {
  it('keeps only the last twenty runs', () => {
    const file = join(dir, 'history.json');
    for (let i = 0; i < HISTORY_KEPT + 5; i += 1) appendHistory(file, entry({ hunks: i }));

    const kept = readHistory(file);
    expect(kept).toHaveLength(HISTORY_KEPT);
    expect(kept[0]?.hunks).toBe(5);
    expect(kept.at(-1)?.hunks).toBe(HISTORY_KEPT + 4);
    expect(readFileSync(file, 'utf8').endsWith('\n')).toBe(true);
  });

  it('reads a missing or broken file as no history at all', () => {
    expect(readHistory(join(dir, 'nothing.json'))).toEqual([]);
    appendHistory(join(dir, 'half.json'), entry());
    expect(readHistory(join(dir, 'half.json'))).toHaveLength(1);
  });
});

describe('estimate', () => {
  it('has nothing to say without history', () => {
    expect(estimate([], 40)).toBeNull();
    expect(estimateLine(null)).toBe(NO_HISTORY_LINE);
  });

  it('scales the median linearly by hunk count', () => {
    const history = [entry({ judgmentSeconds: 200 }), entry({ judgmentSeconds: 300 }), entry({ judgmentSeconds: 400 })];

    expect(estimate(history, 40)?.judgmentSeconds).toBe(300);
    expect(estimate(history, 80)?.judgmentSeconds).toBe(600);
    expect(estimate(history, 20)?.judgmentSeconds).toBe(150);
  });

  it('falls back to the raw median when the hunk count is unknown', () => {
    const history = [entry({ stage1Seconds: 6 }), entry({ stage1Seconds: 10 })];
    expect(estimate(history, null)?.stage1Seconds).toBe(8);
  });

  it('clamps a scale that ran away', () => {
    const history = [entry({ judgmentSeconds: 400 })];
    expect(estimate(history, 4000)?.judgmentSeconds).toBe(JUDGMENT_BOUNDS[1]);
  });

  it('formats the line with the run count', () => {
    expect(estimateLine({ stage1Seconds: 8.4, judgmentSeconds: 290, runs: 3 })).toBe(
      'estimate: stage 1 ~8s, judgment ~5m (from 3 past runs on this repo)',
    );
    expect(estimateLine({ stage1Seconds: 8, judgmentSeconds: 60, runs: 1 })).toContain(
      'from 1 past run on this repo',
    );
  });
});

describe('formatDuration', () => {
  it('reads as a clock past a minute', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(130)).toBe('2m10s');
    expect(formatDuration(270)).toBe('4m30s');
  });
});
