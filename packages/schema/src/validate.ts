import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsCjs from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import type {
  Group,
  Hunk,
  ReviewDocument,
  ReviewFile,
  RiskLevel,
} from './generated/document.js';
import type { Judgment } from './generated/judgment.js';
import type { Draft, DraftsFile } from './generated/drafts.js';
import { draftsSchema, judgmentSchema, reviewDocumentSchema } from './schemas.js';
import { SECTION_NAMES } from './types.js';
import { SUPPORTED_SCHEMA_MAJOR, majorOf } from './version.js';

export interface Issue {
  rule: string;
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
}

export const REASON_MAX_LENGTH = 200;

const levelRank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

// ajv-formats is CommonJS with module.exports set to the plugin itself, which
// TypeScript types as the module namespace rather than as the callable.
const addFormats = addFormatsCjs as unknown as FormatsPlugin;

class Issues {
  readonly errors: Issue[] = [];
  readonly warnings: Issue[] = [];

  error(rule: string, path: string, message: string): void {
    this.errors.push({ rule, path, message: `${path}: ${message}` });
  }

  warn(rule: string, path: string, message: string): void {
    this.warnings.push({ rule, path, message: `${path}: ${message}` });
  }

  result(): ValidationResult {
    return { ok: this.errors.length === 0, errors: this.errors, warnings: this.warnings };
  }
}

function jsonPath(instancePath: string, appendKey?: string): string {
  const segments = instancePath.split('/').filter((s) => s.length > 0);
  if (appendKey !== undefined) segments.push(appendKey);
  let out = '';
  for (const segment of segments) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (/^\d+$/.test(key)) out += `[${key}]`;
    else if (/^[A-Za-z_$][\w$]*$/.test(key)) out += out === '' ? key : `.${key}`;
    else out += `[${JSON.stringify(key)}]`;
  }
  return out === '' ? '(root)' : out;
}

function ajvMessage(error: ErrorObject): string {
  const allowed = (error.params as { allowedValues?: unknown[] }).allowedValues;
  if (error.keyword === 'required') return 'is required and is missing';
  if (allowed) return `${error.message ?? 'is invalid'} (${allowed.map((v) => JSON.stringify(v)).join(', ')})`;
  return error.message ?? 'is invalid';
}

// Unknown fields stay legal, so the same schema is compiled a second time with
// every open object closed. Only its additionalProperties errors are reported.
function closedCopy(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(closedCopy);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$id' && typeof value === 'string') {
      out[key] = `${value}:closed`;
      continue;
    }
    out[key] = key === 'additionalProperties' && value === true ? false : closedCopy(value);
  }
  return out;
}

function compiler(): {
  open: (schema: unknown) => ValidateFunction;
  closed: (schema: unknown) => ValidateFunction;
} {
  const open = new Ajv2020({ allErrors: true, strict: false });
  const closed = new Ajv2020({ allErrors: true, strict: false });
  addFormats(open);
  addFormats(closed);
  return {
    open: (schema) => open.compile(schema as object),
    closed: (schema) => closed.compile(closedCopy(schema) as object),
  };
}

const compile = compiler();

const validators = {
  document: { open: compile.open(reviewDocumentSchema), closed: compile.closed(reviewDocumentSchema) },
  judgment: { open: compile.open(judgmentSchema), closed: compile.closed(judgmentSchema) },
  drafts: { open: compile.open(draftsSchema), closed: compile.closed(draftsSchema) },
};

function runSchema(
  pair: { open: ValidateFunction; closed: ValidateFunction },
  value: unknown,
  issues: Issues,
): boolean {
  const ok = pair.open(value);
  if (!ok) {
    for (const error of pair.open.errors ?? []) {
      const key =
        error.keyword === 'required'
          ? (error.params as { missingProperty: string }).missingProperty
          : undefined;
      issues.error('schema', jsonPath(error.instancePath, key), ajvMessage(error));
    }
  }

  pair.closed(value);
  for (const error of pair.closed.errors ?? []) {
    if (error.keyword !== 'additionalProperties') continue;
    const key = (error.params as { additionalProperty: string }).additionalProperty;
    issues.warn(
      'unknown-field',
      jsonPath(error.instancePath, key),
      'is not part of this schema version and is ignored',
    );
  }

  return ok;
}

