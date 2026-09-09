import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './exec.js';

export interface FanInRequest {
  /** Changed file path to the symbol names defined in it that a caller could name. */
  symbolsByFile: Map<string, string[]>;
  globs: string[];
}

export function countFromGrepOutput(
  output: string,
  symbolsByFile: ReadonlyMap<string, string[]>,
): Map<string, number> {
  const definers = new Map<string, string[]>();
  for (const [file, symbols] of symbolsByFile) {
    for (const symbol of symbols) {
      const list = definers.get(symbol);
      if (list) list.push(file);
      else definers.set(symbol, [file]);
    }
  }

  const counts = new Map<string, number>();
  for (const file of symbolsByFile.keys()) counts.set(file, 0);

  const words = new Map<string, RegExp>();
  for (const symbol of definers.keys()) {
    words.set(symbol, new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
  }

  for (const line of output.split('\n')) {
    if (line === '') continue;
    const firstColon = line.indexOf(':');
    if (firstColon < 0) continue;
    const path = line.slice(0, firstColon);
    const text = line.slice(firstColon + 1);
    for (const [symbol, owners] of definers) {
      if (!words.get(symbol)?.test(text)) continue;
      for (const owner of owners) {
        if (owner === path) continue;
        counts.set(owner, (counts.get(owner) ?? 0) + 1);
      }
    }
  }

  return counts;
}

/**
 * Stage 1 fan-in: one `git grep` for every changed symbol at once, then the
 * matches are attributed per symbol. Occurrences in the defining file do not
 * count. Matching by name over-counts, which raises risk, the safe direction.
 */
export function grepFanIn(worktree: string, request: FanInRequest): Map<string, number> {
  const symbols = [...new Set([...request.symbolsByFile.values()].flat())];
  if (symbols.length === 0 || request.globs.length === 0) return new Map();

  const dir = mkdtempSync(join(tmpdir(), 'review-cockpit-grep-'));
  const patternFile = join(dir, 'patterns.txt');
  try {
    writeFileSync(patternFile, `${symbols.join('\n')}\n`);
    const result = run('git', [
      '-c',
      'core.quotePath=false',
      '-C',
      worktree,
      'grep',
      '--no-color',
      '-w',
      '-F',
      '-f',
      patternFile,
      '--',
      ...request.globs,
    ]);
    if (result.code > 1) return new Map();
    return countFromGrepOutput(result.stdout, request.symbolsByFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const EXPORTED_DECLARATION =
  /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORTED_LIST = /^\s*export\s*\{([^}]*)\}/gm;

/** Names another module could import, which is what fan-in counts for TypeScript. */
export function exportedTsSymbols(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(EXPORTED_DECLARATION)) {
    if (match[1]) names.add(match[1]);
  }
  for (const match of source.matchAll(EXPORTED_LIST)) {
    for (const entry of (match[1] ?? '').split(',')) {
      const name = entry.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}
