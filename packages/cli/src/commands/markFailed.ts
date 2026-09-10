import { existsSync } from 'node:fs';
import { documentFile, nowIso, readDocument, resolveRef, status, writeDocument } from '@review-cockpit/analyzer';

export interface MarkFailedFlags {
  cwd: string;
  stage: string;
  message: string;
}

/** The stage 2 sections are one unit: the judgment pass writes all three or none. */
const STAGE_2_SECTIONS = ['groups', 'path', 'summary'] as const;

export function markFailedCommand(prArg: string, flags: MarkFailedFlags): number {
  if (flags.stage !== '2') {
    console.error(`--stage must be 2: stage 1 and stage 3 record their own failures. Got "${flags.stage}".`);
    return 2;
  }
  const message = flags.message.trim();
  if (message === '') {
    console.error('--message must say what failed, in one line the reviewer can read in the cockpit.');
    return 2;
  }

  const ref = resolveRef(prArg, flags.cwd);
  const file = documentFile(ref);
  if (!existsSync(file)) {
    console.error(`there is no review document at ${file}, so there is no stage to mark failed`);
    return 1;
  }

  const document = readDocument(file);
  const failed = status('failed', nowIso(), message);
  for (const section of STAGE_2_SECTIONS) document.status[section] = failed;
  writeDocument(file, document);

  console.error(`[mark-failed] stage 2 of ${ref.owner}/${ref.repo}#${ref.number}: ${message}`);
  console.error(`[mark-failed] ${STAGE_2_SECTIONS.join(', ')} now read failed in the cockpit`);
  console.log(file);
  return 0;
}
