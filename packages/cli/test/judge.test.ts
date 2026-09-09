import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReviewDocument } from '@review-cockpit/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compactCommand } from '../src/commands/compact.js';
import { judgeMergeCommand } from '../src/commands/judgeMerge.js';
import { judgePromptCommand } from '../src/commands/judgePrompt.js';
import { buildPrompt, findPromptTemplate, renderPrompt } from '../src/prompt.js';

const PR = 'northwind-labs/tenant-platform#1234';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixtures = join(repoRoot, 'fixtures');

let cache: string;
let prDir: string;
let out: string[];
let err: string[];

function fixture(name: string): ReviewDocument {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as ReviewDocument;
}

function merged(): ReviewDocument {
  return JSON.parse(readFileSync(join(prDir, 'review.json'), 'utf8')) as ReviewDocument;
}

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), 'cockpit-judge-'));
  process.env['REVIEW_COCKPIT_CACHE'] = cache;
  prDir = join(cache, 'northwind-labs', 'tenant-platform', 'pr-1234');
  mkdirSync(prDir, { recursive: true });
  copyFileSync(join(fixtures, 'pr-fake-1.stage1.json'), join(prDir, 'review.json'));

  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args) => err.push(args.join(' ')));
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['REVIEW_COCKPIT_CACHE'];
  rmSync(cache, { recursive: true, force: true });
});

function writeJudgment(value: unknown): void {
  writeFileSync(join(prDir, 'judgment.json'), `${JSON.stringify(value, null, 2)}\n`);
}

function goodJudgment(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixtures, 'judgment', 'pr-fake-1.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('cockpit judge-prompt', () => {
  it('fills every placeholder', () => {
    expect(judgePromptCommand(PR, repoRoot)).toBe(0);
    const prompt = out.join('');

    expect(prompt.match(/\{\{\w+\}\}/g)).toBeNull();
  });

  it('does not treat a placeholder inside the diff as one of its own', () => {
    const template = 'checkout {{checkoutPath}}\ncompact:\n{{compact}}\n';
    const document = fixture('pr-fake-1.stage1.json');
    document.pr.body = 'A body with {{checkoutPath}} in it.';

    const filled = buildPrompt(
      document,
      { documentPath: 'review.json', judgmentPath: 'judgment.json' },
      template,
    );

    expect(filled).toContain('A body with {{checkoutPath}} in it.');
  });

  it('embeds the judgment schema', () => {
    judgePromptCommand(PR, repoRoot);
    const prompt = out.join('');

    expect(prompt).toContain('"$id": "urn:review-cockpit:schema:judgment:1"');
    expect(prompt).toContain('"JudgmentRiskAdjustment"');
    expect(prompt).toContain('"riskAdjustments"');
  });

  it('names the pull request, the checkout, the output file and the next command', () => {
    judgePromptCommand(PR, repoRoot);
    const prompt = out.join('');

    expect(prompt).toContain('# Judgment pass for northwind-labs/tenant-platform#1234');
    expect(prompt).toContain(fixture('pr-fake-1.stage1.json').checkout.path);
    expect(prompt).toContain(join(prDir, 'judgment.json'));
    expect(prompt).toContain('cockpit judge-merge northwind-labs/tenant-platform#1234');
  });

  it('lists the high-floor hunks and the stage 1 groups the model may name', () => {
    judgePromptCommand(PR, repoRoot);
    const prompt = out.join('');

    expect(prompt).toContain('`f13.h1` — db/migrations/0042_tenant_profile_region.sql');
    expect(prompt).toContain('`g1` — generated, skim');
  });

  it('inlines the compact view at the end', () => {
    judgePromptCommand(PR, repoRoot);
    const prompt = out.join('');

    expect(prompt).toContain('## The compact view');
    expect(prompt.indexOf('# Compact view — northwind-labs/tenant-platform#1234')).toBeGreaterThan(
      prompt.indexOf('## The schema your file must match'),
    );
  });

  it('refuses when the pull request was never analyzed', () => {
    rmSync(join(prDir, 'review.json'));
    expect(judgePromptCommand(PR, repoRoot)).toBe(1);
    expect(err.join('\n')).toContain('Run cockpit analyze');
  });
});

describe('renderPrompt', () => {
  it('refuses a template asking for a value the CLI does not have', () => {
    expect(() => renderPrompt('a {{nothing}} b', { pr: 'x' })).toThrow(/does not have: nothing/);
  });

  it('finds the template that ships with the repository', () => {
    expect(readFileSync(findPromptTemplate(), 'utf8')).toContain('# Judgment pass for {{pr}}');
  });
});

