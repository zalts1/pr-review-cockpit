import { describe, expect, it } from 'vitest';
import type { Group, MergeLogEntry, ReviewDocument } from '../src/index.js';
import { merge, validateDocument } from '../src/index.js';
import { judgment, readySummaryText, stage1Document } from './helpers.js';

const NOW = '2026-09-08T13:00:00Z';

function rules(log: MergeLogEntry[]): string[] {
  return log.map((entry) => entry.rule);
}

// A judgment that leaves out the walk makes the merge append every hunk, which
// is its own rule. Tests about other rules read the log without those entries.
function rulesOutsideTheWalk(log: MergeLogEntry[]): string[] {
  return rules(log).filter((rule) => !rule.startsWith('path-'));
}

function outsideTheWalk(log: MergeLogEntry[]): MergeLogEntry[] {
  return log.filter((entry) => !entry.rule.startsWith('path-'));
}

function hunk(doc: ReviewDocument, id: string) {
  return doc.files.flatMap((f) => f.hunks).find((h) => h.id === id)!;
}

function stage1Group(hunkIds: string[], kind: Group['kind'] = 'generated'): Group {
  return {
    id: 'g1',
    kind,
    title: 'Generated protobuf output',
    description: '',
    hunkIds,
    mode: 'skim',
    collapsedByDefault: true,
    producedBy: 'stage1',
  };
}

describe('risk adjustments', () => {
  it('applies a raise and records where it came from', () => {
    const { document, log } = merge(
      stage1Document(),
      judgment({
        riskAdjustments: [{ hunkId: 'f1.h1', level: 'high', why: 'Silently changes the mask.' }],
      }),
      { now: NOW },
    );

    const raised = hunk(document, 'f1.h1');
    expect(raised.risk.level).toBe('high');
    expect(raised.risk.mode).toBe('scrutinize');
    expect(raised.risk.adjustedBy).toEqual({
      from: 'low',
      to: 'high',
      why: 'Silently changes the mask.',
    });
    expect(outsideTheWalk(log)).toEqual([]);
  });

  it('drops a proposal below the floor and keeps the floor', () => {
    const { document, log } = merge(
      stage1Document(),
      judgment({ riskAdjustments: [{ hunkId: 'f1.h2', level: 'low', why: 'Looks harmless.' }] }),
      { now: NOW },
    );

    expect(hunk(document, 'f1.h2').risk.level).toBe('high');
    expect(hunk(document, 'f1.h2').risk.adjustedBy).toBeNull();
    expect(outsideTheWalk(log)).toEqual([
      {
        rule: 'risk-adjustment-below-floor',
        hunkId: 'f1.h2',
        detail: 'proposed low, below the deterministic floor high',
      },
    ]);
  });

  it('drops a proposal that raises nothing', () => {
    const { log } = merge(
      stage1Document(),
      judgment({ riskAdjustments: [{ hunkId: 'f1.h2', level: 'high', why: 'Still high.' }] }),
      { now: NOW },
    );
    expect(rulesOutsideTheWalk(log)).toEqual(['risk-adjustment-no-raise']);
  });

  it('drops a proposal for a hunk that does not exist', () => {
    const { log } = merge(
      stage1Document(),
      judgment({ riskAdjustments: [{ hunkId: 'f9.h1', level: 'high', why: 'Invented.' }] }),
      { now: NOW },
    );
    expect(rulesOutsideTheWalk(log)).toEqual(['risk-adjustment-unknown-hunk']);
  });

  it('drops a second proposal for the same hunk', () => {
    const { log } = merge(
      stage1Document(),
      judgment({
        riskAdjustments: [
          { hunkId: 'f1.h1', level: 'medium', why: 'First.' },
          { hunkId: 'f1.h1', level: 'high', why: 'Second.' },
        ],
      }),
      { now: NOW },
    );
    expect(rulesOutsideTheWalk(log)).toEqual(['risk-adjustment-duplicate']);
  });
});

