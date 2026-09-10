import { describe, expect, it } from 'vitest';
import type { ReviewDocument } from '../src/index.js';
import { validateDocument, validateDrafts, validateJudgment } from '../src/index.js';
import { draftsFile, judgment, readyDocument } from './helpers.js';

function rulesOf(result: { errors: Array<{ rule: string }> }): string[] {
  return result.errors.map((e) => e.rule);
}

describe('a valid document', () => {
  it('has no errors and no warnings', () => {
    const result = validateDocument(readyDocument());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts a document whose stage 2 is still pending', () => {
    const doc = readyDocument();
    doc.path = [];
    doc.summary = { counts: doc.summary.counts };
    for (const section of ['groups', 'path', 'summary'] as const) {
      doc.status[section] = { state: 'pending', updatedAt: '2026-09-08T12:00:00Z' };
    }
    expect(validateDocument(doc).errors).toEqual([]);
  });
});

const breaks: Array<[rule: string, apply: (doc: ReviewDocument) => void]> = [
  ['schema', (doc) => ((doc.files[0]! as { additions: unknown }).additions = 'two')],
  ['schema', (doc) => delete (doc.pr as Partial<ReviewDocument['pr']>).head],
  ['head-sha', (doc) => (doc.pr.head.sha = 'deadbeef')],
  [
    'status-message',
    (doc) => (doc.status.graph = { state: 'failed', updatedAt: '2026-09-08T12:00:00Z' }),
  ],
  ['file-id-unique', (doc) => (doc.files[1]!.id = 'f1')],
  ['hunk-id-format', (doc) => (doc.files[1]!.hunks[0]!.id = 'f2.h9')],
  ['hunk-id-unique', (doc) => (doc.files[1]!.hunks[0]!.id = 'f1.h1')],
  ['hunk-line-arithmetic', (doc) => (doc.files[0]!.hunks[0]!.oldLines = 7)],
  ['hunk-line-arithmetic', (doc) => (doc.files[0]!.hunks[0]!.lines[1]!.oldNo = 3)],
  ['file-line-counts', (doc) => (doc.files[0]!.additions = 9)],
  ['pr-line-counts', (doc) => (doc.pr.changedFiles = 5)],
  ['risk-floor', (doc) => (doc.files[0]!.hunks[1]!.risk.level = 'low')],
  ['risk-mode', (doc) => (doc.files[0]!.hunks[0]!.risk.mode = 'scrutinize')],
  [
    'risk-adjusted-by',
    (doc) =>
      (doc.files[0]!.hunks[0]!.risk.adjustedBy = { from: 'high', to: 'low', why: 'backwards' }),
  ],
  ['fan-source', (doc) => Object.assign(doc.files[0]!.signals, { fanIn: null, fanOut: null })],
  ['comment-id-unique', (doc) => doc.comments.push(comment(), comment())],
  [
    'comment-hunk-exists',
    (doc) => doc.comments.push({ ...comment(), hunkId: 'f9.h1' }),
  ],
  ['comment-hunk-line', (doc) => doc.comments.push({ ...comment(), line: 900 })],
  ['comment-hunk-line', (doc) => doc.comments.push({ ...comment(), path: 'other/file.go' })],
  ['group-id-unique', (doc) => (doc.groups = [group(['f1.h1']), group([])])],
  [
    'group-collapsed-scrutinize',
    (doc) => {
      doc.groups = [{ ...group(['f1.h1']), mode: 'scrutinize', collapsedByDefault: true }];
      doc.path.unshift({ step: 0, ref: { kind: 'group', id: 'g1' }, phase: 'other', note: null });
      renumber(doc);
    },
  ],
  ['group-hunk-exists', (doc) => (doc.groups = [group(['f9.h1'])])],
  [
    'group-hunk-once',
    (doc) => (doc.groups = [group(['f1.h1']), { ...group(['f1.h1']), id: 'g2' }]),
  ],
  ['group-skim-floor', (doc) => (doc.groups = [group(['f1.h2'])])],
  ['path-step-numbers', (doc) => (doc.path[1]!.step = 7)],
  ['path-ref-once', (doc) => doc.path.push({ ...doc.path[0]!, step: 4 })],
  ['path-ref-exists', (doc) => (doc.path[0]!.ref.id = 'f9.h1')],
  ['path-ref-exists', (doc) => (doc.path[0]!.ref = { kind: 'group', id: 'g9' })],
  [
    'path-hunk-in-group',
    (doc) => {
      doc.groups = [group(['f1.h1'])];
      doc.path.push({ step: 4, ref: { kind: 'group', id: 'g1' }, phase: 'other', note: null });
    },
  ],
  ['path-group-once', (doc) => (doc.groups = [group(['f1.h1'])])],
  ['path-coverage', (doc) => doc.path.splice(2, 1)],
  ['graph-node-id-unique', (doc) => (doc.graph.nodes = [node(), node()])],
  ['graph-hunk-exists', (doc) => (doc.graph.nodes = [{ ...node(), hunkIds: ['f9.h1'] }])],
  ['graph-node-changed', (doc) => (doc.graph.nodes = [{ ...node(), hunkIds: [] }])],
  [
    'graph-edge-node',
    (doc) => {
      doc.graph.nodes = [node()];
      doc.graph.edges = [{ from: 'n1', to: 'n9', kind: 'calls' }];
    },
  ],
  [
    'comment-id-unique',
    (doc) => {
      doc.comments.push(comment());
      doc.conversation = [conversationComment('c1')];
    },
  ],
  [
    'bot-summary-source',
    (doc) =>
      (doc.botSummaries = [
        {
          source: { kind: 'human', name: 'danat' },
          riskLevel: 'medium',
          body: 'Looks risky.',
          url: 'https://github.com/northwind-labs/tenant-platform/pull/7',
        },
      ]),
  ],
  ['summary-ready', (doc) => (doc.summary = { tldr: 'only this', counts: doc.summary.counts })],
  ['summary-counts', (doc) => (doc.summary.counts.highRisk = 4)],
  [
    'graph-package-count',
    (doc) => (doc.graph.nodes = [{ ...node(), kind: 'package', file: null }]),
  ],
  [
    'graph-package-count',
    (doc) =>
      (doc.graph.nodes = [{ ...node(), count: { changedFunctions: 1, foldedNeighbours: 0 } }]),
  ],
];

