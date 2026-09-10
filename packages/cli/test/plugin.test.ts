import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function readJson(...parts: string[]): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, ...parts), 'utf8')) as Record<string, unknown>;
}

const plugin = readJson('.claude-plugin', 'plugin.json');
const marketplace = readJson('.claude-plugin', 'marketplace.json');
const rootPackage = readJson('package.json');

interface MarketplacePlugin {
  name: string;
  source: string;
  version: string;
  description: string;
  author: { name: string };
}

const entries = marketplace['plugins'] as MarketplacePlugin[];
const entry = entries.find((candidate) => candidate.name === 'cockpit') as MarketplacePlugin;

interface HookEvent {
  matcher?: string;
  hooks: Array<{ type: string; command: string }>;
}

function hookEvents(event: string): HookEvent[] {
  const hooks = readJson('hooks', 'hooks.json');
  return (hooks['hooks'] as Record<string, unknown>)[event] as HookEvent[];
}

function expectRunnable(handler: HookEvent['hooks'][number] | undefined, script: RegExp): void {
  expect(handler?.type).toBe('command');
  const path = handler?.command.replace('${CLAUDE_PLUGIN_ROOT}', repoRoot).replace(/^bash\s+/, '') ?? '';
  expect(path).toMatch(script);
  expect(existsSync(path)).toBe(true);
  expect(statSync(path).mode & 0o111).toBeGreaterThan(0);
}

describe('.claude-plugin/plugin.json', () => {
  it('carries every field the plugin manager shows', () => {
    expect(plugin['name']).toBe('cockpit');
    expect(plugin['version']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(String(plugin['description']).length).toBeGreaterThan(40);
    expect(plugin['author']).toEqual({ name: expect.any(String) });
    expect(plugin['license']).toBe('MIT');
    expect(String(plugin['homepage'])).toMatch(/^https:\/\//);
    expect(String(plugin['repository'])).toMatch(/^https:\/\//);
  });

  it('ships the licence it names', () => {
    expect(readFileSync(join(repoRoot, 'LICENSE'), 'utf8')).toContain('MIT License');
  });
});

describe('.claude-plugin/marketplace.json', () => {
  it('is the marketplace the install command names', () => {
    expect(marketplace['name']).toBe('pr-review-cockpit');
    expect(marketplace['owner']).toEqual(plugin['author']);
    expect(entries).toHaveLength(1);
  });

  it('sources its one plugin from the repository root', () => {
    expect(entry.source).toBe('./');
    expect(existsSync(join(repoRoot, '.claude-plugin', 'plugin.json'))).toBe(true);
  });
});

describe('the plugin version', () => {
  /** claude plugin validate fails a marketplace entry that disagrees with plugin.json. */
  it('is the same in both manifests and in the root package.json', () => {
    expect(plugin['version']).toBe(rootPackage['version']);
    expect(entry.version).toBe(rootPackage['version']);
  });
});

describe('the plugin layout', () => {
  it('holds the skill where Claude Code looks for it', () => {
    expect(existsSync(join(repoRoot, 'skills', 'cockpit', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(repoRoot, 'skills', 'cockpit', 'judgment-prompt.md'))).toBe(true);
  });

  it('puts cockpit on PATH as an executable', () => {
    const wrapper = join(repoRoot, 'bin', 'cockpit');
    expect(existsSync(wrapper)).toBe(true);
    expect(statSync(wrapper).mode & 0o111).toBeGreaterThan(0);
  });

  it('runs a SessionStart hook whose script is there', () => {
    const events = hookEvents('SessionStart');
    expect(events).toHaveLength(1);
    expect(events[0]?.matcher).toContain('startup');
    expectRunnable(events[0]?.hooks[0], /plugin-bootstrap\.sh$/);
  });

  /** No matcher, because every way a session can end leaves the same servers behind. */
  it('runs a SessionEnd hook on every exit reason', () => {
    const events = hookEvents('SessionEnd');
    expect(events).toHaveLength(1);
    expect(events[0]?.matcher).toBeUndefined();
    expectRunnable(events[0]?.hooks[0], /plugin-session-end\.sh$/);
  });
});