describe('groups', () => {
  it('assigns an id and marks the group as stage 2', () => {
    const { document, log } = merge(
      stage1Document(),
      judgment({
        groups: [
          {
            kind: 'mechanical-rename',
            title: 'Rename Record to Profile',
            hunkIds: ['f1.h1', 'f2.h1'],
            mode: 'skim',
          },
        ],
      }),
      { now: NOW },
    );

    expect(document.groups).toHaveLength(1);
    expect(document.groups[0]).toMatchObject({
      id: 'g1',
      producedBy: 'stage2',
      hunkIds: ['f1.h1', 'f2.h1'],
      description: '',
      collapsedByDefault: true,
    });
    expect(rulesOutsideTheWalk(log)).toEqual([]);
  });

  it('keeps a stage 1 group and numbers around it', () => {
    const doc = stage1Document();
    doc.groups = [stage1Group(['f2.h1'])];

    const { document } = merge(
      doc,
      judgment({
        groups: [{ kind: 'semantic', title: 'Validation', hunkIds: ['f1.h1'], mode: 'scrutinize' }],
      }),
      { now: NOW },
    );

    expect(document.groups.map((g) => `${g.id}:${g.producedBy}`)).toEqual([
      'g1:stage1',
      'g2:stage2',
    ]);
  });

  it('rejects a hunk that a stage 1 group already holds', () => {
    const doc = stage1Document();
    doc.groups = [stage1Group(['f2.h1'])];

    const { document, log } = merge(
      doc,
      judgment({
        groups: [
          { kind: 'semantic', title: 'Everything', hunkIds: ['f1.h1', 'f2.h1'], mode: 'skim' },
        ],
      }),
      { now: NOW },
    );

    expect(document.groups[1]?.hunkIds).toEqual(['f1.h1']);
    expect(log).toContainEqual({
      rule: 'group-duplicate-hunk',
      hunkId: 'f2.h1',
      detail: 'dropped from group "Everything" because group g1 already holds it',
    });
  });

  it('rejects a hunk claimed by two proposed groups and drops a group left empty', () => {
    const { document, log } = merge(
      stage1Document(),
      judgment({
        groups: [
          { kind: 'import', title: 'Imports', hunkIds: ['f1.h1'], mode: 'skim' },
          { kind: 'formatting', title: 'gofmt', hunkIds: ['f1.h1'], mode: 'skim' },
        ],
      }),
      { now: NOW },
    );

    expect(document.groups.map((g) => g.title)).toEqual(['Imports']);
    expect(rulesOutsideTheWalk(log)).toEqual(['group-duplicate-hunk', 'group-empty']);
  });

  it('drops a hunk that does not exist', () => {
    const { document, log } = merge(
      stage1Document(),
      judgment({
        groups: [
          { kind: 'test-update', title: 'Tests', hunkIds: ['f2.h1', 'f9.h1'], mode: 'skim' },
        ],
      }),
      { now: NOW },
    );

    expect(document.groups[0]?.hunkIds).toEqual(['f2.h1']);
    expect(rulesOutsideTheWalk(log)).toEqual(['group-unknown-hunk']);
  });

  it('strips a high-floor hunk out of a skim group', () => {
    const { document, log } = merge(
      stage1Document(),
      judgment({
        groups: [
          {
            kind: 'mechanical-rename',
            title: 'Rename',
            hunkIds: ['f1.h1', 'f1.h2'],
            mode: 'skim',
          },
        ],
      }),
      { now: NOW },
    );

    expect(document.groups[0]?.hunkIds).toEqual(['f1.h1']);
    expect(log).toContainEqual({
      rule: 'skim-group-high-floor',
      hunkId: 'f1.h2',
      detail: 'dropped from the skim group "Rename" because its floor is high',
    });
  });

  it('expands a scrutinize group that asked to be collapsed', () => {
    const { document, log } = merge(
      stage1Document(),
      judgment({
        groups: [
          {
            kind: 'semantic',
            title: 'Validation',
            hunkIds: ['f1.h1'],
            mode: 'scrutinize',
            collapsedByDefault: true,
          },
        ],
      }),
      { now: NOW },
    );

    expect(document.groups[0]?.collapsedByDefault).toBe(false);
    expect(rulesOutsideTheWalk(log)).toEqual(['group-collapsed-scrutinize']);
  });
});

