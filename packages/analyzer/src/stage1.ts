import type {
  CheckoutInfo,
  FileSignals,
  Hunk,
  Language,
  PrInfo,
  ReviewDocument,
  ReviewFile,
} from '@review-cockpit/schema';
import { readRepoOverrides } from './config.js';
import { firstLines, readWorktreeFile, showFile } from './content.js';
import { buildDocument, nowIso, status } from './document.js';
import type { ParsedFile } from './diff.js';
import { parseDiff } from './diff.js';
import { git, gitOk } from './exec.js';
import type { HunkFeatures, LineRange } from './features.js';
import { classifyKind, hunkFeatures, importRanges } from './features.js';
import { exportedTsSymbols, grepFanIn } from './fanin.js';
import { detectGenerated } from './generated.js';
import { firstMatch } from './glob.js';
import type { GoFile, GoFunction } from './go.js';
import { functionsOverlapping, parseGo } from './go.js';
import { stage1Groups } from './groups.js';
import type { FileHistory } from './gitsignals.js';
import { gitSignals } from './gitsignals.js';
import type { HazardLanguage } from './language.js';
import { hazardLanguageOf, isTestPath, languageOf } from './language.js';
import { SENSITIVE_PATHS } from './patterns.js';
import { riskOf } from './score.js';

export interface Stage1Options {
  pr: PrInfo;
  checkout: CheckoutInfo;
  authorEmails: readonly string[];
  foldGenerated?: boolean;
  now?: Date;
  onProgress?: (message: string) => void;
}

export interface Stage1Result {
  document: ReviewDocument;
  /** The merge base the diff and the history pass were taken against. */
  diffBase: string;
  goFilesByPath: Map<string, GoFile>;
  /** Per hunk, so stage 3 can rescore without reparsing the diff. */
  featuresByHunk: Map<string, HunkFeatures>;
}

function step<T>(label: string, onProgress: ((message: string) => void) | undefined, work: () => T): T {
  const started = Date.now();
  const value = work();
  onProgress?.(`${label} (${Date.now() - started} ms)`);
  return value;
}

async function stepAsync<T>(
  label: string,
  onProgress: ((message: string) => void) | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const value = await work();
  onProgress?.(`${label} (${Date.now() - started} ms)`);
  return value;
}

export function mergeBase(worktree: string, baseSha: string, headSha: string): string {
  const result = git(worktree, ['merge-base', baseSha, headSha]);
  return result.code === 0 ? result.stdout.trim() : baseSha;
}

function hunkRanges(file: ParsedFile, side: 'new' | 'old'): LineRange[] {
  return file.hunks.map((hunk) => {
    const start = side === 'new' ? hunk.newStart : hunk.oldStart;
    const lines = side === 'new' ? hunk.newLines : hunk.oldLines;
    return [Math.max(start, 1), Math.max(start + Math.max(lines, 1) - 1, 1)] as LineRange;
  });
}

interface FileStructure {
  headSource: string | null;
  head: GoFile | null;
  base: GoFile | null;
  headImports: LineRange[];
  baseImports: LineRange[];
  changedFunctions: GoFunction[];
  complexityBefore: number | null;
  complexityAfter: number | null;
  fanInSymbols: string[];
}

function emptyStructure(): FileStructure {
  return {
    headSource: null,
    head: null,
    base: null,
    headImports: [],
    baseImports: [],
    changedFunctions: [],
    complexityBefore: null,
    complexityAfter: null,
    fanInSymbols: [],
  };
}

function sumComplexity(functions: readonly GoFunction[]): number {
  return functions.reduce((total, fn) => total + fn.complexity, 0);
}

