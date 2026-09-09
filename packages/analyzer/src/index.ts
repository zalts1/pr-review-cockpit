export { analyze, applyGraphFan, prepare } from './analyze.js';
export type { AnalyzeOptions, AnalyzeResult, PrepareResult } from './analyze.js';
export { checkout, findLocalClone, worktreeHost } from './checkout.js';
export type { CheckoutOptions } from './checkout.js';
export { noOverrides, readRepoOverrides, readUserConfig } from './config.js';
export type { RepoOverrides, UserConfig } from './config.js';
export { firstLines, readWorktreeFile, showFile } from './content.js';
export { parseDiff } from './diff.js';
export type { ParsedFile, ParsedHunk } from './diff.js';
export { buildDocument, DocumentInvalid, nowIso, readDocument, status, writeDocument } from './document.js';
export type { DocumentParts } from './document.js';
export { CommandFailed, git, gitOk, run, runOk } from './exec.js';
export type { RunResult } from './exec.js';
export {
  classifyKind,
  hazardPatternsFor,
  hunkFeatures,
  importRanges,
  isCommentOnly,
  isImportOnly,
  isWhitespaceOnly,
} from './features.js';
export type { HunkFeatures, KindInput, LineRange } from './features.js';
export { countFromGrepOutput, exportedTsSymbols, grepFanIn } from './fanin.js';
export { detectGenerated, generatedRule, HEADER_RULE } from './generated.js';
export type { GeneratedDetection } from './generated.js';
export { firstMatch, globToRegExp, matchesGlob } from './glob.js';
export { complexityOf, functionsOverlapping, goParser, goWasmPath, parseGo } from './go.js';
export type { GoCall, GoFile, GoFunction, GoImport } from './go.js';
export {
  buildGoGraph,
  buildIndex,
  callEdges,
  INDEX_VERSION,
  isSkipped,
  listGoFiles,
  loadIndex,
  modulePathOf,
  NODE_CAP,
  resolveCall,
  saveIndex,
  symbolTable,
} from './graph.js';
export type { GoSymbol, GraphOptions, GraphResult, RepoIndex, SymbolTable } from './graph.js';
export { aggregate, gitSignals, parseLogPass } from './gitsignals.js';
export type { CommitRecord, FileHistory } from './gitsignals.js';
export { stage1Groups } from './groups.js';
export { extensionOf, hazardLanguageOf, isTestPath, languageOf } from './language.js';
export type { HazardLanguage } from './language.js';
export * from './paths.js';
export {
  BUGFIX_SUBJECT,
  ERROR_PATH_PATTERNS,
  GENERATED_PATHS,
  HAZARDS,
  MIGRATION_PATHS,
  SENSITIVE_PATHS,
  TEST_PATHS,
} from './patterns.js';
export {
  githubRemote,
  parsePrArg,
  parseRemoteUrl,
  repoRoot,
  requireGhAuth,
  resolvePr,
  resolveRef,
} from './resolve.js';
export type { ResolvedPr } from './resolve.js';
export {
  contributionsOf,
  floorOf,
  HIGH_THRESHOLD,
  levelOf,
  MEDIUM_THRESHOLD,
  modeOf,
  normAuthorPrior,
  normBugfix,
  normChurn,
  normComplexity,
  normFanIn,
  normHazards,
  normSize,
  riskOf,
  round2,
  scoreOf,
  WEIGHTS,
} from './score.js';
export type { ScoreInput } from './score.js';
export { analyzeStage1, mergeBase } from './stage1.js';
export type { Stage1Options, Stage1Result } from './stage1.js';
export { TOOL_VERSION } from './version.js';