describe('path', () => {
  it('numbers the steps in the order the judgment gave them', () => {
    const { document, log } = merge(
      stage1Document(),
      judgment({
        path: [
          { ref: { kind: 'hunk', id: 'f2.h1' }, phase: 'models', note: 'start here' },
          { ref: { kind: 'hunk', id: 'f1.h2' }, phase: 'core', note: null },
          { ref: { kind: 'hunk', id: 'f1.h1' }, phase: 'tests', note: null },
        ],
      }),
      { now: NOW },
    );

    expect(document.path.map((s) => `${s.step}:${s.ref.id}:${s.phase}`)).toEqual([
      '1:f2.h1:models',
      '2:f1.h2:core',
      '3:f1.h1:tests',
    ]);
    expect(document.path[0]?.note).toBe('start here');
    expect(rules(log)).toEqual([]);
  });

  it('drops a step for a hunk that does not exist', () => {
    const { document, log } = merge(
      stage1Document(),
      judgment({ path: [{ ref: { kind: 'hunk', id: 'f9.h1' }, phase: 'core', note: null }] }),
      { now: NOW },
    );

    expect(document.path.map((s) => s.ref.id)).toEqual(['f1.h1', 'f1.h2', 'f2.h1']);
    expect(rules(log)).toContain('path-unknown-ref');
  });

  it('drops a step that repeats one already walked', () => {
    const { document, log } = merge(
      stage1Document(),
      judgment({
        path: [
          { ref: { kind: 'hunk', id: 'f1.h1' }, phase: 'core', note: null },
          { ref: { kind: 'hunk', id: 'f1.h1' }, phase: 'tests', note: null },
        ],
      }),
      { now: NOW },
    );

    expect(document.path.filter((s) => s.ref.id === 'f1.h1')).toHaveLength(1);
    expect(rules(log)).toContain('path-duplicate-ref');
  });

  it('walks a grouped hunk as its group', () => {
    const { document, log } = merge(
      stage1Document(),
      judgment({
        groups: [
          {
            kind: 'mechanical-rename',
            title: 'Rename',
            hunkIds: ['f1.h1', 'f2.h1'],
            mode: 'skim',
          },
        ],
        path: [
          { ref: { kind: 'hunk', id: 'f1.h1' }, phase: 'callsites', note: 'the rename' },
          { ref: { kind: 'hunk', id: 'f2.h1' }, phase: 'callsites', note: null },
          { ref: { kind: 'hunk', id: 'f1.h2' }, phase: 'core', note: null },
        ],
      }),
      { now: NOW },
    );

    expect(document.path.map((s) => `${s.ref.kind}:${s.ref.id}`)).toEqual([
      'group:g1',
      'hunk:f1.h2',
    ]);
    expect(document.path[0]?.note).toBe('the rename');
    expect(rules(log)).toEqual(['path-hunk-in-group', 'path-duplicate-ref']);
  });

  it('appends a hunk the judgment forgot under phase other', () => {
    const { document, log } = merge(
      stage1Document(),
      judgment({ path: [{ ref: { kind: 'hunk', id: 'f1.h2' }, phase: 'core', note: null }] }),
      { now: NOW },
    );

    expect(document.path.map((s) => `${s.step}:${s.ref.id}:${s.phase}`)).toEqual([
      '1:f1.h2:core',
      '2:f1.h1:other',
      '3:f2.h1:other',
    ]);
    expect(log).toContainEqual({
      rule: 'path-missing-hunk',
      hunkId: 'f1.h1',
      detail: 'was missing from the walk and is appended',
    });
  });

  it('appends a group the judgment forgot and leaves generated groups out', () => {
    const doc = stage1Document();
    doc.groups = [stage1Group(['f2.h1']), { ...stage1Group(['f1.h1'], 'import'), id: 'g2' }];

    const { document, log } = merge(
      doc,
      judgment({ path: [{ ref: { kind: 'hunk', id: 'f1.h2' }, phase: 'core', note: null }] }),
      { now: NOW },
    );

    expect(document.path.map((s) => `${s.ref.kind}:${s.ref.id}`)).toEqual([
      'hunk:f1.h2',
      'group:g2',
    ]);
    expect(rules(log)).toEqual(['path-missing-group']);
  });

  it('drops a group ref the document does not have', () => {
    const { log } = merge(
      stage1Document(),
      judgment({ path: [{ ref: { kind: 'group', id: 'g7' }, phase: 'other', note: null }] }),
      { now: NOW },
    );
    expect(rules(log)).toContain('path-unknown-ref');
  });
});