function checkSchemaVersion(version: string, issues: Issues): void {
  const major = majorOf(version);
  if (major !== null && major !== SUPPORTED_SCHEMA_MAJOR) {
    issues.warn(
      'schema-version',
      'schemaVersion',
      `is ${version}, and this package supports ${SUPPORTED_SCHEMA_MAJOR}.x. A renderer will refuse it.`,
    );
  }
}

interface HunkIndex {
  hunk: Hunk;
  file: ReviewFile;
  path: string;
}

export function validateDocument(doc: unknown): ValidationResult {
  const issues = new Issues();
  if (!runSchema(validators.document, doc, issues)) return issues.result();

  const document = doc as ReviewDocument;
  checkSchemaVersion(document.schemaVersion, issues);

  if (!/^[0-9a-f]{40}$/.test(document.pr.head.sha)) {
    issues.error(
      'head-sha',
      'pr.head.sha',
      `is "${document.pr.head.sha}", not a 40-character hex commit SHA. Every posted comment binds to it.`,
    );
  }

  for (const name of SECTION_NAMES) {
    const status = document.status[name];
    if (status.state === 'failed' && !status.message) {
      issues.error(
        'status-message',
        `status.${name}.message`,
        'is required because the section state is failed; the reviewer is shown this text',
      );
    }
  }

  const stage2Ready = document.status.summary.state === 'ready';
  const hunks = new Map<string, HunkIndex>();
  const fileIds = new Set<string>();
  let additions = 0;
  let deletions = 0;

  for (const [fi, file] of document.files.entries()) {
    const at = `files[${fi}]`;
    if (fileIds.has(file.id)) {
      issues.error('file-id-unique', `${at}.id`, `repeats the file id "${file.id}"`);
    }
    fileIds.add(file.id);

    let fileAdds = 0;
    let fileDels = 0;

    for (const [hi, hunk] of file.hunks.entries()) {
      const hunkAt = `${at}.hunks[${hi}]`;
      const expectedId = `${file.id}.h${hi + 1}`;
      if (hunk.id !== expectedId) {
        issues.error(
          'hunk-id-format',
          `${hunkAt}.id`,
          `is "${hunk.id}", but a hunk id is <fileId>.h<index> counting from 1, so it must be "${expectedId}"`,
        );
      }
      if (hunks.has(hunk.id)) {
        issues.error('hunk-id-unique', `${hunkAt}.id`, `repeats the hunk id "${hunk.id}"`);
      }
      hunks.set(hunk.id, { hunk, file, path: hunkAt });

      checkHunkLines(hunk, hunkAt, issues);
      checkRisk(hunk, hunkAt, stage2Ready, issues);

      fileAdds += hunk.lines.filter((l) => l.type === 'add').length;
      fileDels += hunk.lines.filter((l) => l.type === 'del').length;
    }

    if (file.additions !== fileAdds) {
      issues.error(
        'file-line-counts',
        `${at}.additions`,
        `is ${file.additions} but the hunks of ${file.path} hold ${fileAdds} added lines`,
      );
    }
    if (file.deletions !== fileDels) {
      issues.error(
        'file-line-counts',
        `${at}.deletions`,
        `is ${file.deletions} but the hunks of ${file.path} hold ${fileDels} deleted lines`,
      );
    }
    additions += fileAdds;
    deletions += fileDels;

    checkFanSource(file, `${at}.signals`, issues);
  }

  if (document.pr.additions !== additions) {
    issues.error(
      'pr-line-counts',
      'pr.additions',
      `is ${document.pr.additions} but the files hold ${additions} added lines`,
    );
  }
  if (document.pr.deletions !== deletions) {
    issues.error(
      'pr-line-counts',
      'pr.deletions',
      `is ${document.pr.deletions} but the files hold ${deletions} deleted lines`,
    );
  }
  if (document.pr.changedFiles !== document.files.length) {
    issues.error(
      'pr-line-counts',
      'pr.changedFiles',
      `is ${document.pr.changedFiles} but files holds ${document.files.length} entries`,
    );
  }

  checkComments(document, hunks, issues);
  const groupOfHunk = checkGroups(document, hunks, issues);
  checkPath(document, hunks, groupOfHunk, issues);
  checkGraph(document, hunks, issues);
  checkSummary(document, issues);

  return issues.result();
}