describe('cockpit compact', () => {
  it('writes compact.md next to the document and reports both sizes', () => {
    expect(compactCommand(PR, repoRoot)).toBe(0);

    const compact = readFileSync(join(prDir, 'compact.md'), 'utf8');
    expect(compact.startsWith('# Compact view — northwind-labs/tenant-platform#1234')).toBe(true);
    expect(out).toEqual([join(prDir, 'compact.md')]);
    expect(err.join('\n')).toMatch(/\[compact\] .* against .* of diff in the document/);
  });
});

describe('cockpit judge-merge', () => {
  it('turns the stage 1 document into the ready one', () => {
    writeJudgment(goodJudgment());

    expect(judgeMergeCommand(PR, { cwd: repoRoot })).toBe(0);

    const ready = fixture('pr-fake-1.json');
    const document = merged();
    expect(document.groups).toEqual(ready.groups);
    expect(document.path).toEqual(ready.path);
    expect({ ...document.summary, counts: null }).toEqual({ ...ready.summary, counts: null });
    expect(document.files).toEqual(ready.files);
  });

  it('sets groups, path and summary to ready', () => {
    writeJudgment(goodJudgment());
    judgeMergeCommand(PR, { cwd: repoRoot });

    const { status } = merged();
    expect([status.groups.state, status.path.state, status.summary.state]).toEqual([
      'ready',
      'ready',
      'ready',
    ]);
    expect(status.groups.message).toBeUndefined();
  });

  it('prints the merge log and appends it to log.txt', () => {
    writeJudgment(goodJudgment());
    judgeMergeCommand(PR, { cwd: repoRoot });

    expect(err.join('\n')).toContain('path-hunk-in-group f1.h1: walked as group g2, which holds it');
    const log = readFileSync(join(prDir, 'log.txt'), 'utf8');
    expect(log).toContain('judge-merge northwind-labs/tenant-platform#1234: 1 entry');
    expect(log).toContain('path-hunk-in-group f1.h1: walked as group g2, which holds it');
  });

  it('reads the judgment from --judgment and leaves that file where it is', () => {
    const elsewhere = join(cache, 'elsewhere.json');
    writeFileSync(elsewhere, `${JSON.stringify(goodJudgment(), null, 2)}\n`);

    expect(judgeMergeCommand(PR, { cwd: repoRoot, judgment: elsewhere })).toBe(0);
    expect(existsSync(elsewhere)).toBe(true);
    expect(merged().status.summary.state).toBe('ready');
  });

  it('rejects a judgment that breaks the schema, keeps it and changes nothing', () => {
    const broken = goodJudgment();
    delete broken['summary'];
    writeJudgment(broken);

    expect(judgeMergeCommand(PR, { cwd: repoRoot })).toBe(1);

    expect(existsSync(join(prDir, 'judgment.rejected.json'))).toBe(true);
    expect(existsSync(join(prDir, 'judgment.json'))).toBe(false);
    expect(merged().status.summary.state).toBe('pending');

    const printed = err.join('\n');
    expect(printed).toContain('was rejected');
    expect(printed).toContain('judgment.rejected.json');
    expect(printed).toContain('cockpit judge-merge northwind-labs/tenant-platform#1234');
  });

  it('rejects a file that is not JSON', () => {
    writeFileSync(join(prDir, 'judgment.json'), '{ "schemaVersion": "1.0.0",\n');

    expect(judgeMergeCommand(PR, { cwd: repoRoot })).toBe(1);
    expect(err.join('\n')).toContain('is not valid JSON');
    expect(existsSync(join(prDir, 'judgment.rejected.json'))).toBe(true);
  });

  it('prints at most five errors and counts the rest', () => {
    const broken = goodJudgment();
    broken['riskAdjustments'] = Array.from({ length: 7 }, (_, i) => ({
      hunkId: `nope${i}`,
      level: 'nonsense',
      why: '',
    }));
    writeJudgment(broken);

    expect(judgeMergeCommand(PR, { cwd: repoRoot })).toBe(1);
    const printed = err.join('\n');
    expect(printed).toMatch(/and \d+ more/);
  });

  it('says what to do when there is no judgment file yet', () => {
    expect(judgeMergeCommand(PR, { cwd: repoRoot })).toBe(1);
    expect(err.join('\n')).toContain('cockpit judge-prompt');
  });
});