describe.each(breaks)('a document broken in one place (%s)', (rule, apply) => {
  it(`reports ${rule}`, () => {
    const doc = readyDocument();
    apply(doc);
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(rulesOf(result)).toContain(rule);
  });
});

describe('warnings', () => {
  it('allows an unknown field and names it', () => {
    const doc = readyDocument() as ReviewDocument & { mood?: string };
    doc.mood = 'hopeful';
    const result = validateDocument(doc);
    expect(result.ok).toBe(true);
    expect(result.warnings[0]?.rule).toBe('unknown-field');
    expect(result.warnings[0]?.message).toContain('mood');
  });

  it('warns about a document from another major version', () => {
    const doc = readyDocument();
    doc.schemaVersion = '2.0.0';
    const result = validateDocument(doc);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.rule)).toContain('schema-version');
  });

  it('warns when one thread holds comments on two paths', () => {
    const doc = readyDocument();
    doc.comments = [
      { ...comment(), id: 'c1', threadId: 't1' },
      { ...comment(), id: 'c2', threadId: 't1', path: 'api/http/handler.go', hunkId: 'f2.h1' },
    ];
    const result = validateDocument(doc);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.rule)).toContain('comment-thread-path');
  });

  it('accepts a conversation comment and a bot summary', () => {
    const doc = readyDocument();
    doc.conversation = [conversationComment('ic1')];
    doc.botSummaries = [
      {
        source: { kind: 'bot', name: 'Cursor Bugbot' },
        riskLevel: 'medium',
        body: '**Overview**\nAdds the profile API.',
        url: 'https://github.com/northwind-labs/tenant-platform/pull/7',
      },
    ];
    const result = validateDocument(doc);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('warns when a high-risk hunk has no reason', () => {
    const doc = readyDocument();
    doc.files[0]!.hunks[1]!.risk.reason = null;
    const result = validateDocument(doc);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.rule)).toContain('risk-reason-missing');
  });
});

describe('messages', () => {
  it('names the JSON path and says the rule in plain words', () => {
    const doc = readyDocument();
    doc.files[0]!.hunks[1]!.risk.level = 'medium';
    const [error] = validateDocument(doc).errors;
    expect(error?.path).toBe('files[0].hunks[1].risk.level');
    expect(error?.message).toBe(
      'files[0].hunks[1].risk.level: is medium, below the deterministic floor high. ' +
        'The judgment pass may raise a level, never lower it.',
    );
  });

  it('names the missing property of a schema error', () => {
    const doc = readyDocument();
    delete (doc.files[0]!.hunks[0]! as Partial<ReviewDocument['files'][0]['hunks'][0]>).kind;
    const [error] = validateDocument(doc).errors;
    expect(error?.path).toBe('files[0].hunks[0].kind');
    expect(error?.message).toContain('is required');
  });
});