function checkHunkLines(hunk: Hunk, at: string, issues: Issues): void {
  const context = hunk.lines.filter((l) => l.type === 'context').length;
  const adds = hunk.lines.filter((l) => l.type === 'add').length;
  const dels = hunk.lines.filter((l) => l.type === 'del').length;

  if (hunk.oldLines !== context + dels) {
    issues.error(
      'hunk-line-arithmetic',
      `${at}.oldLines`,
      `is ${hunk.oldLines} but the hunk holds ${context + dels} base-side lines`,
    );
  }
  if (hunk.newLines !== context + adds) {
    issues.error(
      'hunk-line-arithmetic',
      `${at}.newLines`,
      `is ${hunk.newLines} but the hunk holds ${context + adds} head-side lines`,
    );
  }

  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  for (const [i, line] of hunk.lines.entries()) {
    const lineAt = `${at}.lines[${i}]`;
    if (line.type === 'add') {
      if (line.oldNo !== null) {
        issues.error('hunk-line-arithmetic', `${lineAt}.oldNo`, 'must be null on an added line');
      }
      if (line.newNo !== newNo) {
        issues.error(
          'hunk-line-arithmetic',
          `${lineAt}.newNo`,
          `is ${line.newNo} but the head side has reached line ${newNo}`,
        );
      }
      newNo += 1;
    } else if (line.type === 'del') {
      if (line.newNo !== null) {
        issues.error('hunk-line-arithmetic', `${lineAt}.newNo`, 'must be null on a deleted line');
      }
      if (line.oldNo !== oldNo) {
        issues.error(
          'hunk-line-arithmetic',
          `${lineAt}.oldNo`,
          `is ${line.oldNo} but the base side has reached line ${oldNo}`,
        );
      }
      oldNo += 1;
    } else {
      if (line.oldNo !== oldNo || line.newNo !== newNo) {
        issues.error(
          'hunk-line-arithmetic',
          lineAt,
          `is a context line numbered ${line.oldNo}/${line.newNo}, but the hunk has reached ${oldNo}/${newNo}`,
        );
      }
      oldNo += 1;
      newNo += 1;
    }
  }
}

