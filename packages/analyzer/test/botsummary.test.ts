import { describe, expect, it } from 'vitest';
import { cursorSummaryBlock, parseBotSummaries } from '../src/botsummary.js';

const PR_URL = 'https://github.com/northwind-labs/tenant-platform/pull/7';

const body = [
  '## What',
  '',
  'Replaces `TenantRecord` with `TenantProfile`.',
  '',
  '<!-- CURSOR_SUMMARY -->',
  '---',
  '',
  '> [!NOTE]',
  '> **Medium Risk**',
  '> Full-replacement upsert semantics can clear attribution when a caller omits the field.',
  '> ',
  '> **Overview**',
  '> Adds `region`, `tier` and `retention` to the tenant profile, and honours `update_mask`.',
  '> ',
  '> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit d4e5f6a.</sup>',
  '<!-- /CURSOR_SUMMARY -->',
].join('\n');

describe('parseBotSummaries', () => {
  it('reads the level and the overview out of the block', () => {
    expect(parseBotSummaries(body, PR_URL)).toEqual([
      {
        source: { kind: 'bot', name: 'Cursor Bugbot' },
        riskLevel: 'medium',
        body: [
          'Full-replacement upsert semantics can clear attribution when a caller omits the field.',
          '',
          '**Overview**',
          'Adds `region`, `tier` and `retention` to the tenant profile, and honours `update_mask`.',
        ].join('\n'),
        url: PR_URL,
      },
    ]);
  });

  it('is empty when the body carries no block', () => {
    expect(parseBotSummaries('## What\n\nA plain description.', PR_URL)).toEqual([]);
  });

  it('is empty when the opening marker has no closing marker', () => {
    const unterminated = body.replace('<!-- /CURSOR_SUMMARY -->', '');
    expect(parseBotSummaries(unterminated, PR_URL)).toEqual([]);
  });

  it('is empty when the block itself is empty', () => {
    expect(
      parseBotSummaries('<!-- CURSOR_SUMMARY -->\n\n<!-- /CURSOR_SUMMARY -->', PR_URL),
    ).toEqual([]);
  });

  it('keeps an overview that names no level', () => {
    const noLevel = body.replace('> **Medium Risk**\n', '');
    const [summary] = parseBotSummaries(noLevel, PR_URL);
    expect(summary?.riskLevel).toBeNull();
    expect(summary?.body).toContain('**Overview**');
  });

  it('reads a level written as a heading inside the block', () => {
    const heading = [
      '<!-- CURSOR_SUMMARY -->',
      '### High Risk',
      'Drops a column with data in it.',
      '<!-- /CURSOR_SUMMARY -->',
    ].join('\n');
    expect(parseBotSummaries(heading, PR_URL)[0]).toMatchObject({
      riskLevel: 'high',
      body: 'Drops a column with data in it.',
    });
  });
});

describe('cursorSummaryBlock', () => {
  it('returns the text between the markers', () => {
    expect(cursorSummaryBlock(body)).toContain('**Medium Risk**');
    expect(cursorSummaryBlock(body)).not.toContain('CURSOR_SUMMARY');
  });

  it('returns null when there is no block', () => {
    expect(cursorSummaryBlock('no block here')).toBeNull();
  });
});
