import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { PrRef } from '@review-cockpit/analyzer';
import {
  documentFile,
  historyFile,
  judgmentFile,
  logFile,
  nowIso,
  readDocument,
  rejectedJudgmentFile,
  resolveRef,
  runFile,
  writeDocument,
} from '@review-cockpit/analyzer';
import type { Judgment, MergeLogEntry, ReviewDocument } from '@review-cockpit/schema';
import { merge, validateDocument, validateJudgment } from '@review-cockpit/schema';
import { appendHistory } from '../history.js';
import { countsOf, printMergeLog } from '../report.js';
import { readRunRecord, secondsSince } from '../runRecord.js';

/** How many errors a person is shown before the rest are counted. Fixing five is a task; fixing forty is not. */
const ERRORS_SHOWN = 5;

export interface JudgeMergeFlags {
  cwd: string;
  judgment?: string;
}

export type MergeFailure = 'no-document' | 'invalid-document' | 'no-judgment' | 'rejected';

export interface MergeOutcome {
  ok: boolean;
  /** One line naming what went wrong, empty on success. */
  headline: string;
  reason: MergeFailure | null;
  errors: string[];
  log: MergeLogEntry[];
  documentPath: string;
  rejectedPath: string;
  /** Present on success: the one-line count of what the merge produced. */
  summary: string;
}

/**
 * Validates a judgment file and merges it into the document. The judgment pass runs in three
 * different places — the resident session, `cockpit judge --headless`, and a retry of either —
 * so the merge itself has to be callable rather than only a command.
 */
export function applyJudgment(ref: PrRef, source: string): MergeOutcome {
  const target = `${ref.owner}/${ref.repo}#${ref.number}`;
  const documentPath = documentFile(ref);
  const rejectedPath = rejectedJudgmentFile(ref);
  const base: Omit<MergeOutcome, 'ok' | 'headline' | 'errors' | 'reason'> = {
    log: [],
    documentPath,
    rejectedPath,
    summary: '',
  };

  if (!existsSync(documentPath)) {
    return {
      ...base,
      ok: false,
      reason: 'no-document',
      headline: `no review document at ${documentPath}.`,
      errors: [],
    };
  }
  if (!existsSync(source)) {
    return {
      ...base,
      ok: false,
      reason: 'no-judgment',
      headline: `no judgment file at ${source}.`,
      errors: [],
    };
  }

  const text = readFileSync(source, 'utf8');
  const reject = (headline: string, errors: string[]): MergeOutcome => {
    keepRejected(source, rejectedPath, text);
    return { ...base, ok: false, reason: 'rejected', headline, errors };
  };

  let judgment: unknown;
  try {
    judgment = JSON.parse(text);
  } catch (error) {
    return reject(`${source} is not valid JSON.`, [
      error instanceof Error ? error.message : String(error),
    ]);
  }

  const document = readDocument(documentPath);
  const documentResult = validateDocument(document);
  if (!documentResult.ok) {
    return {
      ...base,
      ok: false,
      reason: 'invalid-document',
      headline: `${documentPath} is not a valid review document (${countsOf(documentResult)}).`,
      errors: documentResult.errors.map((issue) => issue.message),
    };
  }

  const judgmentResult = validateJudgment(judgment);
  if (!judgmentResult.ok) {
    return reject(
      `the judgment for ${target} was rejected (${countsOf(judgmentResult)}).`,
      judgmentResult.errors.map((issue) => issue.message),
    );
  }
  for (const issue of judgmentResult.warnings) console.error(`  warning  ${issue.message}  [${issue.rule}]`);

  const result = merge(document, judgment as Judgment, { now: nowIso() });

  const mergedResult = validateDocument(result.document);
  if (!mergedResult.ok) {
    return reject(
      `merging the judgment for ${target} produced a document that does not validate (${countsOf(mergedResult)}).`,
      mergedResult.errors.map((issue) => issue.message),
    );
  }

  writeDocument(documentPath, result.document);
  writeMergeLog(logFile(ref), target, result.log);
  recordHistory(ref);

  return {
    ...base,
    ok: true,
    reason: null,
    headline: '',
    errors: [],
    log: result.log,
    summary: summarise(result.document),
  };
}

