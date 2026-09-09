import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Comment, DiffLine, Group, Hunk, ReviewDocument, ReviewFile } from '@review-cockpit/schema';

/** A hunk with this many changed lines or more is shown as a preview, not in full. */
export const FULL_TEXT_MAX_CHANGED_LINES = 40;
export const PREVIEW_CHANGED_LINES = 15;

const LEGEND = `Legend
- Every block starts with a heading. \`## PR\`, \`## Files\`, \`## Groups\`, \`## Comments\` appear once each; \`## <hunk id>\` once per hunk.
- A file line reads: file id, status, language, added and deleted lines, hunk count, path. \`generated: <rule>\` at the end marks a file the analyzer folded, with the rule that matched it.
- A group line reads: group id, kind, mode, hunk count, title. Its hunk ids follow on the next line.
- In a hunk block: \`path\` is the file; \`symbols\` are the functions enclosing the change on the head side, and falls back to the diff header for a language the analyzer does not parse; \`kind\` is code, import, test, comment-only or whitespace-only, followed by the size of the change and the lines it covers in the head file.
- \`floor\` is the deterministic risk floor and the score behind it, then the signals that carried it, largest first. You may raise a hunk above its floor. You may never put it below.
- \`text\` says how much of the change follows: \`full\` for a hunk under ${FULL_TEXT_MAX_CHANGED_LINES} changed lines, \`first ${PREVIEW_CHANGED_LINES} changed lines\` otherwise.
- The change text is a unified diff inside a backtick fence: \`+\` added, \`-\` deleted, a space for context. \`… N more lines\` at the end counts the lines of that hunk left out. The fence grows longer than three backticks when the change text itself contains backticks.
- Hunks in a generated group are not listed. They are folded and nobody reads them.`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fenced(body: string, language = ''): string {
  let longest = 0;
  for (const run of body.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${body}\n${fence}`;
}

function changedLineCount(hunk: Hunk): number {
  return hunk.lines.filter((line) => line.type !== 'context').length;
}

function renderLine(line: DiffLine): string {
  const marker = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
  return `${marker}${line.text}`;
}

function changeText(hunk: Hunk): { body: string; note: string } {
  const changed = changedLineCount(hunk);
  if (changed < FULL_TEXT_MAX_CHANGED_LINES) {
    return { body: hunk.lines.map(renderLine).join('\n'), note: 'full' };
  }

  const shown: DiffLine[] = [];
  let counted = 0;
  for (const line of hunk.lines) {
    if (counted === PREVIEW_CHANGED_LINES) break;
    shown.push(line);
    if (line.type !== 'context') counted += 1;
  }
  const left = hunk.lines.length - shown.length;
  const body = [...shown.map(renderLine), `… ${left} more lines`].join('\n');
  return { body, note: `first ${PREVIEW_CHANGED_LINES} changed lines of ${changed}` };
}

function factorText(hunk: Hunk): string {
  if (hunk.risk.factors.length === 0) return 'no factors recorded';
  return hunk.risk.factors
    .map((factor) => `${factor.signal} ${factor.contribution.toFixed(2)} (${factor.detail})`)
    .join(' · ');
}

function fileLine(file: ReviewFile): string {
  const hunks = `${file.hunks.length} hunk${file.hunks.length === 1 ? '' : 's'}`;
  const parts = [
    file.id,
    file.status,
    file.language,
    `+${file.additions} -${file.deletions}`,
    hunks,
    file.path,
  ];
  if (file.previousPath !== null) parts.push(`was ${file.previousPath}`);
  if (file.generated.is) parts.push(`generated: ${file.generated.rule ?? 'unknown rule'}`);
  return parts.join('  ');
}

function groupBlock(group: Group): string {
  const hunks = `${group.hunkIds.length} hunk${group.hunkIds.length === 1 ? '' : 's'}`;
  const head = [group.id, group.kind, group.mode, hunks, group.title].join('  ');
  const lines = [head, `  hunks: ${group.hunkIds.join(', ')}`];
  if (group.description !== '') lines.push(`  ${group.description}`);
  return lines.join('\n');
}

/**
 * The parsed symbols when there are any, and otherwise the diff header, which is
 * all a language without tree-sitter support gives. One key either way, so the
 * block stays regular.
 */
function symbolText(hunk: Hunk): string {
  if (hunk.symbols.length > 0) return hunk.symbols.join(', ');
  return hunk.header === '' ? '-' : `- · diff header: ${hunk.header}`;
}

function hunkBlock(file: ReviewFile, hunk: Hunk): string {
  const { body, note } = changeText(hunk);
  const lastLine = hunk.newStart + Math.max(hunk.newLines - 1, 0);
  return [
    `## ${hunk.id}`,
    `path: ${file.path}`,
    `symbols: ${symbolText(hunk)}`,
    `kind: ${hunk.kind} · ${changedLineCount(hunk)} changed lines · head lines ${hunk.newStart}-${lastLine}`,
    `floor: ${hunk.risk.floor} · score ${hunk.risk.score.toFixed(2)} · ${factorText(hunk)}`,
    `text: ${note}`,
    fenced(body, 'diff'),
  ].join('\n');
}

