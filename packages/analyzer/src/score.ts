import type { FileSignals, HunkKind, Risk, RiskFactor, RiskLevel } from '@review-cockpit/schema';
import type { HunkFeatures } from './features.js';
import { firstMatch } from './glob.js';
import { MIGRATION_PATHS } from './patterns.js';

export const WEIGHTS = {
  sensitivePath: 0.18,
  fanIn: 0.15,
  bugfixCommits: 0.12,
  churnCommits90d: 0.1,
  authorPriorCommits: 0.1,
  complexity: 0.1,
  hazards: 0.08,
  touchesErrorPath: 0.07,
  touchesPublicSurface: 0.05,
  size: 0.05,
} as const;

export const HIGH_THRESHOLD = 0.55;
export const MEDIUM_THRESHOLD = 0.28;

export type SignalName = keyof typeof WEIGHTS;

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

export function normChurn(commits: number | null): number {
  return commits === null ? 0 : clamp01(commits / 15);
}

export function normBugfix(commits: number | null): number {
  return commits === null ? 0 : clamp01(commits / 4);
}

export function normAuthorPrior(commits: number | null): number {
  if (commits === null) return 0;
  if (commits === 0) return 1;
  if (commits <= 2) return 0.5;
  return 0;
}

export function normFanIn(callers: number | null): number {
  return callers === null ? 0 : clamp01(Math.log2(1 + callers) / 6);
}

/** Growth only, plus a surcharge for a function that is complex whatever it was. */
export function normComplexity(before: number | null, after: number | null): number {
  if (before === null || after === null) return 0;
  const growth = clamp01(Math.max(after - before, 0) / 10);
  return clamp01(growth + (after >= 15 ? 0.3 : 0));
}

export function normSize(size: number): number {
  return clamp01(size / 120);
}

export function normHazards(hazards: number): number {
  return clamp01(hazards / 3);
}

export interface ScoreInput {
  signals: FileSignals;
  features: HunkFeatures;
  kind: HunkKind;
  path: string;
  generated: { is: boolean; rule: string | null };
}

interface Contribution {
  signal: SignalName;
  weight: number;
  normalised: number;
  contribution: number;
  detail: string;
}

