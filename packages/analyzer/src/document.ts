import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  BotSummary,
  Check,
  CheckoutInfo,
  Comment,
  ConversationComment,
  DocumentStatus,
  Graph,
  Group,
  PrInfo,
  ReviewDocument,
  ReviewFile,
  SectionState,
  SectionStatus,
} from '@review-cockpit/schema';
import { NOT_ATTACHED, SCHEMA_VERSION, summaryCounts, validateDocument } from '@review-cockpit/schema';
import { TOOL_VERSION } from './version.js';

export class DocumentInvalid extends Error {
  constructor(readonly issues: string[]) {
    super(`the review document failed validation:\n${issues.map((i) => `  ${i}`).join('\n')}`);
    this.name = 'DocumentInvalid';
  }
}

/** Seconds precision, so the document reads as the schema's ISO 8601 UTC. */
export function nowIso(at: Date = new Date()): string {
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function status(state: SectionState, at: string, message?: string): SectionStatus {
  return message === undefined ? { state, updatedAt: at } : { state, updatedAt: at, message };
}

export interface DocumentParts {
  pr: PrInfo;
  checkout: CheckoutInfo;
  files: ReviewFile[];
  groups: Group[];
  comments?: Comment[];
  conversation?: ConversationComment[];
  checks?: Check[];
  botSummaries?: BotSummary[];
  commentsStatus?: SectionStatus;
  checksStatus?: SectionStatus;
  graph?: Graph;
  graphStatus: SectionStatus;
  generatedAt: string;
  /** False marks the stage 2 sections "not-attached", so no placeholder claims work nobody is doing. */
  expectJudgment?: boolean;
}

/**
 * Stage 2 sections are present and pending from the first write, so the cockpit
 * reads status rather than checking for missing keys.
 */
export function buildDocument(parts: DocumentParts): ReviewDocument {
  const at = parts.generatedAt;
  const ready = status('ready', at);
  const stage2 =
    parts.expectJudgment === true ? status('pending', at) : status('pending', at, NOT_ATTACHED);

  const documentStatus: DocumentStatus = {
    files: ready,
    comments: parts.commentsStatus ?? ready,
    checks: parts.checksStatus ?? ready,
    groups: stage2,
    path: stage2,
    summary: stage2,
    graph: parts.graphStatus,
  };

  const document: ReviewDocument = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: at,
    tool: { name: 'review-cockpit', version: TOOL_VERSION },
    pr: parts.pr,
    checkout: parts.checkout,
    status: documentStatus,
    files: parts.files,
    comments: parts.comments ?? [],
    conversation: parts.conversation ?? [],
    checks: parts.checks ?? [],
    botSummaries: parts.botSummaries ?? [],
    groups: parts.groups,
    path: [],
    summary: { counts: { hunks: 0, highRisk: 0, skimmable: 0 } },
    graph: parts.graph ?? { nodes: [], edges: [], truncated: false },
  };

  document.summary.counts = summaryCounts(document);
  return document;
}

/** Validated before it is written, and written by rename so a reader never sees half a document. */
export function writeDocument(file: string, document: ReviewDocument): void {
  const result = validateDocument(document);
  if (!result.ok) throw new DocumentInvalid(result.errors.map((issue) => issue.message));

  mkdirSync(dirname(file), { recursive: true });
  const temp = join(dirname(file), `.${Date.now()}.${process.pid}.tmp`);
  writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`);
  renameSync(temp, file);
}

export function readDocument(file: string): ReviewDocument {
  return JSON.parse(readFileSync(file, 'utf8')) as ReviewDocument;
}
