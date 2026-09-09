import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  documentFile,
  judgmentFile,
  logFile,
  nowIso,
  readDocument,
  rejectedJudgmentFile,
  resolveRef,
  writeDocument,
} from '@review-cockpit/analyzer';
import type { Judgment, MergeLogEntry, ReviewDocument } from '@review-cockpit/schema';
import { merge, validateDocument, validateJudgment } from '@review-cockpit/schema';
import { countsOf, printIssues, printMergeLog } from '../report.js';

/** How many errors a person is shown before the rest are counted. Fixing five is a task; fixing forty is not. */
const ERRORS_SHOWN = 5;

export interface JudgeMergeFlags {
  cwd: string;
  judgment?: string;
}

export function judgeMergeCommand(prArg: string, flags: JudgeMergeFlags): number {
  const ref = resolveRef(prArg, flags.cwd);
  const target = `${ref.owner}/${ref.repo}#${ref.number}`;
  const documentPath = documentFile(ref);
  const source = flags.judgment === undefined ? judgmentFile(ref) : resolve(flags.judgment);
  const rejectedPath = rejectedJudgmentFile(ref);

  if (!existsSync(documentPath)) {
    console.error(`no review document at ${documentPath}. Run cockpit analyze ${prArg} first.`);
    return 1;
  }
  if (!existsSync(source)) {
    console.error(
      `no judgment file at ${source}. Run cockpit judge-prompt ${prArg}, follow it, and write the file.`,
    );
    return 1;
  }

  const text = readFileSync(source, 'utf8');
  const reject = (headline: string, errors: string[]): number => {
    keepRejected(source, rejectedPath, text);
    console.error(headline);
    for (const message of errors.slice(0, ERRORS_SHOWN)) console.error(`  ${message}`);
    if (errors.length > ERRORS_SHOWN) {
      console.error(`  and ${errors.length - ERRORS_SHOWN} more`);
    }
    console.error(`kept your file as ${rejectedPath}. Nothing was merged.`);
    console.error(
      `Fix those errors, write the file again to ${judgmentFile(ref)}, and run cockpit judge-merge ${prArg}.`,
    );
    return 1;
  };

  let judgment: unknown;
  try {
    judgment = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return reject(`${source} is not valid JSON.`, [reason]);
  }

  const document = readDocument(documentPath);
  const documentResult = validateDocument(document);
  if (!documentResult.ok) {
    console.error(`${documentPath} is not a valid review document (${countsOf(documentResult)}).`);
    printIssues(documentResult);
    console.error(`Nothing was merged. Re-run cockpit analyze ${prArg}.`);
    return 1;
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
  printMergeLog(result.log);
  console.error(`[judge-merge] ${summarise(result.document)}`);
  console.error(`[judge-merge] wrote ${documentPath}, log in ${logFile(ref)}`);
  console.log(documentPath);
  return 0;
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
