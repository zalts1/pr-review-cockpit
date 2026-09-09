import { firstMatch } from './glob.js';
import { GENERATED_PATHS } from './patterns.js';

export interface GeneratedDetection {
  is: boolean;
  rule: string | null;
}

export const HEADER_RULE = 'header: Code generated ... DO NOT EDIT';

const HEADER_LINES = 5;

export function generatedRule(
  path: string,
  firstLines: readonly string[],
  extraPatterns: readonly string[] = [],
): string | null {
  const byPath = firstMatch(path, [...extraPatterns, ...GENERATED_PATHS]);
  if (byPath !== null) return byPath;

  const header = firstLines.slice(0, HEADER_LINES).join('\n');
  if (header.includes('Code generated') && header.includes('DO NOT EDIT')) return HEADER_RULE;
  return null;
}

/** `fold` false keeps the rule visible while leaving the file unfolded and unfloored. */
export function detectGenerated(
  path: string,
  firstLines: readonly string[],
  extraPatterns: readonly string[] = [],
  fold = true,
): GeneratedDetection {
  const rule = generatedRule(path, firstLines, extraPatterns);
  if (rule === null) return { is: false, rule: null };
  return { is: fold, rule };
}
