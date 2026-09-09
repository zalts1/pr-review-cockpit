import type { DiffLine, Hunk, PrInfo, ReviewDocument, ReviewFile } from '@review-cockpit/schema';
import { validateDocument } from '@review-cockpit/schema';
import { describe, expect, it } from 'vitest';
import {
  buildCompact,
  diffBytes,
  formatBytes,
  FULL_TEXT_MAX_CHANGED_LINES,
  PREVIEW_CHANGED_LINES,
} from '../src/compact.js';
import { buildDocument, status } from '../src/document.js';
import { stage1Groups } from '../src/groups.js';

const AT = '2026-09-09T10:00:00Z';
const SHA = 'a'.repeat(40);

function addedLines(count: number, prefix: string): DiffLine[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'add' as const,
    oldNo: null,
    newNo: i + 1,
    text: `${prefix} ${i + 1}`,
  }));
}

function hunk(fileId: string, index: number, lines: DiffLine[], header = ''): Hunk {
  const oldLines = lines.filter((line) => line.type !== 'add').length;
  const newLines = lines.filter((line) => line.type !== 'del').length;
  return {
    id: `${fileId}.h${index}`,
    oldStart: oldLines === 0 ? 0 : 1,
    oldLines,
    newStart: newLines === 0 ? 0 : 1,
    newLines,
    header,
    symbols: header === '' ? [] : ['Service.Update'],
    kind: 'code',
    lines,
    risk: {
      floor: 'medium',
      level: 'medium',
      score: 0.31,
      mode: 'scrutinize',
      factors: [{ signal: 'size', contribution: 0.05, detail: `${lines.length} lines` }],
      reason: null,
      adjustedBy: null,
    },
  };
}

function file(id: string, path: string, hunks: Hunk[], generatedRule?: string): ReviewFile {
  const lines = hunks.flatMap((h) => h.lines);
  return {
    id,
    path,
    previousPath: null,
    status: 'modified',
    language: 'go',
    binary: false,
    generated:
      generatedRule === undefined ? { is: false, rule: null } : { is: true, rule: generatedRule },
    additions: lines.filter((line) => line.type === 'add').length,
    deletions: lines.filter((line) => line.type === 'del').length,
    signals: {
      churnCommits90d: 2,
      bugfixCommits: 0,
      authorPriorCommits: 3,
      fanIn: generatedRule === undefined ? 4 : null,
      fanOut: null,
      fanSource: generatedRule === undefined ? 'grep' : null,
      complexityBefore: null,
      complexityAfter: null,
      sensitivePath: { match: false, rule: null },
      testFile: false,
      coverageDelta: null,
    },
    hunks,
  };
}

function document(files: ReviewFile[], body = 'Body of the pull request.'): ReviewDocument {
  const pr: PrInfo = {
    owner: 'northwind-labs',
    repo: 'tenant-platform',
    number: 1234,
    url: 'https://github.com/northwind-labs/tenant-platform/pull/1234',
    title: 'Add tenant record API',
    body,
    author: 'jdoe',
    draft: false,
    labels: ['backend'],
    base: { ref: 'main', sha: SHA },
    head: { ref: 'tp-329', sha: 'b'.repeat(40) },
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    changedFiles: files.length,
  };

  return buildDocument({
    pr,
    checkout: { mode: 'worktree', path: '/cache/pr-1234/worktree', sourceRepo: '/work/repo' },
    files,
    groups: stage1Groups(files),
    graphStatus: status('pending', AT),
    generatedAt: AT,
    expectJudgment: true,
  });
}

/** Everything after the legend, so a phrase the legend explains is not mistaken for a section. */
function body(compact: string): string {
  return compact.slice(compact.indexOf('\n## PR\n'));
}

