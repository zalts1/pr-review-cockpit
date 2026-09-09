import { readFileSync, readdirSync } from 'node:fs';
import type {
  DraftsFile,
  Hunk,
  Judgment,
  ReviewDocument,
  ReviewFile,
  RiskLevel,
} from '../src/index.js';
import { SCHEMA_VERSION, summaryCounts } from '../src/index.js';

const FIXTURES = new URL('../../../fixtures/', import.meta.url);

export function fixtureNames(): string[] {
  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

export function fixture(name: string): ReviewDocument {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as ReviewDocument;
}

export function makeHunk(id: string, floor: RiskLevel = 'low', start = 10): Hunk {
  return {
    id,
    oldStart: start,
    oldLines: 1,
    newStart: start,
    newLines: 2,
    header: '',
    symbols: [],
    kind: 'code',
    lines: [
      { type: 'context', oldNo: start, newNo: start, text: 'unchanged' },
      { type: 'add', oldNo: null, newNo: start + 1, text: 'added' },
    ],
    risk: {
      floor,
      level: floor,
      score: 0.1,
      mode: floor === 'low' ? 'skim' : 'scrutinize',
      factors: [],
      reason: floor === 'high' ? 'the floor rule fired' : null,
      adjustedBy: null,
    },
  };
}

function makeFile(id: string, path: string, hunks: Hunk[]): ReviewFile {
  return {
    id,
    path,
    previousPath: null,
    status: 'modified',
    language: 'go',
    binary: false,
    generated: { is: false, rule: null },
    additions: hunks.length,
    deletions: 0,
    signals: {
      churnCommits90d: 3,
      bugfixCommits: 1,
      authorPriorCommits: 0,
      fanIn: 4,
      fanOut: 2,
      fanSource: 'grep',
      complexityBefore: 3,
      complexityAfter: 4,
      sensitivePath: { match: false, rule: null },
      testFile: false,
      coverageDelta: null,
    },
    hunks,
  };
}

const NOW = '2026-09-08T12:00:00Z';

/** A document with three hunks, no groups, and stage 2 and 3 still pending. */
export function stage1Document(): ReviewDocument {
  const files = [
    makeFile('f1', 'api/service/record.go', [makeHunk('f1.h1'), makeHunk('f1.h2', 'high', 40)]),
    makeFile('f2', 'api/http/handler.go', [makeHunk('f2.h1')]),
  ];
  const pending = { state: 'pending' as const, updatedAt: NOW };
  const ready = { state: 'ready' as const, updatedAt: NOW };

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: NOW,
    tool: { name: 'review-cockpit', version: '0.1.0' },
    pr: {
      owner: 'northwind-labs',
      repo: 'tenant-platform',
      number: 7,
      url: 'https://github.com/northwind-labs/tenant-platform/pull/7',
      title: 'Add a record API',
      body: '',
      author: 'jdoe',
      draft: false,
      labels: [],
      base: { ref: 'main', sha: 'a'.repeat(40) },
      head: { ref: 'topic', sha: 'd'.repeat(40) },
      additions: 3,
      deletions: 0,
      changedFiles: 2,
    },
    checkout: { mode: 'worktree', path: '/cache/pr-7/worktree' },
    status: {
      files: ready,
      comments: ready,
      checks: ready,
      groups: pending,
      path: pending,
      summary: pending,
      graph: pending,
    },
    files,
    comments: [],
    checks: [],
    groups: [],
    path: [],
    summary: {},
    graph: { nodes: [], edges: [], truncated: false },
  };
}

/** The same document with every section ready: a walk over all three hunks and matching counts. */
export function readyDocument(): ReviewDocument {
  const doc = stage1Document();
  doc.path = [
    { step: 1, ref: { kind: 'hunk', id: 'f1.h1' }, phase: 'models', note: null },
    { step: 2, ref: { kind: 'hunk', id: 'f1.h2' }, phase: 'core', note: 'the risky one' },
    { step: 3, ref: { kind: 'hunk', id: 'f2.h1' }, phase: 'callsites', note: null },
  ];
  doc.summary = { oneLiner: 'Adds a record API.', reviewFocus: [], counts: summaryCounts(doc) };
  for (const section of ['groups', 'path', 'summary', 'graph'] as const) {
    doc.status[section] = { state: 'ready', updatedAt: NOW };
  }
  return doc;
}

export function judgment(over: Partial<Judgment> = {}): Judgment {
  return {
    schemaVersion: SCHEMA_VERSION,
    summary: { oneLiner: 'Adds a record API.', reviewFocus: ['Check the error contract.'] },
    ...over,
  };
}

export function draftsFile(over: Partial<DraftsFile> = {}): DraftsFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    pr: { owner: 'northwind-labs', repo: 'tenant-platform', number: 7 },
    verdict: null,
    summaryBody: '',
    drafts: [
      {
        id: 'd1',
        path: 'api/service/record.go',
        line: 11,
        side: 'RIGHT',
        startLine: null,
        startSide: null,
        body: 'This drops the sentinel.',
        commitId: 'd'.repeat(40),
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    ...over,
  };
}