function commentBlock(comment: Comment): string {
  const source = comment.source.kind === 'bot' ? `bot ${comment.source.name}` : `${comment.author}`;
  const where = `${comment.path}:${comment.line} ${comment.side}`;
  const hunk = comment.hunkId === null ? 'outside the current diff' : `hunk ${comment.hunkId}`;
  const severity = comment.severity === null ? '' : `  severity ${comment.severity}`;
  return [
    `${comment.id}  ${source}  ${where}  ${hunk}${severity}`,
    fenced(comment.body),
  ].join('\n');
}

/**
 * The judgment pass reads this instead of the whole document. Every field it
 * names is one the merge rules act on, so a model that reads only this file can
 * still produce a judgment the CLI accepts.
 */
export function buildCompact(document: ReviewDocument): string {
  const { pr } = document;
  const generatedGroups = document.groups.filter((group) => group.kind === 'generated');
  const foldedHunks = new Set(generatedGroups.flatMap((group) => group.hunkIds));

  const walkable = document.files.flatMap((file) =>
    file.hunks.filter((hunk) => !foldedHunks.has(hunk.id)).map((hunk) => ({ file, hunk })),
  );
  const totalHunks = document.files.reduce((count, file) => count + file.hunks.length, 0);

  const sections: string[] = [
    `# Compact view — ${pr.owner}/${pr.repo}#${pr.number}`,
    LEGEND,
    [
      '## PR',
      `title: ${pr.title}`,
      `author: ${pr.author}`,
      `url: ${pr.url}`,
      `base: ${pr.base.ref} (${pr.base.sha.slice(0, 12)})`,
      `head: ${pr.head.ref} (${pr.head.sha.slice(0, 12)})`,
      `size: ${pr.changedFiles} files, +${pr.additions} -${pr.deletions}`,
      `labels: ${pr.labels.length === 0 ? '-' : pr.labels.join(', ')}`,
      `hunks: ${totalHunks} in the document, ${walkable.length} to walk, ${foldedHunks.size} folded as generated`,
      `checkout: ${document.checkout.path}`,
      '',
      '### Body',
      pr.body.trim() === '' ? '(the pull request has no body)' : pr.body.trim(),
    ].join('\n'),
    [`## Files (${document.files.length})`, ...document.files.map(fileLine)].join('\n'),
  ];

  sections.push(
    document.groups.length === 0
      ? '## Groups (0)\nThe analyzer made no deterministic groups.'
      : [`## Groups (${document.groups.length})`, ...document.groups.map(groupBlock)].join('\n'),
  );

  for (const { file, hunk } of walkable) sections.push(hunkBlock(file, hunk));

  if (document.comments.length > 0) {
    sections.push(
      [`## Comments (${document.comments.length})`, ...document.comments.map(commentBlock)].join('\n'),
    );
  }

  return `${sections.join('\n\n')}\n`;
}

/** What the compact view is measured against: the diff the reviewer would otherwise read. */
export function diffBytes(document: ReviewDocument): number {
  let bytes = 0;
  for (const file of document.files) {
    bytes += Buffer.byteLength(`--- a/${file.path}\n+++ b/${file.path}\n`);
    for (const hunk of file.hunks) {
      bytes += Buffer.byteLength(
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}\n`,
      );
      for (const line of hunk.lines) bytes += Buffer.byteLength(`${renderLine(line)}\n`);
    }
  }
  return bytes;
}

/** Written by rename, like the document, so a reader never sees half a view. */
export function writeCompact(file: string, document: ReviewDocument): number {
  const text = buildCompact(document);
  mkdirSync(dirname(file), { recursive: true });
  const temp = join(dirname(file), `.${Date.now()}.${process.pid}.compact.tmp`);
  writeFileSync(temp, text);
  renameSync(temp, file);
  return Buffer.byteLength(text);
}
