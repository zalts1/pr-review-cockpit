import { writeFileSync } from 'node:fs';
import type { Judgment, ReviewDocument } from '@review-cockpit/schema';
import { merge, validateDocument, validateJudgment } from '@review-cockpit/schema';
import { countsOf, printIssues, printMergeLog } from '../report.js';
import { readJson } from './validate.js';

export function mergeCommand(
  documentFile: string,
  judgmentFile: string,
  out: string | undefined,
): number {
  const document = readJson(documentFile);
  const judgment = readJson(judgmentFile);

  const documentResult = validateDocument(document);
  if (!documentResult.ok) {
    console.error(`${documentFile}: not valid (${countsOf(documentResult)}), nothing was merged`);
    printIssues(documentResult);
    return 1;
  }

  const judgmentResult = validateJudgment(judgment);
  console.error(`${judgmentFile}: ${judgmentResult.ok ? 'valid' : 'not valid'} (${countsOf(judgmentResult)})`);
  printIssues(judgmentResult);
  if (!judgmentResult.ok) return 1;

  const result = merge(document as ReviewDocument, judgment as Judgment);
  printMergeLog(result.log);

  const mergedResult = validateDocument(result.document);
  if (!mergedResult.ok) {
    console.error(`the merged document is not valid (${countsOf(mergedResult)}), nothing was written`);
    printIssues(mergedResult);
    return 1;
  }

  const text = `${JSON.stringify(result.document, null, 2)}\n`;
  if (out === undefined) {
    process.stdout.write(text);
  } else {
    writeFileSync(out, text, 'utf8');
    console.error(`wrote ${out}`);
  }
  return 0;
}
