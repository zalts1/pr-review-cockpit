import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configFile } from './paths.js';

export type JudgmentMode = 'session' | 'headless';

export const JUDGMENT_MODES: readonly JudgmentMode[] = ['session', 'headless'];

export interface UserConfig {
  workspaceRoots: string[];
  /** Who runs the judgment pass: the resident Claude session, or a `claude -p` the CLI spawns. */
  judgment: JudgmentMode;
}

export interface RepoOverrides {
  sensitivePaths: string[];
  generatedPatterns: string[];
  hazardPatterns: Record<string, string[]>;
}

export const noOverrides: RepoOverrides = {
  sensitivePaths: [],
  generatedPatterns: [],
  hazardPatterns: {},
};

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function readUserConfig(file = configFile()): UserConfig {
  const parsed = readJson(file);
  if (parsed === null || typeof parsed !== 'object') return { workspaceRoots: [], judgment: 'session' };
  const raw = parsed as { workspaceRoots?: unknown; judgment?: unknown };
  return {
    workspaceRoots: stringArray(raw.workspaceRoots),
    judgment: JUDGMENT_MODES.includes(raw.judgment as JudgmentMode)
      ? (raw.judgment as JudgmentMode)
      : 'session',
  };
}

/** `.review-cockpit.json` at the repository root. Overrides add to the built-in lists. */
export function readRepoOverrides(repoRoot: string): RepoOverrides {
  const parsed = readJson(join(repoRoot, '.review-cockpit.json'));
  if (parsed === null || typeof parsed !== 'object') return noOverrides;
  const raw = parsed as Record<string, unknown>;

  const hazardPatterns: Record<string, string[]> = {};
  const hazards = raw.hazardPatterns;
  if (hazards !== null && typeof hazards === 'object') {
    for (const [language, patterns] of Object.entries(hazards as Record<string, unknown>)) {
      hazardPatterns[language] = stringArray(patterns);
    }
  }

  return {
    sensitivePaths: stringArray(raw.sensitivePaths),
    generatedPatterns: stringArray(raw.generatedPatterns),
    hazardPatterns,
  };
}
