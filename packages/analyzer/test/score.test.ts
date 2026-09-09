import { describe, expect, it } from 'vitest';
import type { FileSignals } from '@review-cockpit/schema';
import type { HunkFeatures } from '../src/features.js';
import {
  floorOf,
  levelOf,
  normAuthorPrior,
  normComplexity,
  normFanIn,
  riskOf,
} from '../src/score.js';

function signals(overrides: Partial<FileSignals> = {}): FileSignals {
  return {
    churnCommits90d: 0,
    bugfixCommits: 0,
    authorPriorCommits: 3,
    fanIn: 0,
    fanOut: null,
    fanSource: 'grep',
    complexityBefore: 0,
    complexityAfter: 0,
    sensitivePath: { match: false, rule: null },
    testFile: false,
    coverageDelta: null,
    ...overrides,
  };
}

function features(overrides: Partial<HunkFeatures> = {}): HunkFeatures {
  return {
    size: 0,
    deleteRatio: 0,
    hazards: 0,
    hazardNames: [],
    touchesErrorPath: false,
    touchesPublicSurface: false,
    ...overrides,
  };
}

describe('the worked example from docs/05', () => {
  const risk = riskOf({
    path: 'api/service/tenant/record.go',
    kind: 'code',
    generated: { is: false, rule: null },
    signals: signals({
      churnCommits90d: 14,
      bugfixCommits: 5,
      authorPriorCommits: 0,
      fanIn: 23,
      complexityBefore: 18,
      complexityAfter: 27,
    }),
    features: features({
      size: 31,
      deleteRatio: 0.3,
      touchesErrorPath: true,
      touchesPublicSurface: true,
    }),
  });

  it('scores 0.65 and reads high', () => {
    expect(risk.score).toBe(0.65);
    expect(risk.floor).toBe('high');
    expect(risk.level).toBe('high');
    expect(risk.mode).toBe('scrutinize');
  });

  it('lists the top three contributions, no floor rule among them', () => {
    expect(risk.factors.map((f) => f.signal)).toEqual([
      'bugfixCommits',
      'fanIn',
      'authorPriorCommits',
    ]);
    expect(risk.factors[1]?.detail).toBe('23 callers');
    expect(risk.factors[0]?.detail).toBe('5 fix commits in 90 days');
  });
});

describe('normalisation', () => {
  it('maps 63 callers to 1', () => {
    expect(normFanIn(63)).toBe(1);
    expect(normFanIn(null)).toBe(0);
  });

  it('reads an unknown author history as zero, not as a first touch', () => {
    expect(normAuthorPrior(null)).toBe(0);
    expect(normAuthorPrior(0)).toBe(1);
    expect(normAuthorPrior(2)).toBe(0.5);
    expect(normAuthorPrior(3)).toBe(0);
  });

  it('counts complexity growth and surcharges a complex result', () => {
    expect(normComplexity(18, 27)).toBe(1);
    expect(normComplexity(2, 4)).toBeCloseTo(0.2);
    expect(normComplexity(20, 14)).toBe(0);
    expect(normComplexity(null, 14)).toBe(0);
  });

  it('puts the thresholds where the doc puts them', () => {
    expect(levelOf(0.55)).toBe('high');
    expect(levelOf(0.54)).toBe('medium');
    expect(levelOf(0.28)).toBe('medium');
    expect(levelOf(0.27)).toBe('low');
  });
});

describe('floor rules', () => {
  const base = {
    path: 'api/service/tenant/record.go',
    kind: 'code' as const,
    generated: { is: false, rule: null },
    signals: signals(),
    features: features(),
  };

  it('floors a sensitive code hunk high', () => {
    const decision = floorOf(0, {
      ...base,
      signals: signals({ sensitivePath: { match: true, rule: '**/auth/**' } }),
      features: features({ size: 3 }),
    });
    expect(decision.floor).toBe('high');
    expect(decision.rule).toBe('sensitivePath');
  });

  it('floors any change in a migration high', () => {
    const decision = floorOf(0, {
      ...base,
      path: 'db/migrations/0042_add_column.sql',
      signals: signals({ sensitivePath: { match: true, rule: '**/migrations/**' } }),
      features: features({ size: 1 }),
    });
    expect(decision.floor).toBe('high');
  });

  it('floors a large deletion medium', () => {
    expect(floorOf(0, { ...base, features: features({ size: 24, deleteRatio: 0.8 }) }).floor).toBe(
      'medium',
    );
    expect(floorOf(0, { ...base, features: features({ size: 12, deleteRatio: 0.8 }) }).floor).toBe(
      'low',
    );
  });

  it('floors deleted tests medium', () => {
    const decision = floorOf(0, {
      ...base,
      kind: 'test',
      signals: signals({ testFile: true }),
      features: features({ size: 8, deleteRatio: 0.6 }),
    });
    expect(decision.floor).toBe('medium');
    expect(decision.rule).toBe('testDeletes');
  });

  it('floors two hazardous lines medium', () => {
    expect(floorOf(0, { ...base, features: features({ size: 4, hazards: 2 }) }).floor).toBe('medium');
    expect(floorOf(0, { ...base, features: features({ size: 4, hazards: 1 }) }).floor).toBe('low');
  });

  it('floors trivial kinds low whatever the file signals say', () => {
    const loud = {
      ...base,
      signals: signals({
        sensitivePath: { match: true, rule: '**/auth/**' },
        churnCommits90d: 30,
        bugfixCommits: 9,
        authorPriorCommits: 0,
        fanIn: 200,
      }),
      features: features({ size: 40, hazards: 4 }),
    };
    for (const kind of ['import', 'whitespace-only', 'comment-only'] as const) {
      const risk = riskOf({ ...loud, kind });
      expect(risk.floor).toBe('low');
      expect(risk.mode).toBe('skim');
      expect(risk.factors[0]?.signal).toBe('floor');
    }
  });

  it('floors a generated file low and says which rule folded it', () => {
    const risk = riskOf({
      ...base,
      path: 'api/gen/service.pb.go',
      generated: { is: true, rule: '**/*.pb.go' },
      signals: signals({ churnCommits90d: 30, fanIn: 90 }),
      features: features({ size: 300 }),
    });
    expect(risk.floor).toBe('low');
    expect(risk.factors[0]?.detail).toContain('**/*.pb.go');
  });

  it('keeps a generated file scored when folding is off', () => {
    const risk = riskOf({
      ...base,
      path: 'api/gen/service.pb.go',
      generated: { is: false, rule: '**/*.pb.go' },
      signals: signals({ churnCommits90d: 30, bugfixCommits: 4, authorPriorCommits: 0, fanIn: 90 }),
      features: features({ size: 300, touchesPublicSurface: true }),
    });
    expect(risk.floor).not.toBe('low');
  });
});
