import { existsSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFile, readUserConfig, run } from '@review-cockpit/analyzer';
import { resolveUiHtmlPath } from '@review-cockpit/server';
import { findPromptTemplate } from '../prompt.js';

/** The engines field of every package in the workspace. */
const MIN_NODE_MAJOR = 24;

export type CheckState = 'ok' | 'warn' | 'fail';

export interface DoctorRow {
  check: string;
  state: CheckState;
  detail: string;
}

export interface PluginFacts {
  root: string;
  skillPath: string;
  skillExists: boolean;
}

export interface LinkFacts {
  path: string;
  kind: 'symlink' | 'directory' | 'absent';
  /** What the symlink points at, resolved. */
  target: string | null;
}

/** Every fact the table is derived from, so a test states them instead of staging a machine. */
export interface DoctorFacts {
  nodeVersion: string;
  gh: { code: number; output: string };
  uiHtml: string | null;
  cliEntry: string | null;
  skillSource: string | null;
  skillLink: LinkFacts;
  /** Null unless this process was started by Claude Code with the plugin enabled. */
  plugin: PluginFacts | null;
  configFile: { path: string; exists: boolean };
  workspaceRoots: Array<{ path: string; exists: boolean }>;
}

export function skillLinkPath(): string {
  return join(homedir(), '.claude', 'skills', 'cockpit');
}

export function readLinkFacts(path: string): LinkFacts {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return { path, kind: 'absent', target: null };
  }
  if (!stat.isSymbolicLink()) return { path, kind: 'directory', target: null };
  const raw = readlinkSync(path);
  const absolute = resolve(dirname(path), raw);
  return { path, kind: 'symlink', target: existsSync(absolute) ? realpathSync(absolute) : absolute };
}

function pluginFacts(root: string): PluginFacts {
  const skillPath = join(root, 'skills', 'cockpit');
  return { root, skillPath, skillExists: existsSync(join(skillPath, 'SKILL.md')) };
}

function skillSource(): string | null {
  try {
    return dirname(findPromptTemplate());
  } catch {
    return null;
  }
}

export function readFacts(): DoctorFacts {
  const ghStatus = run('gh', ['auth', 'status']);
  const ui = resolveUiHtmlPath();
  const cli = fileURLToPath(new URL('../cockpit.js', import.meta.url));
  const config = configFile();
  const roots = existsSync(config) ? readUserConfig().workspaceRoots : [];
  const pluginRoot = process.env['CLAUDE_PLUGIN_ROOT'];

  return {
    nodeVersion: process.version,
    gh: { code: ghStatus.code, output: `${ghStatus.stdout}\n${ghStatus.stderr}` },
    uiHtml: ui !== null && existsSync(ui) ? ui : null,
    cliEntry: existsSync(cli) ? cli : null,
    skillSource: skillSource(),
    skillLink: readLinkFacts(skillLinkPath()),
    plugin: pluginRoot === undefined || pluginRoot === '' ? null : pluginFacts(pluginRoot),
    configFile: { path: config, exists: existsSync(config) },
    workspaceRoots: roots.map((path) => ({ path, exists: existsSync(path) })),
  };
}

function nodeRow(version: string): DoctorRow {
  const major = Number(/^v(\d+)/.exec(version)?.[1] ?? 0);
  return major >= MIN_NODE_MAJOR
    ? { check: 'node', state: 'ok', detail: version }
    : {
        check: 'node',
        state: 'fail',
        detail: `${version}: the cockpit needs node ${MIN_NODE_MAJOR} or newer. See .nvmrc`,
      };
}

function ghRow(gh: DoctorFacts['gh']): DoctorRow {
  const lines = gh.output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('To get started'));
  const first = lines.find((line) => /logged in/i.test(line)) ?? lines[0];

  if (gh.code === 127 || /not (?:on PATH|found)|ENOENT/i.test(gh.output)) {
    return { check: 'gh', state: 'fail', detail: 'not on PATH. Install the GitHub CLI: https://cli.github.com' };
  }
  if (gh.code !== 0) {
    return { check: 'gh', state: 'fail', detail: `not authenticated (${first ?? 'gh auth status failed'}). Run: gh auth login` };
  }
  return { check: 'gh', state: 'ok', detail: first ?? 'authenticated' };
}