describe('buildCompact', () => {
  it('writes the sections in one fixed order', () => {
    const doc = document([
      file('f1', 'api/service/tenant/record.go', [hunk('f1', 1, addedLines(3, 'line'), 'func Update()')]),
      file('f2', 'api/gen/tenant.pb.go', [hunk('f2', 1, addedLines(2, 'gen'))], '**/*.pb.go'),
    ]);

    const headings = body(buildCompact(doc))
      .split('\n')
      .filter((line) => line.startsWith('## '))
      .map((line) => line.replace(/ \(\d+\)$/, ''));

    expect(headings).toEqual(['## PR', '## Files', '## Groups', '## f1.h1']);
  });

  it('carries the pull request title, author, refs and body verbatim', () => {
    const compact = buildCompact(
      document(
        [file('f1', 'a.go', [hunk('f1', 1, addedLines(1, 'x'))])],
        '## Why\n\nA body with `markdown` in it.',
      ),
    );

    expect(compact).toContain('title: Add tenant record API');
    expect(compact).toContain('author: jdoe');
    expect(compact).toContain(`base: main (${SHA.slice(0, 12)})`);
    expect(compact).toContain('head: tp-329 (bbbbbbbbbbbb)');
    expect(compact).toContain('## Why\n\nA body with `markdown` in it.');
  });

  it('lists every file with its generated rule, and folds no file out of the list', () => {
    const compact = buildCompact(
      document([
        file('f1', 'api/service/tenant/record.go', [hunk('f1', 1, addedLines(3, 'line'))]),
        file('f2', 'api/gen/tenant.pb.go', [hunk('f2', 1, addedLines(2, 'gen'))], '**/*.pb.go'),
      ]),
    );

    expect(compact).toContain('f1  modified  go  +3 -0  1 hunk  api/service/tenant/record.go');
    expect(compact).toContain(
      'f2  modified  go  +2 -0  1 hunk  api/gen/tenant.pb.go  generated: **/*.pb.go',
    );
  });

  it('leaves out the hunks of a generated file, which nobody walks', () => {
    const compact = buildCompact(
      document([
        file('f1', 'a.go', [hunk('f1', 1, addedLines(1, 'x'))]),
        file('f2', 'api/gen/tenant.pb.go', [hunk('f2', 1, addedLines(2, 'gen'))], '**/*.pb.go'),
      ]),
    );

    expect(compact).toContain('## f1.h1');
    expect(compact).not.toContain('## f2.h1');
    expect(compact).toContain('g1  generated  skim  1 hunk  Generated files');
    expect(compact).toContain('hunks: f2.h1');
  });

  it('shows a hunk under the cap in full', () => {
    const lines = addedLines(FULL_TEXT_MAX_CHANGED_LINES - 1, 'kept');
    const compact = buildCompact(document([file('f1', 'a.go', [hunk('f1', 1, lines)])]));

    expect(compact).toContain('text: full');
    expect(compact).toContain(`+kept ${FULL_TEXT_MAX_CHANGED_LINES - 1}`);
    expect(body(compact)).not.toContain('more lines');
  });

  it('cuts a hunk at the cap to its first changed lines and counts the rest', () => {
    const lines = addedLines(FULL_TEXT_MAX_CHANGED_LINES, 'cut');
    const compact = buildCompact(document([file('f1', 'a.go', [hunk('f1', 1, lines)])]));

    expect(compact).toContain(`text: first ${PREVIEW_CHANGED_LINES} changed lines of ${FULL_TEXT_MAX_CHANGED_LINES}`);
    expect(compact).toContain(`+cut ${PREVIEW_CHANGED_LINES}`);
    expect(compact).not.toContain(`+cut ${PREVIEW_CHANGED_LINES + 1}`);
    expect(compact).toContain(`… ${FULL_TEXT_MAX_CHANGED_LINES - PREVIEW_CHANGED_LINES} more lines`);
  });

  it('counts context lines in the preview but not against the cap', () => {
    const lines: DiffLine[] = [];
    for (let i = 0; i < FULL_TEXT_MAX_CHANGED_LINES; i += 1) {
      lines.push({ type: 'context', oldNo: i + 1, newNo: i + 1, text: `context ${i + 1}` });
      lines.push({ type: 'add', oldNo: null, newNo: i + 1, text: `added ${i + 1}` });
    }
    const compact = buildCompact(document([file('f1', 'a.go', [hunk('f1', 1, lines)])]));

    expect(compact).toContain(` context ${PREVIEW_CHANGED_LINES}`);
    expect(compact).not.toContain(` context ${PREVIEW_CHANGED_LINES + 1}`);
    expect(compact).toContain(`… ${lines.length - PREVIEW_CHANGED_LINES * 2} more lines`);
  });

  it('fences change text that holds backticks with a longer fence', () => {
    const lines: DiffLine[] = [
      { type: 'add', oldNo: null, newNo: 1, text: '```go' },
      { type: 'add', oldNo: null, newNo: 2, text: 'fmt.Println("hi")' },
      { type: 'add', oldNo: null, newNo: 3, text: '```' },
    ];
    const compact = buildCompact(document([file('f1', 'README.md', [hunk('f1', 1, lines)])]));

    expect(compact).toContain('````diff\n+```go');
    expect(compact).toContain('+```\n````');
  });

  it('names the hunk fields the merge rules act on', () => {
    const compact = buildCompact(
      document([
        file('f1', 'api/service/tenant/record.go', [
          hunk('f1', 1, addedLines(3, 'line'), 'func (s *Service) Update() error {'),
        ]),
      ]),
    );

    expect(compact).toContain('## f1.h1');
    expect(compact).toContain('path: api/service/tenant/record.go');
    expect(compact).toContain('symbols: Service.Update');
    expect(compact).toContain('kind: code');
    expect(compact).toContain('floor: medium · score 0.31 · size 0.05 (3 lines)');
  });

  it('leaves the comments section out when the pull request has none', () => {
    const compact = buildCompact(document([file('f1', 'a.go', [hunk('f1', 1, addedLines(1, 'x'))])]));
    expect(body(compact)).not.toContain('## Comments');
  });

  it('reports the comments the analyzer pinned, with their hunk', () => {
    const doc = document([file('f1', 'a.go', [hunk('f1', 1, addedLines(1, 'x'))])]);
    doc.comments = [
      {
        id: 'c1',
        source: { kind: 'bot', name: 'Cursor Bugbot' },
        author: 'cursor[bot]',
        path: 'a.go',
        line: 1,
        side: 'RIGHT',
        hunkId: 'f1.h1',
        body: 'This drops the error.',
        url: 'https://github.com/northwind-labs/tenant-platform/pull/1234#discussion_r1',
        createdAt: AT,
        resolved: false,
        severity: 'high',
      },
    ];
    expect(validateDocument(doc).errors).toEqual([]);

    const compact = buildCompact(doc);
    expect(compact).toContain('## Comments (1)');
    expect(compact).toContain('c1  bot Cursor Bugbot  a.go:1 RIGHT  hunk f1.h1  severity high');
    expect(compact).toContain('This drops the error.');
  });

  it('is a fraction of the diff it replaces', () => {
    const doc = document([
      file('f1', 'a.go', [hunk('f1', 1, addedLines(200, 'a long changed line of code'))]),
      file('f2', 'b.go', [hunk('f2', 1, addedLines(200, 'another long changed line'))]),
    ]);

    expect(Buffer.byteLength(buildCompact(doc))).toBeLessThan(diffBytes(doc));
  });
});

describe('formatBytes', () => {
  it('reads in the unit a person would use', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 kB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
  });
});
