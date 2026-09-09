import type { DiffLine, HunkKind } from '@review-cockpit/schema';
import type { HazardLanguage } from './language.js';
import { ERROR_PATH_PATTERNS, HAZARDS } from './patterns.js';

export type LineRange = readonly [number, number];

export interface HunkFeatures {
  size: number;
  deleteRatio: number;
  hazards: number;
  hazardNames: string[];
  touchesErrorPath: boolean;
  touchesPublicSurface: boolean;
}

export interface KindInput {
  lines: readonly DiffLine[];
  header: string;
  symbols: readonly string[];
  language: HazardLanguage;
  testFile: boolean;
  headImportRanges: readonly LineRange[];
  baseImportRanges: readonly LineRange[];
}

export function changedLines(lines: readonly DiffLine[]): DiffLine[] {
  return lines.filter((line) => line.type !== 'context');
}

function withoutWhitespace(text: string): string {
  return text.replace(/\s+/g, '');
}

export function isWhitespaceOnly(lines: readonly DiffLine[]): boolean {
  const changed = changedLines(lines);
  if (changed.length === 0) return false;
  const adds = changed
    .filter((l) => l.type === 'add')
    .map((l) => withoutWhitespace(l.text))
    .filter((t) => t.length > 0)
    .sort();
  const dels = changed
    .filter((l) => l.type === 'del')
    .map((l) => withoutWhitespace(l.text))
    .filter((t) => t.length > 0)
    .sort();
  return adds.length === dels.length && adds.every((text, i) => text === dels[i]);
}

function isCommentLine(text: string, language: HazardLanguage): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return true;
  if (language === null) return trimmed.startsWith('#');
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('*/')
  );
}

export function isCommentOnly(lines: readonly DiffLine[], language: HazardLanguage): boolean {
  const changed = changedLines(lines);
  if (changed.length === 0) return false;
  return changed.every((line) => isCommentLine(line.text, language));
}

function inRanges(line: number, ranges: readonly LineRange[]): boolean {
  return ranges.some(([start, end]) => line >= start && line <= end);
}

export function isImportOnly(input: KindInput): boolean {
  const changed = changedLines(input.lines);
  if (changed.length === 0) return false;
  return changed.every((line) =>
    line.type === 'add'
      ? line.newNo !== null && inRanges(line.newNo, input.headImportRanges)
      : line.oldNo !== null && inRanges(line.oldNo, input.baseImportRanges),
  );
}

/**
 * Trivial kinds are decided before `test`, so an import shuffle inside a test
 * file is floored low rather than measured as a test change.
 */
export function classifyKind(input: KindInput): HunkKind {
  if (isWhitespaceOnly(input.lines)) return 'whitespace-only';
  if (isCommentOnly(input.lines, input.language)) return 'comment-only';
  if (isImportOnly(input)) return 'import';
  if (input.testFile) return 'test';
  return 'code';
}

/**
 * Import statements on the head and base side, as 1-based inclusive line
 * ranges. A regex scan rather than a parse: the base side of a diff is only
 * available as text, and a broken head file must not lose its import ranges.
 */
export function importRanges(source: string, language: HazardLanguage): LineRange[] {
  const lines = source.split('\n');
  const ranges: LineRange[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();

    if (language === 'go') {
      if (/^import\s*\($/.test(line)) {
        const start = i + 1;
        while (i < lines.length && !/^\)/.test((lines[i] ?? '').trim())) i += 1;
        ranges.push([start, i + 1]);
        continue;
      }
      if (/^import\s+/.test(line)) ranges.push([i + 1, i + 1]);
      continue;
    }

    if (language === 'ts') {
      const isImport = /^import\b/.test(line);
      const isReexport = /^export\s+(\*|\{)/.test(line) && !/^export\s*\{[^}]*\}\s*;?$/.test(line);
      if (!isImport && !isReexport) continue;
      const start = i + 1;
      while (i < lines.length && !/['"][^'"]*['"]\s*;?\s*$/.test((lines[i] ?? '').trim())) {
        if ((lines[i] ?? '').trim() === '') break;
        i += 1;
      }
      ranges.push([start, Math.min(i, lines.length - 1) + 1]);
    }
  }

  return ranges;
}

export function hazardPatternsFor(
  language: HazardLanguage,
  overrides: Record<string, string[]> = {},
): string[] {
  if (language === null) return [];
  return [...(HAZARDS[language] ?? []), ...(overrides[language] ?? [])];
}

function isExportedGoSymbol(symbol: string): boolean {
  const name = symbol.split('.').pop() ?? symbol;
  return /^[A-Z]/.test(name);
}

/**
 * A test function is capitalised by convention and called by the test runner
 * alone, so an exported name in a test file says nothing about blast radius.
 */
export function touchesPublicSurface(input: KindInput): boolean {
  if (input.testFile) return false;
  const texts = [...changedLines(input.lines).map((l) => l.text), input.header];

  if (input.language === 'go') {
    if (input.symbols.some(isExportedGoSymbol)) return true;
    return texts.some((text) => /\btype\s+\w+\s+(struct|interface)\b/.test(text));
  }

  if (input.language === 'ts') {
    return texts.some((text) => /^\s*export\b/.test(text) || /^\s*(interface|type)\s+\w+/.test(text));
  }

  return false;
}

export function hunkFeatures(
  input: KindInput,
  hazardOverrides: Record<string, string[]> = {},
): HunkFeatures {
  const changed = changedLines(input.lines);
  const adds = changed.filter((l) => l.type === 'add').length;
  const dels = changed.filter((l) => l.type === 'del').length;
  const size = adds + dels;

  const patterns = hazardPatternsFor(input.language, hazardOverrides);
  const hazardNames = new Set<string>();
  let hazards = 0;
  for (const line of changed) {
    const hit = patterns.filter((pattern) => line.text.includes(pattern));
    if (hit.length === 0) continue;
    hazards += 1;
    for (const pattern of hit) hazardNames.add(pattern.trim());
  }

  return {
    size,
    deleteRatio: size === 0 ? 0 : dels / size,
    hazards,
    hazardNames: [...hazardNames],
    touchesErrorPath: changed.some((line) =>
      ERROR_PATH_PATTERNS.some((pattern) => line.text.includes(pattern)),
    ),
    touchesPublicSurface: touchesPublicSurface(input),
  };
}
