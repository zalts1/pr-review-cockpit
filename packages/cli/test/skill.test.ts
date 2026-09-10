import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SUBCOMMANDS, usage } from '../src/usage.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const skill = readFileSync(join(repoRoot, 'skill', 'cockpit', 'SKILL.md'), 'utf8');

interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

/**
 * The frontmatter is what Claude Code reads to decide whether the skill applies, so the test
 * parses it the way that loader does: three dashes, `key: value` lines, three dashes.
 */
function frontmatter(text: string): Frontmatter {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (match === null) throw new Error('SKILL.md has no frontmatter block');

  const fields: Record<string, string> = {};
  let key: string | null = null;
  for (const line of (match[1] as string).split('\n')) {
    const start = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(line);
    if (start !== null) {
      key = start[1] as string;
      fields[key] = (start[2] as string).replace(/^>-?\s*$/, '').trim();
      continue;
    }
    if (key === null) throw new Error(`frontmatter line belongs to no key: "${line}"`);
    fields[key] = `${fields[key]} ${line.trim()}`.trim();
  }
  return { fields, body: match[2] as string };
}

/** Every command the skill tells the session to run: inline code and fenced blocks alike. */
function commandLines(text: string): string[] {
  const lines: string[] = [];
  for (const [, inline] of text.matchAll(/`([^`\n]+)`/g)) {
    lines.push(inline as string);
  }
  for (const [, block] of text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
    lines.push(...(block as string).split('\n'));
  }
  return lines.map((line) => line.trim()).filter((line) => line.startsWith('cockpit '));
}

describe('skill/cockpit/SKILL.md', () => {
  it('carries frontmatter Claude Code can load', () => {
    const { fields } = frontmatter(skill);
    expect(fields['name']).toBe('cockpit');
    expect(fields['description']?.length).toBeGreaterThan(40);
  });

  it('triggers on the cockpit being named, and says a bare review request is not it', () => {
    const description = frontmatter(skill).fields['description'] ?? '';
    expect(description).toContain('cockpit 123');
    expect(description).toContain('open the cockpit for');
    expect(description).toContain('in the cockpit');
    expect(description).toContain('URL');
    expect(description).toMatch(/bare "review this PR"/);
  });

  it('names only subcommands the CLI has', () => {
    const commands = commandLines(skill);
    expect(commands.length).toBeGreaterThan(4);

    for (const line of commands) {
      const [, subcommand] = line.split(/\s+/);
      expect(SUBCOMMANDS, `"${line}" in SKILL.md`).toContain(subcommand);
    }
  });

  it('names only flags the CLI has', () => {
    for (const line of commandLines(skill)) {
      for (const [flag] of line.matchAll(/--[a-z][a-z-]*/g)) {
        expect(usage, `"${flag}" in SKILL.md`).toContain(flag as string);
      }
    }
  });

  it('runs the judgment pass through the prompt the CLI prints', () => {
    const commands = commandLines(skill).map((line) => line.split(/\s+/).slice(0, 2).join(' '));
    expect(commands).toContain('cockpit run');
    expect(commands).toContain('cockpit judge-prompt');
    expect(commands).toContain('cockpit judge-merge');
    expect(commands).toContain('cockpit mark-failed');
    expect(commands).toContain('cockpit clean');
  });
});
