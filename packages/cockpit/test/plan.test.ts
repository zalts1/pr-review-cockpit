import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ReviewDocument } from '@review-cockpit/schema';
import { derive } from '../src/lib/derive';
import {
  askClaudePrompt,
  heatOf,
  highRiskAhead,
  phaseProgress,
  reviewOrder,
  skippableHunkCount,
} from '../src/lib/plan';

function fixture(name: string): ReviewDocument {
  const path = fileURLToPath(new URL(`../../../fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as ReviewDocument;
}

const doc = fixture('pr-fake-1');
const derived = derive(doc);

describe('phaseProgress', () => {
  it('lists only the phases the walk uses, in review order', () => {
    expect(phaseProgress(derived.steps, -1).map((p) => p.label)).toEqual([
      'models',
      'core',
      'call sites',
      'tests',
    ]);
  });

  it('counts nothing done before the walk starts', () => {
    expect(phaseProgress(derived.steps, -1).every((p) => p.done === 0)).toBe(true);
  });

  it('counts the steps reached and marks the phase the reviewer is in', () => {
    const bars = phaseProgress(derived.steps, 4);
    expect(bars.map((p) => `${p.label} ${p.done}/${p.total}`)).toEqual([
      'models 3/3',
      'core 2/5',
      'call sites 0/1',
      'tests 0/3',
    ]);
    expect(bars.filter((p) => p.current).map((p) => p.phase)).toEqual(['core']);
  });

  it('has no current phase past the end of the walk', () => {
    expect(phaseProgress(derived.steps, 99).some((p) => p.current)).toBe(false);
  });

  it('returns nothing for an empty walk', () => {
    expect(phaseProgress([], 0)).toEqual([]);
  });
});

describe('reviewOrder', () => {
  const order = reviewOrder(derived);

  it('lists each file once, at its first step, in walk order', () => {
    expect(order.entries.map((entry) => `${entry.step} ${entry.id}`)).toEqual([
      '1 f3',
      '2 f13',
      '3 f14',
      '4 f7',
      '6 f9',
      '10 f8',
      '12 f20',
    ]);
  });

  it('carries the step note, the enclosing symbol and the file heat', () => {
    const record = order.entries.find((entry) => entry.id === 'f7');
    expect(record).toMatchObject({ kind: 'file', path: 'api/service/tenant/record.go' });
    expect(record?.kind === 'file' && record.heat).toBe('high');
    expect(record?.note).toContain('Imports only');
    expect(record?.kind === 'file' && record.symbol).toBe(
      derived.hunkById.get('f7.h1')?.hunk.symbols[0] ?? null,
    );
  });

  it('keeps skim groups out of the order and lists them as skippable', () => {
    expect(order.entries.some((entry) => entry.kind === 'group')).toBe(false);
    expect(order.skippable).toEqual([
      { id: 'g1', title: 'Generated code', fileCount: 4, hunkCount: 11, stepIndex: null },
      {
        id: 'g2',
        title: 'Rename TenantRecord to TenantProfile',
        fileCount: 9,
        hunkCount: 18,
        stepIndex: 8,
      },
    ]);
  });

  it('walks every file when no judgment pass has written a path', () => {
    const stage1 = derive(fixture('pr-fake-1.stage1'));
    const order = reviewOrder(stage1);
    expect(order.entries.length).toBe(stage1.fileById.size - 4);
    expect(order.skippable.map((group) => group.id)).toEqual(['g1']);
  });

  it('is empty for a PR with no textual changes', () => {
    expect(reviewOrder(derive(fixture('pr-fake-empty')))).toEqual({
      entries: [],
      skippable: [],
    });
  });
});

describe('skippableHunkCount', () => {
  it('counts the hunks a skim group folded away as well as the skim-mode hunks', () => {
    const inGroups = new Set(
      [...derived.groupById.values()].flatMap((group) => group.hunkIds),
    );
    const skimAlone = [...derived.hunkById.values()].filter(
      (at) => at.hunk.risk.mode === 'skim' && !inGroups.has(at.hunk.id),
    ).length;
    expect(skippableHunkCount(derived)).toBe(inGroups.size + skimAlone);
  });

  it('counts a hunk a skim group folded away even when its own mode is scrutinize', () => {
    const one = structuredClone(doc);
    const hunk = one.files.flatMap((file) => file.hunks).find((h) => h.id === 'f7.h2');
    (hunk as NonNullable<typeof hunk>).risk.mode = 'scrutinize';
    const before = skippableHunkCount(derive(one));
    one.groups = [
      ...one.groups,
      {
        id: 'g9',
        kind: 'mechanical-rename',
        title: 'One more rename',
        description: '',
        hunkIds: ['f7.h2'],
        mode: 'skim',
        collapsedByDefault: true,
        producedBy: 'stage2',
      },
    ];
    expect(skippableHunkCount(derive(one))).toBe(before + 1);
  });

  it('is zero when there is nothing to skim', () => {
    expect(skippableHunkCount(derive(fixture('pr-fake-empty')))).toBe(0);
  });
});

describe('highRiskAhead', () => {
  it('counts every high-risk hunk the walk has not reached', () => {
    expect(highRiskAhead(derived, -1)).toBe(highRiskAhead(derived, -1));
    expect(highRiskAhead(derived, -1)).toBeGreaterThan(0);
    expect(highRiskAhead(derived, derived.steps.length)).toBe(0);
  });

  it('never grows as the walk advances', () => {
    const counts = derived.steps.map((_, at) => highRiskAhead(derived, at));
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });
});

describe('heatOf', () => {
  it('takes the highest level of the hunks it is given', () => {
    expect(heatOf(derived, [])).toBe('low');
    expect(heatOf(derived, ['f7.h2'])).toBe('high');
    expect(heatOf(derived, ['f7.h2', 'f3.h1'])).toBe('high');
  });
});

describe('askClaudePrompt', () => {
  const at = derived.hunkById.get('f7.h2');
  const prompt = askClaudePrompt({
    pr: doc.pr,
    checkoutPath: doc.checkout.path,
    file: (at as NonNullable<typeof at>).file,
    hunk: (at as NonNullable<typeof at>).hunk,
  });

  it('names the pull request, its URL and the checkout', () => {
    expect(prompt).toContain(`${doc.pr.owner}/${doc.pr.repo}#${doc.pr.number}`);
    expect(prompt).toContain(doc.pr.title);
    expect(prompt).toContain(doc.pr.url);
    expect(prompt).toContain(doc.checkout.path);
  });

  it('names the file, the enclosing symbol, the hunk range and the risk', () => {
    expect(prompt).toContain('File: api/service/tenant/record.go');
    expect(prompt).toContain('Enclosing symbol: Service.UpdateRecord');
    expect(prompt).toMatch(/Hunk: @@ -\d+,\d+ \+\d+,\d+ @@ \(new lines \d+-\d+\)/);
    expect(prompt).toContain('Risk: high — ');
  });

  it('fences the hunk with its diff markers intact', () => {
    const body = prompt.split('```diff\n')[1]?.split('\n```')[0] ?? '';
    const lines = body.split('\n');
    expect(lines.length).toBe((at as NonNullable<typeof at>).hunk.lines.length);
    expect(lines.some((line) => line.startsWith('+'))).toBe(true);
    expect(lines.every((line) => /^[-+ ]/.test(line))).toBe(true);
  });

  it('ends with the one-line request', () => {
    expect(prompt.trimEnd()).toMatch(
      /Explain what this change does and what could break\. The repository is checked out at .+\.$/,
    );
  });

  it('says so when the hunk has no enclosing symbol', () => {
    const bare = derived.hunkById.get('f13.h1');
    const text = askClaudePrompt({
      pr: doc.pr,
      checkoutPath: doc.checkout.path,
      file: (bare as NonNullable<typeof bare>).file,
      hunk: { ...(bare as NonNullable<typeof bare>).hunk, symbols: [] },
    });
    expect(text).toContain('Enclosing symbol: (no enclosing symbol)');
  });
});
