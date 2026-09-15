// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReadySummary, SectionStatus } from '@review-cockpit/schema';
import { PlanStrip } from '../src/components/PlanStrip';

const ready: SectionStatus = { state: 'ready', updatedAt: '2026-09-08T12:00:00Z' };

const summary: ReadySummary = {
  overview: 'The tenant profile learns which region it runs in. Nothing else changes for callers.',
  tldr: 'Adds region to the tenant profile.',
  whereItFits: ['The tenant profile service.'],
  flow: { before: 'handler -> store', after: 'handler -> validate -> store' },
  example: 'A `PATCH` with `region` now validates.',
  watchFor: [],
  counts: { hunks: 3, highRisk: 1, skimmable: 1 },
};

function render(brief: ReadySummary): string {
  return renderToStaticMarkup(
    <PlanStrip
      summary={brief}
      status={ready}
      prBody=""
      phases={[]}
      stepIndex={0}
      stepCount={3}
      highAhead={1}
      skippable={0}
      open
      onToggle={() => undefined}
    />,
  );
}

describe('the brief panel', () => {
  it('opens with the overview, above the flow', () => {
    const html = render(summary);
    expect(html).toContain('Summary');
    expect(html).toContain('The tenant profile learns which region it runs in.');
    expect(html.indexOf('The tenant profile learns')).toBeLessThan(html.indexOf('Flow'));
  });

  it('shows the TL;DR there when a document predates the overview', () => {
    const { overview: _overview, ...older } = summary;
    const html = render(older as ReadySummary);
    expect(html).toContain('Summary');
    expect(html).toContain('Adds region to the tenant profile.');
  });
});
