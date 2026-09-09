import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { Graph, GraphEdge, GraphNode, ReviewFile } from '@review-cockpit/schema';
import { readWorktreeFile } from './content.js';
import { run } from './exec.js';
import { generatedRule } from './generated.js';
import type { GoImport } from './go.js';
import { parseGo } from './go.js';

export interface IndexedFunction {
  name: string;
  bare: string;
  receiverType: string | null;
  exported: boolean;
  startLine: number;
  endLine: number;
  calls: Array<{ name: string; receiver: string | null }>;
  localTypes: Record<string, string>;
}

export interface IndexEntry {
  blob: string;
  packageName: string;
  imports: GoImport[];
  functions: IndexedFunction[];
}

export interface RepoIndex {
  version: number;
  modulePath: string;
  entries: Record<string, IndexEntry>;
}

export const INDEX_VERSION = 1;

const INDEX_KEEP = 3;

export interface TreeFile {
  path: string;
  blob: string;
}

export function isSkipped(path: string): boolean {
  const segments = path.split('/');
  if (segments.includes('vendor') || segments.includes('testdata') || segments.includes('.claude')) {
    return true;
  }
  return generatedRule(path, []) !== null;
}

export function listGoFiles(worktree: string, sha: string): TreeFile[] {
  const result = run('git', [
    '-c',
    'core.quotePath=false',
    '-C',
    worktree,
    'ls-tree',
    '-r',
    sha,
    '--format=%(objectname)%x09%(path)',
  ]);
  if (result.code !== 0) return [];

  const files: TreeFile[] = [];
  for (const line of result.stdout.split('\n')) {
    const [blob, path] = line.split('\t');
    if (!blob || !path || !path.endsWith('.go')) continue;
    if (isSkipped(path)) continue;
    files.push({ path, blob });
  }
  return files;
}

export function modulePathOf(worktree: string, sha: string): string {
  const result = run('git', ['-C', worktree, 'show', `${sha}:go.mod`]);
  if (result.code !== 0) return '';
  const match = /^module\s+(\S+)/m.exec(result.stdout);
  return match?.[1] ?? '';
}

function indexFileFor(indexDirectory: string, sha: string): string {
  return join(indexDirectory, `${sha}.json`);
}