export function judgeMergeCommand(prArg: string, flags: JudgeMergeFlags): number {
  const ref = resolveRef(prArg, flags.cwd);
  const source = flags.judgment === undefined ? judgmentFile(ref) : resolve(flags.judgment);
  const outcome = applyJudgment(ref, source);

  if (!outcome.ok) {
    printRejection(outcome, prArg, judgmentFile(ref));
    return 1;
  }

  printMergeLog(outcome.log);
  console.error(`[judge-merge] ${outcome.summary}`);
  console.error(`[judge-merge] wrote ${outcome.documentPath}, log in ${logFile(ref)}`);
  console.log(outcome.documentPath);
  return 0;
}

export function printRejection(outcome: MergeOutcome, prArg: string, judgmentPath: string): void {
  console.error(outcome.headline);
  for (const message of outcome.errors.slice(0, ERRORS_SHOWN)) console.error(`  ${message}`);
  if (outcome.errors.length > ERRORS_SHOWN) {
    console.error(`  and ${outcome.errors.length - ERRORS_SHOWN} more`);
  }
  if (outcome.reason === 'no-judgment') {
    console.error(`Run cockpit judge ${prArg}, follow it, and write the file.`);
    return;
  }
  if (outcome.reason !== 'rejected') {
    console.error(`Nothing was merged. Re-run cockpit analyze ${prArg}.`);
    return;
  }
  console.error(`kept your file as ${outcome.rejectedPath}. Nothing was merged.`);
  console.error(
    `Fix those errors, write the file again to ${judgmentPath}, and run cockpit judge-merge ${prArg}.`,
  );
}

/** The estimate for the next review of this repository is only as good as what this one measured. */
function recordHistory(ref: PrRef): void {
  const record = readRunRecord(runFile(ref));
  if (record === null) return;
  try {
    appendHistory(historyFile(ref), {
      hunks: record.hunks,
      files: record.files,
      stage1Seconds: record.stage1Seconds,
      graphSeconds: record.graphSeconds,
      judgmentSeconds: secondsSince(record.stage1At),
      mode: record.mode,
      timestamp: nowIso(),
    });
  } catch {
    console.error('[judge-merge] the run history could not be written; the estimate stays as it was');
  }
}

/** The rejected file keeps the name the docs promise, wherever the judgment was read from. */
function keepRejected(source: string, rejectedPath: string, text: string): void {
  mkdirSync(dirname(rejectedPath), { recursive: true });
  if (resolve(source) === resolve(rejectedPath)) return;
  if (dirname(resolve(source)) === dirname(resolve(rejectedPath))) {
    renameSync(source, rejectedPath);
    return;
  }
  writeFileSync(rejectedPath, text);
}

function writeMergeLog(file: string, target: string, log: MergeLogEntry[]): void {
  const at = nowIso();
  const lines = [
    log.length === 0
      ? `${at} judge-merge ${target}: nothing dropped, clamped or appended`
      : `${at} judge-merge ${target}: ${log.length} entr${log.length === 1 ? 'y' : 'ies'}`,
    ...log.map((entry) => {
      const subject = entry.hunkId === undefined ? '' : ` ${entry.hunkId}`;
      return `  ${entry.rule}${subject}: ${entry.detail}`;
    }),
  ];
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${lines.join('\n')}\n`);
}

function summarise(document: ReviewDocument): string {
  const counts = { low: 0, medium: 0, high: 0 };
  let raised = 0;
  let reasons = 0;
  for (const file of document.files) {
    for (const hunk of file.hunks) {
      counts[hunk.risk.level] += 1;
      if (hunk.risk.adjustedBy !== null) raised += 1;
      if (hunk.risk.reason !== null) reasons += 1;
    }
  }
  const stage2 = document.groups.filter((group) => group.producedBy === 'stage2').length;
  return (
    `${counts.high} high, ${counts.medium} medium, ${counts.low} low; ` +
    `${document.summary.counts.skimmable} skimmable; ` +
    `${stage2} groups from the judgment, ${document.path.length} walk steps, ${reasons} reasons, ${raised} raises`
  );
}
