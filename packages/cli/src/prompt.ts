import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Group, ReviewDocument } from '@review-cockpit/schema';
import { judgmentSchema, REASON_MAX_LENGTH, SCHEMA_VERSION } from '@review-cockpit/schema';
import { buildCompact } from '@review-cockpit/analyzer';

export const PROMPT_TEMPLATE_PATH = join('skill', 'review', 'judgment-prompt.md');

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/**
 * The template ships as text in the repository, so it is reviewable as prose. It sits
 * outside the package, and the built CLI runs from packages/cli/dist, so the search walks
 * up from this module rather than resolving a fixed relative path.
 */
export function findPromptTemplate(from: string = fileURLToPath(import.meta.url)): string {
  let directory = dirname(from);
  for (;;) {
    const candidate = join(directory, PROMPT_TEMPLATE_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(
        `the judgment prompt template ${PROMPT_TEMPLATE_PATH} was not found above ${from}`,
      );
    }
    directory = parent;
  }
}

export function renderPrompt(template: string, values: Record<string, string>): string {
  const missing = new Set<string>();
  const filled = template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      missing.add(name);
      return _match;
    }
    return value;
  });

  if (missing.size > 0) {
    throw new Error(
      `the judgment prompt template asks for values the CLI does not have: ${[...missing].sort().join(', ')}`,
    );
  }
  return filled;
}

function highFloorHunks(document: ReviewDocument): string {
  const lines: string[] = [];
  for (const file of document.files) {
    for (const hunk of file.hunks) {
      if (hunk.risk.floor !== 'high') continue;
      const symbols = hunk.symbols.length === 0 ? 'no parsed symbol' : hunk.symbols.join(', ');
      lines.push(`- \`${hunk.id}\` — ${file.path}, ${symbols}`);
    }
  }
  if (lines.length === 0) {
    return 'None. No hunk came out with a high floor, so a reason is required only on a hunk you raise to high.';
  }
  return lines.join('\n');
}

function stage1GroupList(groups: readonly Group[]): string {
  const stage1 = groups.filter((group) => group.producedBy === 'stage1');
  if (stage1.length === 0) {
    return 'None. The analyzer made no deterministic groups, so every step must name a hunk.';
  }
  return stage1
    .map(
      (group) =>
        `- \`${group.id}\` — ${group.kind}, ${group.mode}, ${group.hunkIds.length} hunk${group.hunkIds.length === 1 ? '' : 's'}: ${group.title}`,
    )
    .join('\n');
}

function walkHunkCount(document: ReviewDocument): number {
  const folded = new Set(
    document.groups.filter((group) => group.kind === 'generated').flatMap((group) => group.hunkIds),
  );
  let count = 0;
  for (const file of document.files) {
    for (const hunk of file.hunks) if (!folded.has(hunk.id)) count += 1;
  }
  return count;
}

export interface PromptPaths {
  documentPath: string;
  judgmentPath: string;
}

export function buildPrompt(
  document: ReviewDocument,
  paths: PromptPaths,
  template: string = readFileSync(findPromptTemplate(), 'utf8'),
): string {
  const { pr } = document;
  const target = `${pr.owner}/${pr.repo}#${pr.number}`;

  return renderPrompt(template, {
    pr: target,
    prUrl: pr.url,
    checkoutPath: document.checkout.path,
    documentPath: paths.documentPath,
    judgmentPath: paths.judgmentPath,
    judgeMergeCommand: `cockpit judge-merge ${target}`,
    schemaVersion: SCHEMA_VERSION,
    reasonMaxLength: String(REASON_MAX_LENGTH),
    walkHunkCount: String(walkHunkCount(document)),
    highFloorHunks: highFloorHunks(document),
    stage1Groups: stage1GroupList(document.groups),
    judgmentSchema: JSON.stringify(judgmentSchema, null, 2),
    compact: buildCompact(document),
  });
}