function checkRisk(hunk: Hunk, at: string, stage2Ready: boolean, issues: Issues): void {
  const { risk } = hunk;
  if (levelRank[risk.level] < levelRank[risk.floor]) {
    issues.error(
      'risk-floor',
      `${at}.risk.level`,
      `is ${risk.level}, below the deterministic floor ${risk.floor}. The judgment pass may raise a level, never lower it.`,
    );
  }

  const expectedMode = risk.level === 'low' ? 'skim' : 'scrutinize';
  if (risk.mode !== expectedMode) {
    issues.error(
      'risk-mode',
      `${at}.risk.mode`,
      `is ${risk.mode}, but mode follows level, so level ${risk.level} means ${expectedMode}`,
    );
  }

  if (risk.adjustedBy) {
    if (risk.adjustedBy.from !== risk.floor) {
      issues.error(
        'risk-adjusted-by',
        `${at}.risk.adjustedBy.from`,
        `is ${risk.adjustedBy.from} but the floor it was raised from is ${risk.floor}`,
      );
    }
    if (risk.adjustedBy.to !== risk.level) {
      issues.error(
        'risk-adjusted-by',
        `${at}.risk.adjustedBy.to`,
        `is ${risk.adjustedBy.to} but the level it was raised to is ${risk.level}`,
      );
    }
    if (levelRank[risk.adjustedBy.to] <= levelRank[risk.adjustedBy.from]) {
      issues.error(
        'risk-adjusted-by',
        `${at}.risk.adjustedBy`,
        `records ${risk.adjustedBy.from} to ${risk.adjustedBy.to}, which is not a raise`,
      );
    }
  }

  if (stage2Ready && risk.level === 'high' && !risk.reason) {
    issues.warn(
      'risk-reason-missing',
      `${at}.risk.reason`,
      'is null on a high-risk hunk, so the reviewer sees heat with no explanation',
    );
  }
}

function checkFanSource(file: ReviewFile, at: string, issues: Issues): void {
  const { fanIn, fanOut, fanSource } = file.signals;
  if (fanIn === null && fanOut === null && fanSource !== null) {
    issues.error(
      'fan-source',
      `${at}.fanSource`,
      `is "${fanSource}" while both fanIn and fanOut are null; with nothing counted there is no source`,
    );
  }
}

function checkComments(
  document: ReviewDocument,
  hunks: Map<string, HunkIndex>,
  issues: Issues,
): void {
  const ids = new Set<string>();
  const threadPath = new Map<string, string>();

  for (const [i, comment] of document.comments.entries()) {
    const at = `comments[${i}]`;
    if (ids.has(comment.id)) {
      issues.error('comment-id-unique', `${at}.id`, `repeats the comment id "${comment.id}"`);
    }
    ids.add(comment.id);

    if (comment.threadId !== undefined) {
      const first = threadPath.get(comment.threadId);
      if (first === undefined) threadPath.set(comment.threadId, comment.path);
      else if (first !== comment.path) {
        issues.warn(
          'comment-thread-path',
          `${at}.path`,
          `is "${comment.path}" but thread ${comment.threadId} started on "${first}", so the cockpit will show the two under one chip`,
        );
      }
    }

    if (comment.hunkId === null) continue;
    const found = hunks.get(comment.hunkId);
    if (!found) {
      issues.error(
        'comment-hunk-exists',
        `${at}.hunkId`,
        `references the hunk "${comment.hunkId}", which is not in files. Use null for a comment outside the diff.`,
      );
      continue;
    }

    if (found.file.path !== comment.path) {
      issues.error(
        'comment-hunk-line',
        `${at}.path`,
        `is "${comment.path}" but hunk ${comment.hunkId} belongs to "${found.file.path}"`,
      );
      continue;
    }

    const numbers = found.hunk.lines
      .map((l) => (comment.side === 'RIGHT' ? l.newNo : l.oldNo))
      .filter((n): n is number => n !== null);
    if (!numbers.includes(comment.line)) {
      const range = numbers.length > 0 ? `${Math.min(...numbers)} to ${Math.max(...numbers)}` : 'no lines';
      issues.error(
        'comment-hunk-line',
        `${at}.line`,
        `is ${comment.line} on the ${comment.side} side, which is outside hunk ${comment.hunkId} (${range})`,
      );
    }
  }

  for (const [i, comment] of (document.conversation ?? []).entries()) {
    const at = `conversation[${i}]`;
    if (ids.has(comment.id)) {
      issues.error('comment-id-unique', `${at}.id`, `repeats the comment id "${comment.id}"`);
    }
    ids.add(comment.id);
  }

  for (const [i, summary] of (document.botSummaries ?? []).entries()) {
    if (summary.source.kind !== 'bot') {
      issues.error(
        'bot-summary-source',
        `botSummaries[${i}].source.kind`,
        `is "${summary.source.kind}"; a bot summary is what a bot wrote into the pull request body`,
      );
    }
  }
}

