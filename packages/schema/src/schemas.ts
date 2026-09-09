import { readFileSync } from 'node:fs';

export type JsonSchema = Record<string, unknown>;

function load(name: string): JsonSchema {
  const url = new URL(`../schemas/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as JsonSchema;
}

export const reviewDocumentSchema = load('review-document.schema.json');
export const judgmentSchema = load('judgment.schema.json');
export const draftsSchema = load('drafts.schema.json');
