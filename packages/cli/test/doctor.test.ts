import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DoctorFacts, DoctorRow } from '../src/commands/doctor.js';
import { doctorCommand, doctorRows, renderTable } from '../src/commands/doctor.js';

const healthy: DoctorFacts = {
  nodeVersion: 'v24.4.0',
  gh: { code: 0, output: 'github.com\n  ✓ Logged in to github.com account octocat\n' },
  uiHtml: '/checkout/packages/cockpit/dist/index.html',
  cliEntry: '/checkout/packages/cli/dist/cockpit.js',
  skillSource: '/checkout/skills/cockpit',
  skillLink: { path: '/home/me/.claude/skills/cockpit', kind: 'symlink', target: '/checkout/skills/cockpit' },
  plugin: null,
  configFile: { path: '/home/me/.config/review-cockpit/config.json', exists: true },
  workspaceRoots: [{ path: '/home/me/workspace', exists: true }],
  servers: { live: 0, stale: 0 },
};

function stateOf(rows: DoctorRow[], check: string): string {
  return rows.find((row) => row.check === check)?.state ?? 'missing';
}

function detailOf(rows: DoctorRow[], check: string): string {
  return rows.find((row) => row.check === check)?.detail ?? '';
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cockpit doctor', () => {
  it('counts the servers that are running, and the server.json files that outlived one', () => {
    expect(detailOf(doctorRows(healthy), 'servers')).toContain('none running');

    const busy = doctorRows({ ...healthy, servers: { live: 2, stale: 1 } });
    expect(stateOf(busy, 'servers')).toBe('ok');
    expect(detailOf(busy, 'servers')).toContain('2 running');
    expect(detailOf(busy, 'servers')).toContain('cockpit stop --all');
  });

  it('passes every check on a healthy installation', () => {
    const rows = doctorRows(healthy);
    expect(rows.map((row) => row.check)).toEqual([
      'node',
      'gh',
      'build',
      'skill',
      'servers',
      'config',
      'workspace roots',
    ]);
    expect(rows.every((row) => row.state === 'ok')).toBe(true);
  });

  it('fails an old node with the version it found', () => {
    const rows = doctorRows({ ...healthy, nodeVersion: 'v20.11.0' });
    expect(stateOf(rows, 'node')).toBe('fail');
    expect(detailOf(rows, 'node')).toContain('v20.11.0');
  });

  it('names the command to run when gh is missing or logged out', () => {
    const absent = doctorRows({ ...healthy, gh: { code: 127, output: 'gh is not on PATH.' } });
    expect(detailOf(absent, 'gh')).toContain('cli.github.com');

    const loggedOut = doctorRows({
      ...healthy,
      gh: { code: 1, output: 'You are not logged into any GitHub hosts.' },
    });
    expect(stateOf(loggedOut, 'gh')).toBe('fail');
    expect(detailOf(loggedOut, 'gh')).toContain('gh auth login');
  });

  it('fails an unbuilt checkout and names what is missing', () => {
    const rows = doctorRows({ ...healthy, uiHtml: null });
    expect(stateOf(rows, 'build')).toBe('fail');
    expect(detailOf(rows, 'build')).toContain('npm run build');
  });

  it('fails an absent skill link and warns about one pointing elsewhere', () => {
    const absent = doctorRows({
      ...healthy,
      skillLink: { path: '/home/me/.claude/skills/cockpit', kind: 'absent', target: null },
    });
    expect(stateOf(absent, 'skill')).toBe('fail');
    expect(detailOf(absent, 'skill')).toContain('scripts/install.sh');

    const elsewhere = doctorRows({
      ...healthy,
      skillLink: { path: '/home/me/.claude/skills/cockpit', kind: 'symlink', target: '/other/skills/cockpit' },
    });
    expect(stateOf(elsewhere, 'skill')).toBe('warn');

    const copied = doctorRows({
      ...healthy,
      skillLink: { path: '/home/me/.claude/skills/cockpit', kind: 'directory', target: null },
    });
    expect(stateOf(copied, 'skill')).toBe('warn');
  });

  it('reports the plugin root only when the session set one', () => {
    const installed = doctorRows({
      ...healthy,
      plugin: { root: '/plugins/cockpit', skillPath: '/plugins/cockpit/skills/cockpit', skillExists: true },
    });
    expect(installed.map((row) => row.check)).toEqual([
      'node',
      'gh',
      'build',
      'plugin root',
      'skill',
      'servers',
      'config',
      'workspace roots',
    ]);
    expect(stateOf(installed, 'plugin root')).toBe('ok');
    expect(detailOf(installed, 'plugin root')).toBe('/plugins/cockpit');
    expect(doctorRows(healthy).map((row) => row.check)).not.toContain('plugin root');
  });

  it('accepts the plugin install as the skill, whatever the symlink says', () => {
    const rows = doctorRows({
      ...healthy,
      skillLink: { path: '/home/me/.claude/skills/cockpit', kind: 'absent', target: null },
      plugin: { root: '/plugins/cockpit', skillPath: '/plugins/cockpit/skills/cockpit', skillExists: true },
    });
    expect(stateOf(rows, 'skill')).toBe('ok');
    expect(detailOf(rows, 'skill')).toContain('/plugins/cockpit/skills/cockpit');
  });

  it('warns when the plugin root holds no skill, and falls back to the symlink', () => {
    const rows = doctorRows({
      ...healthy,
      plugin: { root: '/plugins/other', skillPath: '/plugins/other/skills/cockpit', skillExists: false },
    });
    expect(stateOf(rows, 'plugin root')).toBe('warn');
    expect(detailOf(rows, 'plugin root')).toContain('/plugins/other');
    expect(detailOf(rows, 'skill')).toContain('/home/me/.claude/skills/cockpit');
  });

  it('treats an absent config as fine and a missing workspace root as a warning', () => {
    const rows = doctorRows({
      ...healthy,
      configFile: { path: '/home/me/.config/review-cockpit/config.json', exists: false },
      workspaceRoots: [{ path: '/home/me/gone', exists: false }],
    });
    expect(stateOf(rows, 'config')).toBe('ok');
    expect(stateOf(rows, 'workspace roots')).toBe('warn');
    expect(detailOf(rows, 'workspace roots')).toContain('/home/me/gone');
  });

  it('prints one aligned row per check and exits non-zero on a hard failure', () => {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => out.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => err.push(args.join(' ')));

    expect(doctorCommand(healthy)).toBe(0);
    const lines = out.join('\n').split('\n');
    expect(lines[0]).toMatch(/^check\s+status\s+detail$/);
    expect(lines).toHaveLength(8);
    expect(lines[1]).toContain('ok');

    out.length = 0;
    expect(doctorCommand({ ...healthy, uiHtml: null })).toBe(1);
    expect(err.join('\n')).toContain('build');
  });

  it('aligns the check column to the longest name', () => {
    const table = renderTable([
      { check: 'gh', state: 'ok', detail: 'authenticated' },
      { check: 'workspace roots', state: 'warn', detail: 'one is gone' },
    ]);
    const [, first, second] = table.split('\n');
    expect(first?.indexOf('ok')).toBe(second?.indexOf('warn'));
  });
});
