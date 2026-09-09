import { existsSync } from 'node:fs';
import { documentFile, judgmentFile, readDocument, resolveRef } from '@review-cockpit/analyzer';
import { buildPrompt } from '../prompt.js';

export function judgePromptCommand(prArg: string, cwd: string): number {
  const ref = resolveRef(prArg, cwd);
  const document = documentFile(ref);
  if (!existsSync(document)) {
    console.error(`no review document at ${document}. Run cockpit analyze ${prArg} first.`);
    return 1;
  }

  const prompt = buildPrompt(readDocument(document), {
    documentPath: document,
    judgmentPath: judgmentFile(ref),
  });
  process.stdout.write(prompt);
  return 0;
}