function buildRow(facts: DoctorFacts): DoctorRow {
  const missing = [
    facts.cliEntry === null ? 'the cli (packages/cli/dist)' : null,
    facts.uiHtml === null ? 'the cockpit page (packages/cockpit/dist/index.html)' : null,
  ].filter((part): part is string => part !== null);

  if (missing.length > 0) {
    return { check: 'build', state: 'fail', detail: `${missing.join(' and ')} is missing. Run: npm run build` };
  }
  return { check: 'build', state: 'ok', detail: facts.uiHtml ?? '' };
}

function pluginRow(plugin: PluginFacts): DoctorRow {
  if (!plugin.skillExists) {
    return {
      check: 'plugin root',
      state: 'warn',
      detail: `${plugin.root} holds no ${join('skills', 'cockpit', 'SKILL.md')}, so it is not a cockpit plugin install`,
    };
  }
  return { check: 'plugin root', state: 'ok', detail: plugin.root };
}

function skillRow(facts: DoctorFacts): DoctorRow {
  if (facts.plugin?.skillExists === true) {
    return { check: 'skill', state: 'ok', detail: `${facts.plugin.skillPath}, loaded by the plugin` };
  }

  const link = facts.skillLink;
  if (link.kind === 'absent') {
    return { check: 'skill', state: 'fail', detail: `${link.path} is missing. Run: scripts/install.sh` };
  }
  if (link.kind === 'directory') {
    return {
      check: 'skill',
      state: 'warn',
      detail: `${link.path} is a directory of its own, not a link to this checkout. It will not follow your edits`,
    };
  }
  if (facts.skillSource !== null && link.target !== facts.skillSource) {
    return {
      check: 'skill',
      state: 'warn',
      detail: `${link.path} points at ${link.target}, not at ${facts.skillSource}`,
    };
  }
  return { check: 'skill', state: 'ok', detail: `${link.path} → ${link.target ?? ''}` };
}

function configRow(facts: DoctorFacts): DoctorRow {
  return facts.configFile.exists
    ? { check: 'config', state: 'ok', detail: facts.configFile.path }
    : { check: 'config', state: 'ok', detail: `${facts.configFile.path} is absent, which is fine: it is optional` };
}

function rootsRow(facts: DoctorFacts): DoctorRow {
  if (facts.workspaceRoots.length === 0) {
    return {
      check: 'workspace roots',
      state: 'ok',
      detail: 'none configured: a repository with no local clone is cloned into the cache',
    };
  }
  const gone = facts.workspaceRoots.filter((root) => !root.exists).map((root) => root.path);
  if (gone.length > 0) {
    return {
      check: 'workspace roots',
      state: 'warn',
      detail: `${gone.join(', ')} does not exist, so no clone is found under it`,
    };
  }
  return {
    check: 'workspace roots',
    state: 'ok',
    detail: facts.workspaceRoots.map((root) => root.path).join(', '),
  };
}

export function doctorRows(facts: DoctorFacts): DoctorRow[] {
  return [
    nodeRow(facts.nodeVersion),
    ghRow(facts.gh),
    buildRow(facts),
    ...(facts.plugin === null ? [] : [pluginRow(facts.plugin)]),
    skillRow(facts),
    configRow(facts),
    rootsRow(facts),
  ];
}

export function renderTable(rows: readonly DoctorRow[]): string {
  const width = Math.max('check'.length, ...rows.map((row) => row.check.length));
  const lines = [`${'check'.padEnd(width)}  status  detail`];
  for (const row of rows) {
    lines.push(`${row.check.padEnd(width)}  ${row.state.padEnd(6)}  ${row.detail}`);
  }
  return lines.join('\n');
}

export function doctorCommand(facts: DoctorFacts = readFacts()): number {
  const rows = doctorRows(facts);
  console.log(renderTable(rows));

  const failed = rows.filter((row) => row.state === 'fail');
  if (failed.length === 0) return 0;
  console.error(
    `\n${failed.length} check${failed.length === 1 ? '' : 's'} must be fixed before a review will run: ${failed
      .map((row) => row.check)
      .join(', ')}`,
  );
  return 1;
}