function checkGroups(
  document: ReviewDocument,
  hunks: Map<string, HunkIndex>,
  issues: Issues,
): Map<string, Group> {
  const groupOfHunk = new Map<string, Group>();
  const ids = new Set<string>();

  for (const [i, group] of document.groups.entries()) {
    const at = `groups[${i}]`;
    if (ids.has(group.id)) {
      issues.error('group-id-unique', `${at}.id`, `repeats the group id "${group.id}"`);
    }
    ids.add(group.id);

    if (group.mode === 'scrutinize' && group.collapsedByDefault) {
      issues.error(
        'group-collapsed-scrutinize',
        `${at}.collapsedByDefault`,
        'is true on a scrutinize group, which would fold a group the reviewer is told to read closely',
      );
    }

    for (const [hi, hunkId] of group.hunkIds.entries()) {
      const found = hunks.get(hunkId);
      if (!found) {
        issues.error(
          'group-hunk-exists',
          `${at}.hunkIds[${hi}]`,
          `references the hunk "${hunkId}", which is not in files`,
        );
        continue;
      }
      const owner = groupOfHunk.get(hunkId);
      if (owner) {
        issues.error(
          'group-hunk-once',
          `${at}.hunkIds[${hi}]`,
          `puts hunk ${hunkId} in group ${group.id}, but it is already in group ${owner.id}. A hunk belongs to at most one group.`,
        );
        continue;
      }
      groupOfHunk.set(hunkId, group);

      if (group.mode === 'skim' && found.hunk.risk.floor === 'high') {
        issues.error(
          'group-skim-floor',
          `${at}.hunkIds[${hi}]`,
          `puts hunk ${hunkId}, whose floor is high, in a skim group`,
        );
      }
    }
  }

  return groupOfHunk;
}

function checkPath(
  document: ReviewDocument,
  hunks: Map<string, HunkIndex>,
  groupOfHunk: Map<string, Group>,
  issues: Issues,
): void {
  const groupById = new Map(document.groups.map((g) => [g.id, g]));
  const seen = new Set<string>();
  const groupRefCounts = new Map<string, number>();
  const covered = new Set<string>();

  for (const [i, step] of document.path.entries()) {
    const at = `path[${i}]`;
    if (step.step !== i + 1) {
      issues.error(
        'path-step-numbers',
        `${at}.step`,
        `is ${step.step} but it is entry ${i + 1} of path, and step numbers run 1..n in array order`,
      );
    }

    const key = `${step.ref.kind}:${step.ref.id}`;
    if (seen.has(key)) {
      issues.error(
        'path-ref-once',
        `${at}.ref.id`,
        `walks ${step.ref.kind} ${step.ref.id} a second time; every step is walked exactly once`,
      );
      continue;
    }
    seen.add(key);

    if (step.ref.kind === 'hunk') {
      if (!hunks.has(step.ref.id)) {
        issues.error(
          'path-ref-exists',
          `${at}.ref.id`,
          `references the hunk "${step.ref.id}", which is not in files`,
        );
        continue;
      }
      const group = groupOfHunk.get(step.ref.id);
      if (group) {
        issues.error(
          'path-hunk-in-group',
          `${at}.ref.id`,
          `walks hunk ${step.ref.id} on its own, but it is inside group ${group.id}, which the walk visits as one step`,
        );
        continue;
      }
      covered.add(step.ref.id);
    } else {
      const group = groupById.get(step.ref.id);
      if (!group) {
        issues.error(
          'path-ref-exists',
          `${at}.ref.id`,
          `references the group "${step.ref.id}", which is not in groups`,
        );
        continue;
      }
      groupRefCounts.set(group.id, (groupRefCounts.get(group.id) ?? 0) + 1);
      for (const hunkId of group.hunkIds) covered.add(hunkId);
    }
  }

  if (document.status.path.state !== 'ready') return;

  for (const [i, group] of document.groups.entries()) {
    if (group.kind === 'generated') continue;
    if ((groupRefCounts.get(group.id) ?? 0) === 0) {
      issues.error(
        'path-group-once',
        `groups[${i}].id`,
        `group ${group.id} is not in path, so its hunks are never walked. Only generated groups may be left out.`,
      );
    }
  }

  for (const [hunkId, index] of hunks) {
    const group = groupOfHunk.get(hunkId);
    if (group?.kind === 'generated') continue;
    if (!covered.has(hunkId)) {
      issues.error(
        'path-coverage',
        index.path,
        `hunk ${hunkId} is not covered by path, directly or through a group. Every hunk outside a generated group is walked exactly once.`,
      );
    }
  }
}

