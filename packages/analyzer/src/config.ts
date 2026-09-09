import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configFile } from './paths.js';

export interface UserConfig {
  workspaceRoots: string[];
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
  if (parsed === null || typeof parsed !== 'object') return { workspaceRoots: [] };
  return { workspaceRoots: stringArray((parsed as { workspaceRoots?: unknown }).workspaceRoots) };
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
