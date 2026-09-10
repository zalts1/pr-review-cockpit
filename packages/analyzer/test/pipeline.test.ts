import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { PrInfo } from '@review-cockpit/schema';
import { validateDocument } from '@review-cockpit/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyGraphFan } from '../src/analyze.js';
import { gitOk, run } from '../src/exec.js';
import { buildGoGraph, NEIGHBOUR_CAP } from '../src/graph.js';
import type { Stage1Result } from '../src/stage1.js';
import { analyzeStage1 } from '../src/stage1.js';

const AUTHOR = 'contributor@example.test';

/** Stage 1 fetches comments and checks through gh; this test repository has none. */
const noSignals = (): string => '[]';

/** More callers of one changed function than the neighbour cap, so folding has something to fold. */
const CALLER_COUNT = 45;

const fanoutCallers = `package fanout

import "example.test/app/tenant"

${Array.from({ length: CALLER_COUNT }, (_, i) => `func Check${i}(id string) error {\n\treturn tenant.Validate(id)\n}`).join('\n\n')}
`;

function write(root: string, path: string, content: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function commit(root: string, message: string): string {
  gitOk(root, ['add', '-A']);
  gitOk(root, [
    '-c',
    `user.email=${AUTHOR}`,
    '-c',
    'user.name=A Contributor',
    'commit',
    '--quiet',
    '-m',
    message,
  ]);
  return gitOk(root, ['rev-parse', 'HEAD']).trim();
}

const baseService = `package tenant

import (
	"fmt"

	"example.test/app/store"
)

type Service struct {
	store *store.Store
}

func NewService(s *store.Store) *Service {
	return &Service{store: s}
}

// UpdateRecord writes one record.
func (s *Service) UpdateRecord(id string) (string, error) {
	if id == "" {
		return "", fmt.Errorf("id is required")
	}
	if err := Validate(id); err != nil {
		return "", err
	}
	return s.store.Load(id)
}

func Validate(id string) error {
	if len(id) > 64 {
		return fmt.Errorf("id too long")
	}
	return nil
}
`;

const headService = `package tenant

import (
	"fmt"
	"sync"

	"example.test/app/store"
)

type Service struct {
	store *store.Store
	mu    sync.Mutex
}

func NewService(s *store.Store) *Service {
	return &Service{store: s}
}

// UpdateRecord writes one record and locks while it does.
func (s *Service) UpdateRecord(id string) (string, error) {
	if id == "" {
		return "", fmt.Errorf("id is required")
	}
	if err := Validate(id); err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	value, err := s.store.Load(id)
	if err != nil {
		return "", fmt.Errorf("load %s: %w", id, err)
	}
	if value == "" {
		return "", fmt.Errorf("empty record")
	}
	return value, nil
}

func Validate(id string) error {
	if len(id) > 64 {
		return fmt.Errorf("id too long")
	}
	if id == "-" {
		return fmt.Errorf("id is reserved")
	}
	return nil
}
`;

describe('stage 1 and stage 3 on a synthetic repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'review-cockpit-repo-'));
  const indexDirectory = mkdtempSync(join(tmpdir(), 'review-cockpit-index-'));
  let baseSha = '';
  let headSha = '';
  let stage1: Stage1Result;

  beforeAll(async () => {
    gitOk(root, ['init', '--quiet', '--initial-branch=main']);

    write(root, 'go.mod', 'module example.test/app\n\ngo 1.24\n');
    write(
      root,
      'store/store.go',
      `package store

type Store struct{}

func New() *Store { return &Store{} }

func (s *Store) Load(id string) (string, error) {
	return id, nil
}
`,
    );
    write(root, 'tenant/service.go', baseService);
    write(root, 'fanout/callers.go', fanoutCallers);
    write(
      root,
      'cmd/app/main.go',
      `package main

import (
	"fmt"

	"example.test/app/store"
	"example.test/app/tenant"
)

func main() {
	svc := tenant.NewService(store.New())
	value, err := svc.UpdateRecord("abc")
	if err != nil {
		fmt.Println(err)
		return
	}
	fmt.Println(value)
}
`,
    );
    write(
      root,
      'tenant/service_test.go',
      `package tenant

import "testing"

func TestUpdateRecord(t *testing.T) {
	if testing.Short() {
		t.Skip("short")
	}
	t.Log("one")
	t.Log("two")
	t.Log("three")
	t.Log("four")
}
`,
    );
    write(
      root,
      'api/gen/service.pb.go',
      `package gen

type Record struct {
	Id string
}
`,
    );
    write(root, 'web/src/app.ts', "import { load } from './load';\n\nexport const app = load();\n");
    write(root, 'web/src/load.ts', 'export function load() {\n  return 1;\n}\n');
    baseSha = commit(root, 'base');

    write(root, 'tenant/service.go', headService);
    write(
      root,
      'api/gen/service.pb.go',
      `package gen

type Record struct {
	Id    string
	State int
}
`,
    );
    write(
      root,
      'tenant/service_test.go',
      `package tenant

import (
	"context"
	"testing"
)

func TestUpdateRecord(t *testing.T) {
	_ = context.Background()
	if testing.Short() {
		t.Skip("short")
	}
	t.Log("one")
}
`,
    );
    write(root, 'web/src/load.ts', 'export function load() {\n    return 1;\n}\n');
    headSha = commit(root, 'head');

    stage1 = await analyzeStage1({
      pr: pr(baseSha, headSha),
      checkout: { mode: 'worktree', path: root, sourceRepo: root },
      authorEmails: [AUTHOR],
      gh: noSignals,
    });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(indexDirectory, { recursive: true, force: true });
  });

  function pr(base: string, head: string): PrInfo {
    return {
      owner: 'example-org',
      repo: 'example-repo',
      number: 7,
      url: 'https://github.com/example-org/example-repo/pull/7',
      title: 'Lock the record update',
      body: '',
      author: 'contributor',
      draft: false,
      labels: [],
      base: { ref: 'main', sha: base },
      head: { ref: 'feature', sha: head },
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    };
  }

  it('writes a document that validates', () => {
    const result = validateDocument(stage1.document);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('counts the pull request from the diff it parsed', () => {
    const { document } = stage1;
    expect(document.pr.changedFiles).toBe(document.files.length);
    expect(document.pr.additions).toBe(
      document.files.reduce((total, file) => total + file.additions, 0),
    );
  });

  it('says "not-attached" on stage 2 when no judgment pass is expected', async () => {
    const alone = await analyzeStage1({
      pr: pr(baseSha, headSha),
      checkout: { mode: 'worktree', path: root, sourceRepo: root },
      authorEmails: [AUTHOR],
      gh: noSignals,
    });
    const expected = await analyzeStage1({
      pr: pr(baseSha, headSha),
      checkout: { mode: 'worktree', path: root, sourceRepo: root },
      authorEmails: [AUTHOR],
      gh: noSignals,
      expectJudgment: true,
    });

    for (const section of ['groups', 'path', 'summary'] as const) {
      expect(alone.document.status[section].message).toBe('not-attached');
      expect(expected.document.status[section].message).toBeUndefined();
      expect(expected.document.status[section].state).toBe('pending');
    }
    expect(alone.document.status.graph.message).toBeUndefined();
  });

  it('marks stage 2 pending and stage 1 ready', () => {
    const { status } = stage1.document;
    expect(status.files.state).toBe('ready');
    expect(status.comments.state).toBe('ready');
    expect(status.checks.state).toBe('ready');
    expect(status.groups.state).toBe('pending');
    expect(status.path.state).toBe('pending');
    expect(status.summary.state).toBe('pending');
    expect(status.graph.state).toBe('pending');
    expect(stage1.document.comments).toEqual([]);
    expect(stage1.document.checks).toEqual([]);
  });

  it('folds the generated file by its rule', () => {
    const generated = stage1.document.files.find((file) => file.path === 'api/gen/service.pb.go');
    expect(generated?.generated).toEqual({ is: true, rule: '**/*.pb.go' });
    expect(generated?.hunks[0]?.risk.floor).toBe('low');
    expect(generated?.hunks[0]?.risk.mode).toBe('skim');
  });

  it('names the enclosing method and measures its complexity growth', () => {
    const service = stage1.document.files.find((file) => file.path === 'tenant/service.go');
    const bodyHunk = service?.hunks.find((hunk) => hunk.symbols.includes('Service.UpdateRecord'));
    expect(bodyHunk).toBeDefined();
    expect(service?.signals.complexityAfter ?? 0).toBeGreaterThan(
      service?.signals.complexityBefore ?? 0,
    );
    expect(service?.language).toBe('go');
  });

  it('sees the hazards and the error path in the locked method', () => {
    const service = stage1.document.files.find((file) => file.path === 'tenant/service.go');
    const hunk = service?.hunks.find((entry) => entry.symbols.includes('Service.UpdateRecord'));
    const factors = (hunk?.risk.factors ?? []).map((factor) => factor.signal);
    expect(hunk?.kind).toBe('code');
    expect(factors.length).toBeGreaterThan(0);
    expect(hunk?.risk.score).toBeGreaterThan(0);
  });

  it('estimates fan-in with git grep and says so', () => {
    const service = stage1.document.files.find((file) => file.path === 'tenant/service.go');
    expect(service?.signals.fanSource).toBe('grep');
    expect(service?.signals.fanIn ?? 0).toBeGreaterThan(0);
    expect(service?.signals.fanOut).toBeNull();
  });

  it('leaves the fan unknown where nothing was counted', () => {
    const generated = stage1.document.files.find((file) => file.path === 'api/gen/service.pb.go');
    expect(generated?.signals.fanIn).toBeNull();
    expect(generated?.signals.fanOut).toBeNull();
    expect(generated?.signals.fanSource).toBeNull();
  });

  it('marks a test file as one and reads nothing in it as public surface', () => {
    const test = stage1.document.files.find((file) => file.path === 'tenant/service_test.go');
    expect(test?.signals.testFile).toBe(true);
    expect(test?.hunks.some((hunk) => hunk.kind === 'test')).toBe(true);
    for (const hunk of test?.hunks ?? []) {
      expect(hunk.risk.factors.map((factor) => factor.signal)).not.toContain(
        'touchesPublicSurface',
      );
    }
  });

  it('reads the git history of every changed path', () => {
    const service = stage1.document.files.find((file) => file.path === 'tenant/service.go');
    expect(service?.signals.churnCommits90d).toBe(1);
    expect(service?.signals.authorPriorCommits).toBe(1);
    expect(service?.signals.bugfixCommits).toBe(0);
  });

  it('classifies the whitespace-only change as such and floors it low', () => {
    const load = stage1.document.files.find((file) => file.path === 'web/src/load.ts');
    expect(load?.hunks[0]?.kind).toBe('whitespace-only');
    expect(load?.hunks[0]?.risk.floor).toBe('low');
  });

  it('groups the generated and whitespace hunks in stage 1, and only those', () => {
    const groups = stage1.document.groups;
    expect(groups.map((group) => group.kind).sort()).toEqual(['generated', 'whitespace']);
    for (const group of groups) {
      expect(group.producedBy).toBe('stage1');
      expect(group.mode).toBe('skim');
      expect(group.collapsedByDefault).toBe(true);
      expect(group.hunkIds.length).toBeGreaterThan(0);
    }
  });

  it('never puts a high-floor hunk in a skim group', () => {
    const floors = new Map(
      stage1.document.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk.risk.floor])),
    );
    for (const group of stage1.document.groups) {
      for (const hunkId of group.hunkIds) expect(floors.get(hunkId)).not.toBe('high');
    }
  });

  describe('the call graph', () => {
    it('resolves the callers of a changed method and caches the index', async () => {
      const cold = await buildGoGraph({
        worktree: root,
        headSha,
        files: stage1.document.files,
        indexDirectory,
      });

      expect(cold.stats.parsed).toBeGreaterThan(0);
      expect(cold.stats.reused).toBe(0);

      const labels = cold.graph.nodes.map((node) => node.label);
      expect(labels).toContain('Service.UpdateRecord');
      expect(labels).toContain('main');
      expect(labels).toContain('tenant');

      const updateRecord = cold.graph.nodes.find((node) => node.label === 'Service.UpdateRecord');
      const main = cold.graph.nodes.find((node) => node.label === 'main');
      expect(updateRecord?.changed).toBe(true);
      expect(updateRecord?.hunkIds.length).toBeGreaterThan(0);
      expect(main?.changed).toBe(false);
      expect(main?.hunkIds).toEqual([]);
      expect(cold.graph.edges).toEqual(
        expect.arrayContaining([{ from: main?.id, to: updateRecord?.id, kind: 'calls' }]),
      );

      const fan = cold.fanByFile.get('tenant/service.go');
      expect(fan?.fanIn).toBeGreaterThan(0);
      expect(fan?.fanOut).toBeGreaterThan(0);

      const warm = await buildGoGraph({
        worktree: root,
        headSha,
        files: stage1.document.files,
        indexDirectory,
      });
      expect(warm.stats.parsed).toBe(0);
      expect(warm.stats.reused).toBe(cold.stats.reused + cold.stats.parsed);
      expect(warm.graph.nodes.length).toBe(cold.graph.nodes.length);
    });

    it('leaves generated files out of the graph', async () => {
      expect(stage1.document.files.map((file) => file.path)).toContain('api/gen/service.pb.go');
      const result = await buildGoGraph({
        worktree: root,
        headSha,
        files: stage1.document.files,
        indexDirectory,
      });
      expect(result.graph.nodes.some((node) => node.file === 'api/gen/service.pb.go')).toBe(false);
      expect(result.graph.nodes.some((node) => node.label === 'api/gen')).toBe(false);
    });

    it('emits one package node per package that has a node, and counts its changed functions', async () => {
      const result = await buildGoGraph({
        worktree: root,
        headSha,
        files: stage1.document.files,
        indexDirectory,
      });

      const packages = result.graph.nodes.filter((node) => node.kind === 'package');
      const labels = packages.map((node) => node.label).sort();
      expect(labels).toEqual(['cmd/app', 'fanout', 'tenant']);

      const withNodes = new Set(
        result.graph.nodes
          .filter((node) => node.kind !== 'package' && node.file !== null)
          .map((node) => (node.file as string).split('/').slice(0, -1).join('/')),
      );
      for (const directory of withNodes) expect(labels).toContain(directory);

      const tenant = packages.find((node) => node.label === 'tenant');
      const changedInTenant = result.graph.nodes.filter(
        (node) => node.kind === 'function' && node.changed && node.file?.startsWith('tenant/'),
      );
      expect(tenant?.count?.changedFunctions).toBe(changedInTenant.length);
      expect(changedInTenant.map((node) => node.label)).toContain('Service.UpdateRecord');
      expect(tenant?.changed).toBe(true);
      expect(packages.find((node) => node.label === 'fanout')?.count).toEqual({
        changedFunctions: 0,
        foldedNeighbours: 0,
      });
    });

    it('folds the neighbours past the cap instead of dropping them', async () => {
      const neighboursOf = (graph: Awaited<ReturnType<typeof buildGoGraph>>['graph']): number =>
        graph.nodes.filter((node) => node.kind === 'function' && !node.changed).length;

      const whole = await buildGoGraph({
        worktree: root,
        headSha,
        files: stage1.document.files,
        indexDirectory,
        neighbourCap: CALLER_COUNT * 2,
      });
      const capped = await buildGoGraph({
        worktree: root,
        headSha,
        files: stage1.document.files,
        indexDirectory,
      });

      expect(neighboursOf(whole.graph)).toBeGreaterThan(CALLER_COUNT);
      expect(neighboursOf(capped.graph)).toBe(NEIGHBOUR_CAP);
      const folded = capped.graph.nodes
        .filter((node) => node.kind === 'package')
        .reduce((total, node) => total + (node.count?.foldedNeighbours ?? 0), 0);
      expect(neighboursOf(capped.graph) + folded).toBe(neighboursOf(whole.graph));
      expect(capped.graph.truncated).toBe(true);

      const changed = capped.graph.nodes.filter(
        (node) => node.changed && node.kind === 'function',
      );
      expect(changed.map((node) => node.label)).toEqual(
        whole.graph.nodes
          .filter((node) => node.changed && node.kind === 'function')
          .map((node) => node.label),
      );
      expect(changed.map((node) => node.label)).toContain('Validate');
    });

    it('folds nothing, and says so, when every neighbour fits', async () => {
      const roomy = await buildGoGraph({
        worktree: root,
        headSha,
        files: stage1.document.files,
        indexDirectory,
        neighbourCap: CALLER_COUNT + 10,
      });
      expect(roomy.graph.truncated).toBe(false);
      for (const node of roomy.graph.nodes) {
        if (node.kind === 'package') expect(node.count?.foldedNeighbours).toBe(0);
      }
    });

    it('raises risk from the graph but never lowers it, and still validates', async () => {
      const graph = await buildGoGraph({
        worktree: root,
        headSha,
        files: stage1.document.files,
        indexDirectory,
      });
      const before = stage1.document.files.flatMap((file) =>
        file.hunks.map((hunk) => [hunk.id, hunk.risk.floor] as const),
      );
      applyGraphFan(stage1.document, graph.fanByFile, stage1.featuresByHunk);

      const rank = { low: 0, medium: 1, high: 2 };
      for (const [id, floor] of before) {
        const now = stage1.document.files
          .flatMap((file) => file.hunks)
          .find((hunk) => hunk.id === id);
        expect(rank[now?.risk.floor ?? 'low']).toBeGreaterThanOrEqual(rank[floor]);
      }

      const service = stage1.document.files.find((file) => file.path === 'tenant/service.go');
      expect(service?.signals.fanSource).toBe('graph');
      expect(validateDocument(stage1.document).errors).toEqual([]);
    });
  });

  it('leaves the repository as it found it', () => {
    expect(run('git', ['-C', root, 'status', '--porcelain']).stdout).toBe('');
  });
});