function checkGraph(
  document: ReviewDocument,
  hunks: Map<string, HunkIndex>,
  issues: Issues,
): void {
  const nodeIds = new Set<string>();
  for (const [i, node] of document.graph.nodes.entries()) {
    const at = `graph.nodes[${i}]`;
    if (nodeIds.has(node.id)) {
      issues.error('graph-node-id-unique', `${at}.id`, `repeats the node id "${node.id}"`);
    }
    nodeIds.add(node.id);

    for (const [hi, hunkId] of node.hunkIds.entries()) {
      if (!hunks.has(hunkId)) {
        issues.error(
          'graph-hunk-exists',
          `${at}.hunkIds[${hi}]`,
          `references the hunk "${hunkId}", which is not in files`,
        );
      }
    }

    if (node.changed !== node.hunkIds.length > 0) {
      issues.error(
        'graph-node-changed',
        `${at}.changed`,
        `is ${node.changed} with ${node.hunkIds.length} hunk ids; a changed node carries the hunks it was changed by`,
      );
    }

    if (node.kind === 'package' && node.count === undefined) {
      issues.error(
        'graph-package-count',
        `${at}.count`,
        'is missing on a package node, so the map cannot say how many changed functions and folded neighbours it stands for',
      );
    }
    if (node.kind !== 'package' && node.count !== undefined) {
      issues.error(
        'graph-package-count',
        `${at}.count`,
        `is set on a ${node.kind} node, and only a package node stands for nodes that were folded away`,
      );
    }
  }

  for (const [i, edge] of document.graph.edges.entries()) {
    const at = `graph.edges[${i}]`;
    if (!nodeIds.has(edge.from)) {
      issues.error('graph-edge-node', `${at}.from`, `references the node "${edge.from}", which is not in graph.nodes`);
    }
    if (!nodeIds.has(edge.to)) {
      issues.error('graph-edge-node', `${at}.to`, `references the node "${edge.to}", which is not in graph.nodes`);
    }
  }
}

export function summaryCounts(document: ReviewDocument): {
  hunks: number;
  highRisk: number;
  skimmable: number;
} {
  const all = document.files.flatMap((f) => f.hunks);
  return {
    hunks: all.length,
    highRisk: all.filter((h) => h.risk.level === 'high').length,
    skimmable: all.filter((h) => h.risk.mode === 'skim').length,
  };
}

const SUMMARY_BRIEF_FIELDS = ['tldr', 'whereItFits', 'flow', 'example', 'watchFor'] as const;

function checkSummary(document: ReviewDocument, issues: Issues): void {
  const { summary } = document;

  if (summary.counts !== undefined) {
    const expected = summaryCounts(document);
    for (const key of ['hunks', 'highRisk', 'skimmable'] as const) {
      if (summary.counts[key] !== expected[key]) {
        issues.error(
          'summary-counts',
          `summary.counts.${key}`,
          `is ${summary.counts[key]} but the document holds ${expected[key]}. Counts are recomputed at merge, not taken from the judgment.`,
        );
      }
    }
  }

  if (document.status.summary.state !== 'ready') return;

  const missing = SUMMARY_BRIEF_FIELDS.filter((field) => summary[field] === undefined);
  if (missing.length > 0) {
    issues.error(
      'summary-ready',
      'summary',
      `is missing ${missing.join(', ')} while status.summary is ready. watchFor may be empty, but it is written.`,
    );
  }
}

