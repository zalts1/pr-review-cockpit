import type { Language } from '@review-cockpit/schema';
import { firstMatch } from './glob.js';
import { TEST_PATHS } from './patterns.js';

const byExtension: Record<string, Language> = {
  go: 'go',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  proto: 'proto',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  md: 'markdown',
};

export function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

export function languageOf(path: string): Language {
  return byExtension[extensionOf(path)] ?? 'other';
}

/**
 * Which hazard and comment rules apply. Plain JavaScript shares the TypeScript
 * hazards but is not TypeScript, so `language` in the document still says other.
 */
export type HazardLanguage = 'go' | 'ts' | null;

export function hazardLanguageOf(path: string): HazardLanguage {
  const extension = extensionOf(path);
  if (extension === 'go') return 'go';
  if (['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'].includes(extension)) return 'ts';
  return null;
}

export function isTestPath(path: string): boolean {
  return firstMatch(path, TEST_PATHS) !== null;
}
