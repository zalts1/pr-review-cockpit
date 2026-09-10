import type { BotSummary, RiskLevel } from '@review-cockpit/schema';

/** Cursor Bugbot wraps its pull request summary in these, and nothing else does. */
const CURSOR_BLOCK = /<!--\s*CURSOR_SUMMARY\s*-->([\s\S]*?)<!--\s*\/CURSOR_SUMMARY\s*-->/i;

const RISK_LEVEL = /\b(low|medium|high)\s+risk\b/i;
const ALERT_MARKER = /^\[!(?:note|tip|important|warning|caution)\]\s*/i;
const SUP_LINE = /^<sup>[\s\S]*<\/sup>$/i;

export function cursorSummaryBlock(body: string): string | null {
  const match = CURSOR_BLOCK.exec(body);
  return match ? (match[1] as string) : null;
}

function withoutMarkup(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/[*_`]/g, '')
    .trim();
}

function isRiskLevelLine(line: string): boolean {
  return /^(low|medium|high)\s+risk$/i.test(withoutMarkup(line));
}

/**
 * The overview is the block with its scaffolding removed: the blockquote the
 * alert is written as, the alert marker, the level line the pill already says,
 * and the "Reviewed by" footer the pill's link replaces.
 */
export function overviewOf(block: string): string {
  const lines = block.split('\n').map((line) => line.replace(/^\s*>\s?/, '').trimEnd());
  const kept: string[] = [];

  for (const line of lines) {
    const bare = line.trim();
    if (bare === '---' || bare === '') {
      kept.push('');
      continue;
    }
    if (SUP_LINE.test(bare)) continue;
    const withoutAlert = bare.replace(ALERT_MARKER, '');
    if (withoutAlert === '' || isRiskLevelLine(withoutAlert)) continue;
    kept.push(withoutAlert === bare ? line : withoutAlert);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function riskLevelOf(block: string): RiskLevel | null {
  const match = RISK_LEVEL.exec(block);
  return match ? (match[1]?.toLowerCase() as RiskLevel) : null;
}

/** Empty when the body carries no bot summary, so the field is written either way. */
export function parseBotSummaries(body: string, url: string): BotSummary[] {
  const block = cursorSummaryBlock(body);
  if (block === null) return [];

  const riskLevel = riskLevelOf(block);
  const overview = overviewOf(block);
  if (riskLevel === null && overview === '') return [];

  return [{ source: { kind: 'bot', name: 'Cursor Bugbot' }, riskLevel, body: overview, url }];
}
