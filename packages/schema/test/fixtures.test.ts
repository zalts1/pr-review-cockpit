import { describe, expect, it } from 'vitest';
import { checkVersion, validateDocument } from '../src/index.js';
import { fixture, fixtureNames } from './helpers.js';

describe.each(fixtureNames())('%s', (name) => {
  it('validates with no errors and no warnings', () => {
    const result = validateDocument(fixture(name));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('carries a supported major version', () => {
    expect(checkVersion(fixture(name)).ok).toBe(true);
  });
});

describe('a hand-broken copy of pr-fake-1', () => {
  it('names every break, with its path and its rule', () => {
    const doc = fixture('pr-fake-1.json');

    doc.files[12]!.hunks[0]!.risk.level = 'low';
    doc.files[12]!.hunks[0]!.risk.mode = 'skim';
    doc.path.splice(3, 1);
    doc.path.forEach((step, i) => (step.step = i + 1));
    doc.comments[0]!.line = 400;

    const result = validateDocument(doc);

    expect(result.errors.map((error) => `${error.rule} at ${error.path}`)).toEqual([
      'risk-floor at files[12].hunks[0].risk.level',
      'comment-hunk-line at comments[0].line',
      'path-coverage at files[6].hunks[0]',
      'summary-counts at summary.counts.highRisk',
      'summary-counts at summary.counts.skimmable',
    ]);

    expect(result.errors.map((error) => error.message)).toContain(
      'files[12].hunks[0].risk.level: is low, below the deterministic floor high. ' +
        'The judgment pass may raise a level, never lower it.',
    );
    expect(result.errors.map((error) => error.message)).toContain(
      'comments[0].line: is 400 on the RIGHT side, which is outside hunk f7.h2 (91 to 126)',
    );
    expect(result.errors.map((error) => error.message)).toContain(
      'files[6].hunks[0]: hunk f7.h1 is not covered by path, directly or through a group. ' +
        'Every hunk outside a generated group is walked exactly once.',
    );
  });
});