function plural(count: number, singular: string, pluralWord = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

export function contributionsOf(input: ScoreInput): Contribution[] {
  const { signals, features } = input;
  const raw: Array<[SignalName, number, string]> = [
    [
      'sensitivePath',
      signals.sensitivePath.match ? 1 : 0,
      signals.sensitivePath.rule === null
        ? 'no sensitive path match'
        : `matches ${signals.sensitivePath.rule}`,
    ],
    [
      'fanIn',
      normFanIn(signals.fanIn),
      signals.fanIn === null ? 'fan-in unknown' : plural(signals.fanIn, 'caller'),
    ],
    [
      'bugfixCommits',
      normBugfix(signals.bugfixCommits),
      signals.bugfixCommits === null
        ? 'fix history unknown'
        : `${plural(signals.bugfixCommits, 'fix commit')} in 90 days`,
    ],
    [
      'churnCommits90d',
      normChurn(signals.churnCommits90d),
      signals.churnCommits90d === null
        ? 'churn unknown'
        : `${plural(signals.churnCommits90d, 'commit')} in 90 days`,
    ],
    [
      'authorPriorCommits',
      normAuthorPrior(signals.authorPriorCommits),
      signals.authorPriorCommits === null
        ? 'author history unknown'
        : signals.authorPriorCommits === 0
          ? 'first change by this author'
          : `${plural(signals.authorPriorCommits, 'prior commit')} by this author`,
    ],
    [
      'complexity',
      normComplexity(signals.complexityBefore, signals.complexityAfter),
      signals.complexityBefore === null || signals.complexityAfter === null
        ? 'complexity unknown'
        : `complexity ${signals.complexityBefore} to ${signals.complexityAfter}`,
    ],
    [
      'hazards',
      normHazards(features.hazards),
      features.hazardNames.length === 0
        ? 'no hazardous calls'
        : `${plural(features.hazards, 'line')} using ${features.hazardNames.slice(0, 2).join(', ')}`,
    ],
    [
      'touchesErrorPath',
      features.touchesErrorPath ? 1 : 0,
      features.touchesErrorPath ? 'changes error handling' : 'no error handling changed',
    ],
    [
      'touchesPublicSurface',
      features.touchesPublicSurface ? 1 : 0,
      features.touchesPublicSurface ? 'changes exported surface' : 'nothing exported changed',
    ],
    ['size', normSize(features.size), `${plural(features.size, 'line')} changed`],
  ];

  return raw.map(([signal, normalised, detail]) => {
    const weight = WEIGHTS[signal];
    return { signal, weight, normalised, contribution: round2(weight * normalised), detail };
  });
}

/**
 * The score is the sum of the rounded contributions, so the three factors the
 * reviewer sees on hover add up to the number behind the heat.
 */
export function scoreOf(contributions: readonly Contribution[]): number {
  return round2(contributions.reduce((total, entry) => total + entry.contribution, 0));
}

export function levelOf(score: number): RiskLevel {
  if (score >= HIGH_THRESHOLD) return 'high';
  if (score >= MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

export function modeOf(level: RiskLevel): 'skim' | 'scrutinize' {
  return level === 'low' ? 'skim' : 'scrutinize';
}

const rank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

function raise(current: RiskLevel, to: RiskLevel): RiskLevel {
  return rank[to] > rank[current] ? to : current;
}

export interface FloorDecision {
  floor: RiskLevel;
  rule: string | null;
  detail: string | null;
}

/**
 * The two lowering rules run last and win: a hunk that only moves imports or
 * lives in a generated file is skimmable whatever the signals of its file say,
 * and the skim groups stage 1 builds depend on that.
 */
export function floorOf(score: number, input: ScoreInput): FloorDecision {
  const { features, kind, signals } = input;
  const testFile = signals.testFile;

  if (input.generated.is) {
    return {
      floor: 'low',
      rule: 'generated',
      detail: `generated file (${input.generated.rule ?? 'unknown rule'}), folded`,
    };
  }
  if (kind === 'import' || kind === 'whitespace-only' || kind === 'comment-only') {
    const what =
      kind === 'import' ? 'moves imports only' : kind === 'whitespace-only' ? 'whitespace only' : 'comments only';
    return { floor: 'low', rule: kind, detail: `${what}, score ignored` };
  }

  let floor = levelOf(score);
  let rule: string | null = null;
  let detail: string | null = null;
  const note = (nextRule: string, nextDetail: string, to: RiskLevel): void => {
    const raised = raise(floor, to);
    if (rank[raised] === rank[floor]) return;
    rule = nextRule;
    detail = nextDetail;
    floor = raised;
  };

  if (signals.sensitivePath.match && kind === 'code') {
    note('sensitivePath', `sensitive path ${signals.sensitivePath.rule ?? ''}, floored high`.trim(), 'high');
  }
  if (firstMatch(input.path, MIGRATION_PATHS) !== null && features.size > 0) {
    note('migration', 'migration file, any change is floored high', 'high');
  }
  if (features.deleteRatio > 0.7 && features.size >= 20 && !testFile) {
    note('deleteRatio', 'mostly deletion, floored medium', 'medium');
  }
  if (testFile && features.deleteRatio > 0.5) {
    note('testDeletes', 'deleted test lines, floored medium', 'medium');
  }
  if (features.hazards >= 2) {
    note('hazards', `${features.hazards} hazardous lines, floored medium`, 'medium');
  }

  return { floor, rule, detail };
}

export function riskOf(input: ScoreInput): Risk {
  const contributions = contributionsOf(input);
  const score = scoreOf(contributions);
  const decision = floorOf(score, input);

  const top = contributions
    .filter((entry) => entry.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution || b.weight - a.weight);

  const ruleFactor: RiskFactor[] =
    decision.rule === null || decision.detail === null
      ? []
      : [{ signal: 'floor', contribution: 0, detail: decision.detail }];

  const factors: RiskFactor[] = [
    ...ruleFactor,
    ...top.slice(0, 3 - ruleFactor.length).map((entry) => ({
      signal: entry.signal,
      contribution: entry.contribution,
      detail: entry.detail,
    })),
  ];

  return {
    floor: decision.floor,
    level: decision.floor,
    score,
    mode: modeOf(decision.floor),
    factors,
    reason: null,
    adjustedBy: null,
  };
}