async function structureOf(
  file: ParsedFile,
  language: Language,
  hazardLanguage: HazardLanguage,
  headSource: string | null,
  baseSource: string | null,
): Promise<FileStructure> {
  const structure = emptyStructure();
  structure.headSource = headSource;

  if (hazardLanguage !== null) {
    structure.headImports = headSource === null ? [] : importRanges(headSource, hazardLanguage);
    structure.baseImports = baseSource === null ? [] : importRanges(baseSource, hazardLanguage);
  }

  if (language === 'go') {
    structure.head = headSource === null ? null : await parseGo(headSource);
    structure.base = baseSource === null ? null : await parseGo(baseSource);

    if (file.status === 'deleted') {
      const changed = functionsOverlapping(structure.base?.functions ?? [], hunkRanges(file, 'old'));
      structure.complexityBefore = sumComplexity(changed);
      structure.complexityAfter = 0;
      structure.fanInSymbols = changed.map((fn) => fn.bare);
      return structure;
    }

    const changed = functionsOverlapping(structure.head?.functions ?? [], hunkRanges(file, 'new'));
    structure.changedFunctions = changed;
    structure.complexityAfter = structure.head === null ? null : sumComplexity(changed);
    const names = new Set(changed.map((fn) => fn.name));
    structure.complexityBefore =
      structure.base === null
        ? structure.head === null
          ? null
          : 0
        : sumComplexity(structure.base.functions.filter((fn) => names.has(fn.name)));
    structure.fanInSymbols = changed.map((fn) => fn.bare);
    return structure;
  }

  if ((language === 'typescript' || language === 'tsx') && headSource !== null) {
    structure.fanInSymbols = exportedTsSymbols(headSource);
  }

  return structure;
}

const GO_GLOBS = ['*.go'];
const TS_GLOBS = ['*.ts', '*.tsx'];