export function validateJudgment(judgment: unknown): ValidationResult {
  const issues = new Issues();
  if (!runSchema(validators.judgment, judgment, issues)) return issues.result();

  const parsed = judgment as Judgment;
  const major = majorOf(parsed.schemaVersion);
  if (major !== SUPPORTED_SCHEMA_MAJOR) {
    issues.error(
      'judgment-version',
      'schemaVersion',
      `is ${parsed.schemaVersion}, and the merge understands ${SUPPORTED_SCHEMA_MAJOR}.x only. The prompt embeds the schema for one version, so this means the two have drifted.`,
    );
  }

  const owner = new Map<string, number>();
  for (const [i, group] of (parsed.groups ?? []).entries()) {
    for (const [hi, hunkId] of group.hunkIds.entries()) {
      const first = owner.get(hunkId);
      if (first !== undefined) {
        issues.error(
          'judgment-group-hunk-once',
          `groups[${i}].hunkIds[${hi}]`,
          `puts hunk ${hunkId} in a second group; groups[${first}] already claims it`,
        );
        continue;
      }
      owner.set(hunkId, i);
    }
  }

  const seen = new Set<string>();
  for (const [i, step] of (parsed.path ?? []).entries()) {
    const key = `${step.ref.kind}:${step.ref.id}`;
    if (seen.has(key)) {
      issues.error(
        'judgment-path-ref-once',
        `path[${i}].ref.id`,
        `walks ${step.ref.kind} ${step.ref.id} a second time`,
      );
    }
    seen.add(key);
  }

  for (const [hunkId, reason] of Object.entries(parsed.reasons ?? {})) {
    if (reason.length > REASON_MAX_LENGTH) {
      issues.warn(
        'judgment-reason-length',
        `reasons[${JSON.stringify(hunkId)}]`,
        `is ${reason.length} characters and will be cut to ${REASON_MAX_LENGTH} at merge`,
      );
    }
  }

  return issues.result();
}

export function validateDrafts(drafts: unknown): ValidationResult {
  const issues = new Issues();
  if (!runSchema(validators.drafts, drafts, issues)) return issues.result();

  const file = drafts as DraftsFile;
  checkSchemaVersion(file.schemaVersion, issues);

  const ids = new Set<string>();
  const lists: Array<[string, readonly Draft[]]> = [
    ['drafts', file.drafts],
    ['orphaned', file.orphaned ?? []],
  ];

  for (const [field, list] of lists) {
    for (const [i, draft] of list.entries()) {
      const at = `${field}[${i}]`;
      if (ids.has(draft.id)) {
        issues.error('draft-id-unique', `${at}.id`, `repeats the draft id "${draft.id}"`);
      }
      ids.add(draft.id);

      if (!/^[0-9a-f]{40}$/.test(draft.commitId)) {
        issues.error(
          'draft-commit-id',
          `${at}.commitId`,
          `is "${draft.commitId}", not a 40-character hex commit SHA. A draft binds to the head it was written against.`,
        );
      }

      if ((draft.startLine === null) !== (draft.startSide === null)) {
        issues.error(
          'draft-range',
          at,
          'sets one of startLine and startSide and leaves the other null; GitHub needs both for a multi-line comment',
        );
      } else if (draft.startLine !== null && draft.startLine > draft.line) {
        issues.error(
          'draft-range',
          `${at}.startLine`,
          `is ${draft.startLine}, after the comment line ${draft.line}`,
        );
      }
    }
  }

  return issues.result();
}
