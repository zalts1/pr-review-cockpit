import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  Check,
  CheckoutInfo,
  Comment,
  DocumentStatus,
  Graph,
  Group,
  PrInfo,
  ReviewDocument,
  ReviewFile,
  SectionState,
  SectionStatus,
} from '@review-cockpit/schema';
import { SCHEMA_VERSION, validateDocument } from '@review-cockpit/schema';
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
  checks?: Check[];
  graph?: Graph;
  graphStatus: SectionStatus;
  generatedAt: string;
}

/**
 * Stage 2 sections are present and pending from the first write, so the cockpit
 * reads status rather than checking for missing keys.
 */
export function buildDocument(parts: DocumentParts): ReviewDocument {
  const at = parts.generatedAt;
  const ready = status('ready', at);
  const pending = status('pending', at);

  const documentStatus: DocumentStatus = {
    files: ready,
    comments: ready,
    checks: ready,
    groups: pending,
    path: pending,
    summary: pending,
    graph: parts.graphStatus,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: at,
    tool: { name: 'review-cockpit', version: TOOL_VERSION },
    pr: parts.pr,
    checkout: parts.checkout,
    status: documentStatus,
    files: parts.files,
    comments: parts.comments ?? [],
    checks: parts.checks ?? [],
    groups: parts.groups,
    path: [],
    summary: {},
    graph: parts.graph ?? { nodes: [], edges: [], truncated: false },
  };
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
