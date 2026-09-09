import { run } from './exec.js';

export interface FanInRequest {
  /** Each changed file to the names defined in it that a caller elsewhere could write. */
  symbolsByFile: Map<string, string[]>;
  globs: string[];
}

/** git grep -w matched whole words, so the same tokenisation attributes them. */
const NON_WORD = /[^A-Za-z0-9_$]+/;

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

  for (const line of output.split('\n')) {
    if (line === '') continue;
    const firstColon = line.indexOf(':');
    if (firstColon < 0) continue;
    const path = line.slice(0, firstColon);
    const seen = new Set<string>();
    for (const token of line.slice(firstColon + 1).split(NON_WORD)) {
      if (token === '' || seen.has(token)) continue;
      seen.add(token);
      for (const owner of definers.get(token) ?? []) {
        if (owner === path) continue;
        counts.set(owner, (counts.get(owner) ?? 0) + 1);
      }
    }
  }

  return counts;
}

/**
 * One alternation rather than one pattern per symbol: git grep scans the tree
 * once per pattern with -F, which on a large repository costs ten times as much
 * as a single regular expression that matches all of them.
 */
const SYMBOLS_PER_GREP = 400;

function alternationOf(symbols: readonly string[]): string {
  return `(${symbols.map((symbol) => symbol.replace(/[^A-Za-z0-9_]/g, '\\$&')).join('|')})`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Stage 1 fan-in: one `git grep` over the changed symbols, then the matches are
 * attributed per symbol. Occurrences in the defining file do not count. Matching
 * by name over-counts, which raises risk, the safe direction.
 */
export function grepFanIn(worktree: string, request: FanInRequest): Map<string, number> {
  const symbols = [...new Set([...request.symbolsByFile.values()].flat())].filter(
    (symbol) => symbol.length > 0,
  );
  if (symbols.length === 0 || request.globs.length === 0) return new Map();

  let output = '';
  for (const batch of chunk(symbols, SYMBOLS_PER_GREP)) {
    const result = run('git', [
      '-c',
      'core.quotePath=false',
      '-C',
      worktree,
      'grep',
      '--no-color',
      '-w',
      '-E',
      '-e',
      alternationOf(batch),
      '--',
      ...request.globs,
    ]);
    if (result.code > 1) return new Map();
    output += result.stdout;
  }

  return countFromGrepOutput(output, request.symbolsByFile);
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