describe('reasons', () => {
  it('writes the reason onto the hunk', () => {
    const { document, log } = merge(
      stage1Document(),
      judgment({ reasons: { 'f1.h2': 'Changes the error contract of Update.' } }),
      { now: NOW },
    );

    expect(hunk(document, 'f1.h2').risk.reason).toBe('Changes the error contract of Update.');
    expect(rulesOutsideTheWalk(log)).toEqual([]);
  });

  it('drops a reason for a hunk that does not exist', () => {
    const { log } = merge(
      stage1Document(),
      judgment({ reasons: { 'f9.h1': 'Invented.' } }),
      { now: NOW },
    );
    expect(rulesOutsideTheWalk(log)).toEqual(['reason-unknown-hunk']);
  });

  it('cuts a reason at 200 characters', () => {
    const { document, log } = merge(
      stage1Document(),
      judgment({ reasons: { 'f1.h1': 'x'.repeat(240) } }),
      { now: NOW },
    );

    expect(hunk(document, 'f1.h1').risk.reason).toHaveLength(200);
    expect(log).toContainEqual({
      rule: 'reason-too-long',
      hunkId: 'f1.h1',
      detail: 'cut from 240 to 200 characters',
    });
  });
});

describe('summary and status', () => {
  it('copies the text, recomputes the counts and marks stage 2 ready', () => {
    const { document } = merge(
      stage1Document(),
      judgment({
        riskAdjustments: [{ hunkId: 'f1.h1', level: 'high', why: 'Raised.' }],
        summary: { ...readySummaryText(), whereItFits: ['Check the callers.'] },
      }),
      { now: NOW },
    );

    expect(document.summary).toEqual({
      ...readySummaryText(),
      whereItFits: ['Check the callers.'],
      counts: { hunks: 3, highRisk: 2, skimmable: 1 },
    });
    for (const section of ['groups', 'path', 'summary'] as const) {
      expect(document.status[section]).toEqual({ state: 'ready', updatedAt: NOW });
    }
    expect(document.status.graph.state).toBe('pending');
  });
});

describe('the merged document', () => {
  const full = judgment({
    groups: [
      {
        kind: 'mechanical-rename',
        title: 'Rename Record to Profile',
        description: 'Same identifier across two files.',
        hunkIds: ['f1.h1', 'f2.h1'],
        mode: 'skim',
      },
    ],
    path: [
      { ref: { kind: 'hunk', id: 'f1.h2' }, phase: 'core', note: 'the error contract' },
      { ref: { kind: 'hunk', id: 'f1.h1' }, phase: 'callsites', note: 'mechanical' },
    ],
    reasons: { 'f1.h2': 'Callers matching on the sentinel stop matching.' },
    riskAdjustments: [{ hunkId: 'f2.h1', level: 'medium', why: 'Second-guessed the mask.' }],
  });

  it('validates with no errors', () => {
    const { document } = merge(stage1Document(), full, { now: NOW });
    const result = validateDocument(document);
    expect(result.errors).toEqual([]);
  });

  it('leaves the input document untouched', () => {
    const doc = stage1Document();
    const before = structuredClone(doc);
    merge(doc, full, { now: NOW });
    expect(doc).toEqual(before);
  });
});