function newestIndexFiles(indexDirectory: string): string[] {
  try {
    return readdirSync(indexDirectory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(indexDirectory, name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  } catch {
    return [];
  }
}

export function loadIndex(indexDirectory: string, sha: string): RepoIndex | null {
  const exact = indexFileFor(indexDirectory, sha);
  const candidates = existsSync(exact) ? [exact] : newestIndexFiles(indexDirectory);
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as RepoIndex;
      if (parsed.version === INDEX_VERSION) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

export function saveIndex(indexDirectory: string, sha: string, index: RepoIndex): void {
  mkdirSync(indexDirectory, { recursive: true });
  const file = indexFileFor(indexDirectory, sha);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(index));
  renameSync(temp, file);

  for (const stale of newestIndexFiles(indexDirectory).slice(INDEX_KEEP)) {
    rmSync(stale, { force: true });
  }
}

export interface IndexBuild {
  index: RepoIndex;
  parsed: number;
  reused: number;
}

/**
 * Entries are keyed by path and blob sha, so a file whose content is unchanged
 * between two commits of the repository is parsed once and reused after that.
 */
export async function buildIndex(
  worktree: string,
  sha: string,
  files: readonly TreeFile[],
  cached: RepoIndex | null,
): Promise<IndexBuild> {
  const entries: Record<string, IndexEntry> = {};
  let parsed = 0;
  let reused = 0;

  for (const file of files) {
    const previous = cached?.entries[file.path];
    if (previous && previous.blob === file.blob) {
      entries[file.path] = previous;
      reused += 1;
      continue;
    }

    const source = readWorktreeFile(worktree, file.path);
    if (source === null) continue;
    if (generatedRule(file.path, source.split('\n', 5)) !== null) continue;

    const go = await parseGo(source);
    entries[file.path] = {
      blob: file.blob,
      packageName: go.packageName,
      imports: go.imports,
      functions: go.functions.map((fn) => ({
        name: fn.name,
        bare: fn.bare,
        receiverType: fn.receiverType,
        exported: fn.exported,
        startLine: fn.startLine,
        endLine: fn.endLine,
        calls: fn.calls.map((call) => ({ name: call.name, receiver: call.receiver })),
        localTypes: fn.localTypes,
      })),
    };
    parsed += 1;
  }

  return {
    index: { version: INDEX_VERSION, modulePath: modulePathOf(worktree, sha), entries },
    parsed,
    reused,
  };
}

export interface GoSymbol {
  id: string;
  path: string;
  directory: string;
  fn: IndexedFunction;
}

export interface SymbolTable {
  symbols: GoSymbol[];
  byId: Map<string, GoSymbol>;
  packageFunctions: Map<string, GoSymbol[]>;
  methodsByType: Map<string, GoSymbol[]>;
  byBareName: Map<string, GoSymbol[]>;
  directoryOfImport: Map<string, string>;
  importsByPath: Map<string, GoImport[]>;
}

/** How many same-named candidates a call may have before it is left unresolved. */
export const NAME_ONLY_LIMIT = 3;

function directoryOf(path: string): string {
  const directory = dirname(path);
  return directory === '.' ? '' : directory;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function symbolTable(index: RepoIndex): SymbolTable {
  const table: SymbolTable = {
    symbols: [],
    byId: new Map(),
    packageFunctions: new Map(),
    methodsByType: new Map(),
    byBareName: new Map(),
    directoryOfImport: new Map(),
    importsByPath: new Map(),
  };

  for (const [path, entry] of Object.entries(index.entries)) {
    const directory = directoryOf(path);
    table.importsByPath.set(path, entry.imports);
    const importPath =
      index.modulePath === ''
        ? directory
        : directory === ''
          ? index.modulePath
          : `${index.modulePath}/${directory}`;
    table.directoryOfImport.set(importPath, directory);

    for (const fn of entry.functions) {
      const symbol: GoSymbol = { id: `${directory}|${fn.name}`, path, directory, fn };
      if (table.byId.has(symbol.id)) continue;
      table.symbols.push(symbol);
      table.byId.set(symbol.id, symbol);
      if (fn.receiverType === null) push(table.packageFunctions, `${directory}|${fn.bare}`, symbol);
      else push(table.methodsByType, `${directory}|${fn.receiverType}.${fn.bare}`, symbol);
      push(table.byBareName, fn.bare, symbol);
    }
  }

  return table;
}

function byName(table: SymbolTable, name: string): GoSymbol[] {
  const candidates = table.byBareName.get(name) ?? [];
  return candidates.length > 0 && candidates.length <= NAME_ONLY_LIMIT ? candidates : [];
}

function directoryOfAlias(table: SymbolTable, path: string, alias: string): string | null {
  for (const entry of table.importsByPath.get(path) ?? []) {
    if (entry.alias !== alias) continue;
    return table.directoryOfImport.get(entry.path) ?? null;
  }
  return null;
}

/**
 * Resolution order: a bare call inside its own package, a receiver whose type
 * is known, then one hop out through the file's imports, then the name alone.
 * A name with more candidates than the limit is dropped rather than drawn as a
 * fan of wrong edges.
 */
export function resolveCall(
  table: SymbolTable,
  from: GoSymbol,
  call: { name: string; receiver: string | null },
): GoSymbol[] {
  if (call.receiver === null) {
    const local = table.packageFunctions.get(`${from.directory}|${call.name}`);
    if (local && local.length > 0) return local.slice(0, 1);
    return byName(table, call.name);
  }

  const receiverType = from.fn.localTypes[call.receiver];
  if (receiverType !== undefined) {
    const dot = receiverType.indexOf('.');
    const packageAlias = dot < 0 ? null : receiverType.slice(0, dot);
    const typeName = dot < 0 ? receiverType : receiverType.slice(dot + 1);
    const directory =
      packageAlias === null ? from.directory : directoryOfAlias(table, from.path, packageAlias);
    if (directory !== null) {
      const method = table.methodsByType.get(`${directory}|${typeName}.${call.name}`);
      if (method && method.length > 0) return method.slice(0, 1);
    }
  }

  const imported = directoryOfAlias(table, from.path, call.receiver);
  if (imported !== null) {
    const exported = table.packageFunctions.get(`${imported}|${call.name}`);
    if (exported && exported.length > 0) return exported.slice(0, 1);
  }

  return byName(table, call.name);
}

export interface CallEdges {
  callers: Map<string, Set<string>>;
  callees: Map<string, Set<string>>;
}

export function callEdges(table: SymbolTable): CallEdges {
  const callers = new Map<string, Set<string>>();
  const callees = new Map<string, Set<string>>();

  for (const symbol of table.symbols) {
    for (const call of symbol.fn.calls) {
      for (const target of resolveCall(table, symbol, call)) {
        if (target.id === symbol.id) continue;
        const into = callers.get(target.id) ?? new Set<string>();
        into.add(symbol.id);
        callers.set(target.id, into);
        const out = callees.get(symbol.id) ?? new Set<string>();
        out.add(target.id);
        callees.set(symbol.id, out);
      }
    }
  }

  return { callers, callees };
}

export interface GraphOptions {
  worktree: string;
  headSha: string;
  files: readonly ReviewFile[];
  indexDirectory: string;
  neighbourCap?: number;
  onProgress?: (message: string) => void;
}

export interface FanCounts {
  fanIn: number;
  fanOut: number;
}

export interface GraphResult {
  graph: Graph;
  fanByFile: Map<string, FanCounts>;
  stats: { goFiles: number; parsed: number; reused: number; symbols: number; ms: number };
}

/**
 * Neighbours emitted per changed package. A hot method can have 150 callers,
 * and past this many nodes the level 2 view is unreadable, so the rest are
 * counted on the package node instead of drawn.
 */
export const NEIGHBOUR_CAP = 40;

function hunkRangeOf(hunk: { newStart: number; newLines: number }): [number, number] {
  const start = Math.max(hunk.newStart, 1);
  return [start, Math.max(start + Math.max(hunk.newLines, 1) - 1, 1)];
}

export async function buildGoGraph(options: GraphOptions): Promise<GraphResult> {
  const started = Date.now();
  const cap = options.neighbourCap ?? NEIGHBOUR_CAP;

  const tree = listGoFiles(options.worktree, options.headSha);
  const cached = loadIndex(options.indexDirectory, options.headSha);
  const build = await buildIndex(options.worktree, options.headSha, tree, cached);
  saveIndex(options.indexDirectory, options.headSha, build.index);
  options.onProgress?.(`index: ${build.parsed} files parsed, ${build.reused} reused of ${tree.length}`);

  const table = symbolTable(build.index);
  const { callers, callees } = callEdges(table);

  const changedGoFiles = options.files.filter(
    (file) =>
      file.language === 'go' && !file.binary && file.generated.rule === null && !isSkipped(file.path),
  );
  const symbolsOfFile = new Map<string, GoSymbol[]>();
  for (const symbol of table.symbols) push(symbolsOfFile, symbol.path, symbol);

  const hunksOfSymbol = new Map<string, string[]>();
  const changedIds = new Set<string>();
  const pathOfSymbol = new Map<string, string>();

  for (const file of changedGoFiles) {
    for (const symbol of symbolsOfFile.get(file.path) ?? []) {
      const hunkIds = file.hunks
        .filter((hunk) => {
          const [start, end] = hunkRangeOf(hunk);
          return symbol.fn.startLine <= end && symbol.fn.endLine >= start;
        })
        .map((hunk) => hunk.id);
      if (hunkIds.length === 0) continue;
      hunksOfSymbol.set(symbol.id, hunkIds);
      changedIds.add(symbol.id);
      pathOfSymbol.set(symbol.id, file.path);
    }
  }

  const fanByFile = new Map<string, FanCounts>();
  for (const file of changedGoFiles) {
    const own = new Set([...changedIds].filter((id) => pathOfSymbol.get(id) === file.path));
    const callerSet = new Set<string>();
    const calleeSet = new Set<string>();
    for (const id of own) {
      for (const caller of callers.get(id) ?? []) if (!own.has(caller)) callerSet.add(caller);
      for (const callee of callees.get(id) ?? []) if (!own.has(callee)) calleeSet.add(callee);
    }
    fanByFile.set(file.path, { fanIn: callerSet.size, fanOut: calleeSet.size });
  }

  const changedByPackage = new Map<string, string[]>();
  for (const id of changedIds) {
    const path = pathOfSymbol.get(id);
    if (path === undefined) continue;
    push(changedByPackage, directoryOf(path), id);
  }

  const fanInOf = (id: string): number => callers.get(id)?.size ?? 0;

  // Callers first, then callees, each by fan-in: the nodes a reviewer asks
  // about first are the ones that call into the change.
  const rankNeighbours = (ids: readonly string[]): string[] => {
    const asCaller = new Set<string>();
    const asCallee = new Set<string>();
    for (const id of ids) {
      for (const caller of callers.get(id) ?? []) if (!changedIds.has(caller)) asCaller.add(caller);
      for (const callee of callees.get(id) ?? []) {
        if (!changedIds.has(callee) && !asCaller.has(callee)) asCallee.add(callee);
      }
    }
    const order = (id: string, caller: boolean): [number, number, string] => [
      caller ? 0 : 1,
      -fanInOf(id),
      id,
    ];
    return [
      ...[...asCaller].map((id) => order(id, true)),
      ...[...asCallee].map((id) => order(id, false)),
    ]
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]))
      .map(([, , id]) => id);
  };

  const packages = [...changedByPackage.keys()].sort((a, b) => a.localeCompare(b));
  const rankedByPackage = new Map<string, string[]>();
  const keptNeighbours = new Set<string>();
  for (const directory of packages) {
    const ranked = rankNeighbours(changedByPackage.get(directory) ?? []);
    rankedByPackage.set(directory, ranked);
    for (const id of ranked.slice(0, cap)) keptNeighbours.add(id);
  }

  // A neighbour past one package's cap is only folded away if no other package
  // kept it, so "and N more" never counts a node that is on the screen.
  const foldedByPackage = new Map<string, number>();
  for (const [directory, ranked] of rankedByPackage) {
    foldedByPackage.set(
      directory,
      ranked.slice(cap).filter((id) => !keptNeighbours.has(id)).length,
    );
  }

  const nodes: GraphNode[] = [];
  const nodeIdOfSymbol = new Map<string, string>();
  const changedFunctionsByPackage = new Map<string, number>();

  const addFunction = (symbol: GoSymbol, changed: boolean): void => {
    const id = `n${nodes.length + 1}`;
    nodeIdOfSymbol.set(symbol.id, id);
    nodes.push({
      id,
      kind: 'function',
      label: symbol.fn.name,
      file: symbol.path,
      changed,
      hunkIds: changed ? (hunksOfSymbol.get(symbol.id) ?? []) : [],
    });
    if (changed) {
      const directory = directoryOf(symbol.path);
      changedFunctionsByPackage.set(directory, (changedFunctionsByPackage.get(directory) ?? 0) + 1);
    }
  };

  const byPathAndLine = (a: GoSymbol, b: GoSymbol): number =>
    a.path.localeCompare(b.path) || a.fn.startLine - b.fn.startLine;
  const symbolsOf = (ids: Iterable<string>): GoSymbol[] =>
    [...ids]
      .map((id) => table.byId.get(id))
      .filter((symbol): symbol is GoSymbol => symbol !== undefined)
      .sort(byPathAndLine);

  for (const symbol of symbolsOf(changedIds)) addFunction(symbol, true);
  for (const symbol of symbolsOf(keptNeighbours)) addFunction(symbol, false);

  const packageHunks = new Map<string, string[]>();
  for (const file of changedGoFiles) {
    const directory = directoryOf(file.path);
    packageHunks.set(directory, [
      ...(packageHunks.get(directory) ?? []),
      ...file.hunks.map((hunk) => hunk.id),
    ]);
  }

  for (const file of changedGoFiles) {
    const covered = [...changedIds].some((id) => pathOfSymbol.get(id) === file.path);
    if (covered || file.hunks.length === 0) continue;
    nodes.push({
      id: `n${nodes.length + 1}`,
      kind: 'file',
      label: file.path,
      file: file.path,
      changed: true,
      hunkIds: file.hunks.map((hunk) => hunk.id),
    });
  }

  const directories = new Set<string>([...packageHunks.keys(), ...changedByPackage.keys()]);
  for (const node of nodes) {
    if (node.file !== null) directories.add(directoryOf(node.file));
  }
  for (const directory of [...directories].sort((a, b) => a.localeCompare(b))) {
    const hunkIds = packageHunks.get(directory) ?? [];
    nodes.push({
      id: `n${nodes.length + 1}`,
      kind: 'package',
      label: directory === '' ? '(repository root)' : directory,
      file: null,
      changed: hunkIds.length > 0,
      hunkIds,
      count: {
        changedFunctions: changedFunctionsByPackage.get(directory) ?? 0,
        foldedNeighbours: foldedByPackage.get(directory) ?? 0,
      },
    });
  }

  const truncated = [...foldedByPackage.values()].some((folded) => folded > 0);

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const [target, sources] of callers) {
    const to = nodeIdOfSymbol.get(target);
    if (to === undefined) continue;
    for (const source of sources) {
      const from = nodeIdOfSymbol.get(source);
      if (from === undefined) continue;
      const key = `${from} ${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from, to, kind: 'calls' });
    }
  }

  return {
    graph: { nodes, edges, truncated },
    fanByFile,
    stats: {
      goFiles: tree.length,
      parsed: build.parsed,
      reused: build.reused,
      symbols: table.symbols.length,
      ms: Date.now() - started,
    },
  };
}
