import { existsSync } from 'node:fs';
import {
  compactFile,
  diffBytes,
  documentFile,
  formatBytes,
  readDocument,
  resolveRef,
  writeCompact,
} from '@review-cockpit/analyzer';

export function compactCommand(prArg: string, cwd: string): number {
  const ref = resolveRef(prArg, cwd);
  const document = documentFile(ref);
  if (!existsSync(document)) {
    console.error(`no review document at ${document}. Run cockpit analyze ${prArg} first.`);
    return 1;
  }

  const target = compactFile(ref);
  const doc = readDocument(document);
  const bytes = writeCompact(target, doc);
  console.error(
    `[compact] ${formatBytes(bytes)}, against ${formatBytes(diffBytes(doc))} of diff in the document`,
  );
  console.log(target);
  return 0;
}
