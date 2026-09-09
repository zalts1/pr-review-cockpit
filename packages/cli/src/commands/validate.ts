import { readFileSync } from 'node:fs';
import type { ValidationResult } from '@review-cockpit/schema';
import { checkVersion, validateDocument, validateDrafts, validateJudgment } from '@review-cockpit/schema';
import { countsOf, printIssues } from '../report.js';

export type FileKind = 'document' | 'judgment' | 'drafts';

const kindNames: Record<FileKind, string> = {
  document: 'review document',
  judgment: 'judgment file',
  drafts: 'drafts file',
};

export function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${file} could not be read as JSON: ${reason}`);
  }
}

export function detectKind(value: unknown): FileKind {
  if (value === null || typeof value !== 'object') return 'judgment';
  const keys = value as Record<string, unknown>;
  if (Array.isArray(keys['files']) && typeof keys['pr'] === 'object' && keys['status']) {
    return 'document';
  }
  if (Array.isArray(keys['drafts'])) return 'drafts';
  return 'judgment';
}

export function validateValue(kind: FileKind, value: unknown): ValidationResult {
  if (kind === 'document') return validateDocument(value);
  if (kind === 'drafts') return validateDrafts(value);
  return validateJudgment(value);
}

export function validateCommand(file: string, asKind: FileKind | undefined): number {
  const value = readJson(file);
  const kind = asKind ?? detectKind(value);
  const result = validateValue(kind, value);

  const version =
    kind === 'judgment'
      ? null
      : checkVersion(value as { schemaVersion: string });

  console.log(`${file}: ${kindNames[kind]}, ${result.ok ? 'valid' : 'not valid'} (${countsOf(result)})`);
  printIssues(result);

  if (version && !version.ok) {
    console.error(
      `  error    schemaVersion: is ${version.documentVersion}, and this build reads ` +
        `${version.supportedMajor}.x only. Re-run the analyzer.  [schema-major]`,
    );
    return 1;
  }

  return result.ok ? 0 : 1;
}
