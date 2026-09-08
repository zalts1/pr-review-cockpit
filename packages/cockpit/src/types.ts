export type SectionState = 'pending' | 'ready' | 'failed';
export type RiskLevel = 'low' | 'medium' | 'high';
export type ReviewMode = 'skim' | 'scrutinize';
export type Side = 'LEFT' | 'RIGHT';

export interface SectionStatus {
  state: SectionState;
  updatedAt: string;
  message?: string;
}

export type SectionName =
  | 'files'
  | 'comments'
  | 'checks'
  | 'groups'
  | 'path'
  | 'summary'
  | 'graph';

export interface PrRef {
  ref: string;
  sha: string;
}

export interface PrInfo {
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  author: string;
  draft: boolean;
  labels: string[];
  base: PrRef;
  head: PrRef;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface CheckoutInfo {
  mode: 'worktree' | 'clone';
  path: string;
  sourceRepo?: string;
}

export interface FileSignals {
  churnCommits90d: number | null;
  bugfixCommits: number | null;
  authorPriorCommits: number | null;
  fanIn: number | null;
  fanOut: number | null;
  fanSource: 'grep' | 'graph' | null;
  complexityBefore: number | null;
  complexityAfter: number | null;
  sensitivePath: { match: boolean; rule: string | null };
  testFile: boolean;
  coverageDelta: number | null;
}

export interface RiskFactor {
  signal: string;
  contribution: number;
  detail: string;
}

export interface RiskAdjustment {
  from: RiskLevel;
  to: RiskLevel;
  why: string;
}

export interface Risk {
  floor: RiskLevel;
  level: RiskLevel;
  score: number;
  mode: ReviewMode;
  factors: RiskFactor[];
  reason: string | null;
  adjustedBy: RiskAdjustment | null;
}

export type DiffLineType = 'context' | 'add' | 'del';

export interface DiffLine {
  type: DiffLineType;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export type HunkKind = 'code' | 'import' | 'test' | 'comment-only' | 'whitespace-only';

export interface Hunk {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  symbols: string[];
  kind: HunkKind;
  lines: DiffLine[];
  risk: Risk;
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ReviewFile {
  id: string;
  path: string;
  previousPath: string | null;
  status: FileStatus;
  language: string;
  binary: boolean;
  generated: { is: boolean; rule: string | null };
  additions: number;
  deletions: number;
  signals: FileSignals;
  hunks: Hunk[];
}

export interface Comment {
  id: string;
  source: { kind: 'bot' | 'human'; name: string };
  author: string;
  path: string;
  line: number;
  side: Side;
  hunkId: string | null;
  body: string;
  url: string;
  createdAt: string;
  resolved: boolean;
  severity: RiskLevel | null;
}

export type CheckStatus =
  | 'success'
  | 'failure'
  | 'pending'
  | 'neutral'
  | 'skipped'
  | 'cancelled';

export interface Check {
  name: string;
  app: string;
  status: CheckStatus;
  url: string;
  completedAt: string | null;
}

export type GroupKind =
  | 'generated'
  | 'import'
  | 'whitespace'
  | 'mechanical-rename'
  | 'formatting'
  | 'test-update'
  | 'semantic';

export interface Group {
  id: string;
  kind: GroupKind;
  title: string;
  description: string;
  hunkIds: string[];
  mode: ReviewMode;
  collapsedByDefault: boolean;
  producedBy: 'stage1' | 'stage2';
}

export type Phase = 'models' | 'core' | 'callsites' | 'tests' | 'config' | 'other';

export interface PathStep {
  step: number;
  ref: { kind: 'hunk' | 'group'; id: string };
  phase: Phase;
  note: string | null;
}

export interface Summary {
  oneLiner: string;
  reviewFocus: string[];
  counts: { hunks: number; highRisk: number; skimmable: number };
}

export interface GraphNode {
  id: string;
  kind: 'function' | 'file' | 'package';
  label: string;
  file: string | null;
  changed: boolean;
  hunkIds: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: 'calls' | 'imports';
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface ReviewDocument {
  schemaVersion: string;
  generatedAt: string;
  tool: { name: string; version: string };
  pr: PrInfo;
  checkout: CheckoutInfo;
  status: Record<SectionName, SectionStatus>;
  files: ReviewFile[];
  comments: Comment[];
  checks: Check[];
  groups: Group[];
  path: PathStep[];
  summary: Summary | Record<string, never>;
  graph: Graph;
}