export async function analyzeStage1(options: Stage1Options): Promise<Stage1Result> {
  const { pr, checkout } = options;
  const worktree = checkout.path;
  const onProgress = options.onProgress;
  const generatedAt = nowIso(options.now ?? new Date());
  const overrides = readRepoOverrides(worktree);

  const diffBase = step('merge base', onProgress, () => mergeBase(worktree, pr.base.sha, pr.head.sha));

  const parsed = step('diff parsed', onProgress, () => {
    const raw = gitOk(worktree, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '-U3',
      '-M',
      `${pr.base.sha}...${pr.head.sha}`,
    ]);
    return parseDiff(raw);
  });

  const interestingPaths = new Set<string>();
  for (const file of parsed) {
    interestingPaths.add(file.path);
    if (file.previousPath !== null) interestingPaths.add(file.previousPath);
  }

  const history = step(
    `git history for ${interestingPaths.size} paths`,
    onProgress,
    () =>
      gitSignals({
        repo: worktree,
        baseSha: diffBase,
        paths: interestingPaths,
        authorEmails: new Set(options.authorEmails),
        ...(options.now ? { now: Math.floor(options.now.getTime() / 1000) } : {}),
      }),
  );
  const historyAvailable = history.size > 0;

  const structures = new Map<string, FileStructure>();
  const goFilesByPath = new Map<string, GoFile>();
  const featuresByHunk = new Map<string, HunkFeatures>();
  const files: ReviewFile[] = [];

  await stepAsync('structure parsed', onProgress, async () => {
    for (const [index, file] of parsed.entries()) {
      const id = `f${index + 1}`;
      const language = languageOf(file.path);
      const hazardLanguage = hazardLanguageOf(file.path);
      const headSource = file.status === 'deleted' || file.binary ? null : readWorktreeFile(worktree, file.path);
      const basePath = file.previousPath ?? file.path;
      const baseSource =
        file.status === 'added' || file.binary ? null : showFile(worktree, diffBase, basePath);

      const structure = await structureOf(file, language, hazardLanguage, headSource, baseSource);
      structures.set(id, structure);
      if (structure.head) goFilesByPath.set(file.path, structure.head);
    }
  });

  const goSymbols = new Map<string, string[]>();
  const tsSymbols = new Map<string, string[]>();
  for (const [index, file] of parsed.entries()) {
    const structure = structures.get(`f${index + 1}`);
    if (!structure || structure.fanInSymbols.length === 0) continue;
    const language = languageOf(file.path);
    if (language === 'go') goSymbols.set(file.path, structure.fanInSymbols);
    else if (language === 'typescript' || language === 'tsx') tsSymbols.set(file.path, structure.fanInSymbols);
  }

  const fanIn = step(
    `fan-in over ${goSymbols.size + tsSymbols.size} files`,
    onProgress,
    () =>
      new Map([
        ...grepFanIn(worktree, { symbolsByFile: goSymbols, globs: GO_GLOBS }),
        ...grepFanIn(worktree, { symbolsByFile: tsSymbols, globs: TS_GLOBS }),
      ]),
  );

  for (const [index, file] of parsed.entries()) {
    const id = `f${index + 1}`;
    const structure = structures.get(id) ?? emptyStructure();
    const language = languageOf(file.path);
    const hazardLanguage = hazardLanguageOf(file.path);
    const testFile = isTestPath(file.path);

    const generated = detectGenerated(
      file.path,
      firstLines(structure.headSource, 5),
      overrides.generatedPatterns,
      options.foldGenerated ?? true,
    );

    const sensitiveRule = firstMatch(file.path, [...overrides.sensitivePaths, ...SENSITIVE_PATHS]);
    const fileHistory: FileHistory | undefined = historyAvailable
      ? sumHistory(history, file.path, file.previousPath)
      : undefined;

    const signals: FileSignals = {
      churnCommits90d: fileHistory?.churnCommits90d ?? null,
      bugfixCommits: fileHistory?.bugfixCommits ?? null,
      authorPriorCommits: fileHistory?.authorPriorCommits ?? null,
      fanIn: fanIn.has(file.path) ? (fanIn.get(file.path) as number) : null,
      fanOut: null,
      fanSource: fanIn.has(file.path) ? 'grep' : null,
      complexityBefore: structure.complexityBefore,
      complexityAfter: structure.complexityAfter,
      sensitivePath: { match: sensitiveRule !== null, rule: sensitiveRule },
      testFile,
      coverageDelta: null,
    };

    const hunks: Hunk[] = file.hunks.map((hunk, hunkIndex) => {
      const symbols = functionsOverlapping(structure.head?.functions ?? [], [
        [Math.max(hunk.newStart, 1), Math.max(hunk.newStart + Math.max(hunk.newLines, 1) - 1, 1)],
      ]).map((fn) => fn.name);

      const kindInput = {
        lines: hunk.lines,
        header: hunk.header,
        symbols,
        language: hazardLanguage,
        testFile,
        headImportRanges: structure.headImports,
        baseImportRanges: structure.baseImports,
      };
      const kind = classifyKind(kindInput);
      const features = hunkFeatures(kindInput, overrides.hazardPatterns);
      const hunkId = `${id}.h${hunkIndex + 1}`;
      featuresByHunk.set(hunkId, features);

      return {
        id: hunkId,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        header: hunk.header,
        symbols,
        kind,
        lines: hunk.lines,
        risk: riskOf({ signals, features, kind, path: file.path, generated }),
      };
    });

    files.push({
      id,
      path: file.path,
      previousPath: file.previousPath,
      status: file.status,
      language,
      binary: file.binary,
      generated,
      additions: file.additions,
      deletions: file.deletions,
      signals,
      hunks,
    });
  }

  const groups = stage1Groups(files);

  const document = buildDocument({
    pr: {
      ...pr,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
      changedFiles: files.length,
    },
    checkout,
    files,
    groups,
    graphStatus: status('pending', generatedAt),
    generatedAt,
  });

  return { document, diffBase, goFilesByPath, featuresByHunk };
}

function sumHistory(
  history: ReadonlyMap<string, FileHistory>,
  path: string,
  previousPath: string | null,
): FileHistory {
  const parts = [history.get(path), previousPath === null ? undefined : history.get(previousPath)];
  return {
    churnCommits90d: parts.reduce((total, part) => total + (part?.churnCommits90d ?? 0), 0),
    bugfixCommits: parts.reduce((total, part) => total + (part?.bugfixCommits ?? 0), 0),
    authorPriorCommits: parts.reduce((total, part) => total + (part?.authorPriorCommits ?? 0), 0),
  };
}