describe('validateJudgment', () => {
  it('accepts a judgment with every section', () => {
    const result = validateJudgment(
      judgment({
        groups: [
          {
            kind: 'mechanical-rename',
            title: 'Rename Record to Profile',
            hunkIds: ['f1.h1'],
            mode: 'skim',
          },
        ],
        path: [{ ref: { kind: 'hunk', id: 'f1.h2' }, phase: 'core', note: null }],
        reasons: { 'f1.h2': 'Changes the error contract.' },
        riskAdjustments: [{ hunkId: 'f2.h1', level: 'high', why: 'Callers compare sentinels.' }],
      }),
    );
    expect(result.errors).toEqual([]);
  });

  it('rejects a judgment written against another major version', () => {
    const result = validateJudgment(judgment({ schemaVersion: '2.0.0' }));
    expect(rulesOf(result)).toContain('judgment-version');
  });

  it('rejects a judgment with no summary', () => {
    const bare = { schemaVersion: '1.0.0' };
    expect(rulesOf(validateJudgment(bare))).toContain('schema');
  });

  it('rejects the same hunk in two proposed groups', () => {
    const result = validateJudgment(
      judgment({
        groups: [
          { kind: 'import', title: 'Imports', hunkIds: ['f1.h1'], mode: 'skim' },
          { kind: 'formatting', title: 'gofmt', hunkIds: ['f1.h1'], mode: 'skim' },
        ],
      }),
    );
    expect(rulesOf(result)).toContain('judgment-group-hunk-once');
  });

  it('rejects a step walked twice', () => {
    const result = validateJudgment(
      judgment({
        path: [
          { ref: { kind: 'hunk', id: 'f1.h1' }, phase: 'core', note: null },
          { ref: { kind: 'hunk', id: 'f1.h1' }, phase: 'tests', note: null },
        ],
      }),
    );
    expect(rulesOf(result)).toContain('judgment-path-ref-once');
  });

  it('warns about a reason it will have to cut', () => {
    const result = validateJudgment(judgment({ reasons: { 'f1.h1': 'x'.repeat(240) } }));
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.rule)).toContain('judgment-reason-length');
  });
});

describe('validateDrafts', () => {
  it('accepts a drafts file', () => {
    expect(validateDrafts(draftsFile()).errors).toEqual([]);
  });

  it('rejects a repeated draft id', () => {
    const file = draftsFile();
    file.drafts.push({ ...file.drafts[0]! });
    expect(rulesOf(validateDrafts(file))).toContain('draft-id-unique');
  });

  it('rejects a draft bound to something that is not a commit', () => {
    const file = draftsFile();
    file.drafts[0]!.commitId = 'HEAD';
    expect(rulesOf(validateDrafts(file))).toContain('draft-commit-id');
  });

  it('rejects half a multi-line range', () => {
    const file = draftsFile();
    file.drafts[0]!.startLine = 9;
    expect(rulesOf(validateDrafts(file))).toContain('draft-range');
  });

  it('rejects a verdict GitHub does not have', () => {
    expect(rulesOf(validateDrafts({ ...draftsFile(), verdict: 'MERGE' }))).toContain('schema');
  });
});

function comment(): ReviewDocument['comments'][number] {
  return {
    id: 'c1',
    source: { kind: 'bot', name: 'Cursor Bugbot' },
    author: 'cursor[bot]',
    path: 'api/service/record.go',
    line: 11,
    side: 'RIGHT',
    hunkId: 'f1.h1',
    body: 'This drops the sentinel.',
    url: 'https://github.com/northwind-labs/tenant-platform/pull/7#discussion_r1',
    createdAt: '2026-09-08T12:00:00Z',
    resolved: false,
    severity: 'medium',
  };
}

function conversationComment(
  id: string,
): NonNullable<ReviewDocument['conversation']>[number] {
  return {
    id,
    source: { kind: 'human', name: 'danat' },
    author: 'danat',
    path: null,
    line: null,
    side: null,
    hunkId: null,
    body: 'Ran this against staging and the backfill took 40 seconds.',
    url: 'https://github.com/northwind-labs/tenant-platform/pull/7#issuecomment-1',
    createdAt: '2026-09-08T12:10:00Z',
    resolved: false,
    severity: null,
  };
}

function group(hunkIds: string[]): ReviewDocument['groups'][number] {
  return {
    id: 'g1',
    kind: 'mechanical-rename',
    title: 'Rename Record to Profile',
    description: '',
    hunkIds,
    mode: 'skim',
    collapsedByDefault: true,
    producedBy: 'stage2',
  };
}

function node(): ReviewDocument['graph']['nodes'][number] {
  return {
    id: 'n1',
    kind: 'function',
    label: 'Service.Update',
    file: 'api/service/record.go',
    changed: true,
    hunkIds: ['f1.h1'],
  };
}

function renumber(doc: ReviewDocument): void {
  doc.path.forEach((step, i) => (step.step = i + 1));
}
