import { readFileSync } from 'node:fs';
import type { ReviewDocument } from '@review-cockpit/schema';
import { validateDocument } from '@review-cockpit/schema';
import { describe, expect, it } from 'vitest';
import { carryStage2, judgmentFromDocument } from '../src/carry.js';

const FIXTURES = new URL('../../../fixtures/', import.meta.url);

function fixture(name: string): ReviewDocument {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as ReviewDocument;
}

const NOW = '2026-09-09T08:00:00Z';

describe('carryStage2', () => {
  it('puts the previous judgment back on a fresh stage 1 of the same head', () => {
    const previous = fixture('pr-fake-1.json');
    const outcome = carryStage2(previous, fixture('pr-fake-1.stage1.json'), { now: NOW });

    expect(outcome.kind).toBe('carried');
    if (outcome.kind !== 'carried') return;

    const carried = outcome.document;
    expect(validateDocument(carried).errors).toEqual([]);
    expect(carried.status.groups).toEqual({ state: 'ready', updatedAt: NOW });
    expect(carried.groups.map((group) => group.title)).toEqual(
      previous.groups.map((group) => group.title),
    );
    expect(carried.path.map((step) => [step.ref.kind, step.phase, step.note])).toEqual(
      previous.path.map((step) => [step.ref.kind, step.phase, step.note]),
    );
    expect(carried.summary).toEqual(previous.summary);
  });

  it('keeps the reasons and the raises the judgment pass wrote', () => {
    const previous = fixture('pr-fake-1.json');
    const outcome = carryStage2(previous, fixture('pr-fake-1.stage1.json'), { now: NOW });
    if (outcome.kind !== 'carried') throw new Error(outcome.why);

    const before = previous.files.flatMap((file) => file.hunks);
    const after = outcome.document.files.flatMap((file) => file.hunks);
    const reasons = (hunks: typeof before) =>
      hunks.filter((hunk) => hunk.risk.reason !== null).map((hunk) => hunk.id);
    const raises = (hunks: typeof before) =>
      hunks.filter((hunk) => hunk.risk.adjustedBy !== null).map((hunk) => hunk.id);

    expect(reasons(after)).toEqual(reasons(before));
    expect(raises(after)).toEqual(raises(before));
    expect(raises(after).length).toBeGreaterThan(0);
  });

  it('carries nothing when the head moved', () => {
    const previous = fixture('pr-fake-1.json');
    const fresh = fixture('pr-fake-1.stage1.json');
    fresh.pr.head.sha = 'f'.repeat(40);

    const outcome = carryStage2(previous, fresh, { now: NOW });
    expect(outcome).toEqual({
      kind: 'skipped',
      why: `the head moved from ${previous.pr.head.sha.slice(0, 12)} to ffffffffffff`,
    });
  });

  it('carries nothing when the cached document has no judgment', () => {
    const stage1 = fixture('pr-fake-1.stage1.json');
    const outcome = carryStage2(stage1, stage1, { now: NOW });
    expect(outcome).toEqual({ kind: 'skipped', why: 'the cached document carries no judgment' });
  });

  it('carries nothing when the carried stage 2 no longer fits the diff', () => {
    const previous = fixture('pr-fake-1.json');
    const fresh = fixture('pr-fake-1.stage1.json');
    // The head sha is unchanged, but the diff was taken against a base that moved,
    // so a hunk the walk covered is not in this stage 1 at all.
    fresh.files[6]!.hunks.pop();
    const file = fresh.files[6]!;
    file.additions = file.hunks.reduce(
      (n, hunk) => n + hunk.lines.filter((line) => line.type === 'add').length,
      0,
    );
    file.deletions = file.hunks.reduce(
      (n, hunk) => n + hunk.lines.filter((line) => line.type === 'del').length,
      0,
    );

    const outcome = carryStage2(previous, fresh, { now: NOW });
    expect(outcome.kind).toBe('skipped');
    if (outcome.kind !== 'skipped') return;
    expect(outcome.why).toContain('no longer fits this diff');
  });
});

describe('judgmentFromDocument', () => {
  it('names a stage 2 group by one of its hunks, because the merge assigns the ids', () => {
    const judgment = judgmentFromDocument(fixture('pr-fake-1.json'));
    expect(judgment).not.toBeNull();
    if (judgment === null) return;

    const stage2 = fixture('pr-fake-1.json').groups.filter(
      (group) => group.producedBy === 'stage2',
    );
    const stage2Ids = new Set(stage2.map((group) => group.id));
    const groupSteps = (judgment.path ?? []).filter((step) => step.ref.kind === 'group');

    expect(judgment.groups).toHaveLength(stage2.length);
    expect(groupSteps.some((step) => stage2Ids.has(step.ref.id))).toBe(false);
  });

  it('is null for a document with no ready summary', () => {
    expect(judgmentFromDocument(fixture('pr-fake-1.stage1.json'))).toBeNull();
  });
});
