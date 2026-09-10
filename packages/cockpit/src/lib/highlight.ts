import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import protobuf from 'highlight.js/lib/languages/protobuf';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { DiffLine, Hunk, Language, ReviewFile } from '@review-cockpit/schema';
import { sanitizeCodeHtml } from './markdown';

const GRAMMARS = {
  bash,
  css,
  go,
  javascript,
  json,
  markdown,
  protobuf,
  python,
  sql,
  typescript,
  xml,
  yaml,
};

export type Grammar = keyof typeof GRAMMARS;

for (const [name, grammar] of Object.entries(GRAMMARS)) {
  hljs.registerLanguage(name, grammar);
}

const BY_LANGUAGE: Record<Language, Grammar | null> = {
  go: 'go',
  typescript: 'typescript',
  tsx: 'typescript',
  python: 'python',
  proto: 'protobuf',
  yaml: 'yaml',
  json: 'json',
  markdown: 'markdown',
  other: null,
};

// HCL has no grammar in the registered set; bash is the closest fit for a `.tf` file,
// because it shares the `#` comment, the double-quoted string and `${...}` interpolation.
const BY_EXTENSION: Record<string, Grammar> = {
  sql: 'sql',
  sh: 'bash',
  tf: 'bash',
  html: 'xml',
  css: 'css',
  js: 'javascript',
};

export function grammarFor(file: Pick<ReviewFile, 'language' | 'path'>): Grammar | null {
  const byLanguage = BY_LANGUAGE[file.language];
  if (byLanguage !== null) return byLanguage;
  const dot = file.path.lastIndexOf('.');
  if (dot === -1) return null;
  return BY_EXTENSION[file.path.slice(dot + 1).toLowerCase()] ?? null;
}

const SPAN = /<span class="([^"]*)">|<\/span>/g;
const HLJS_CLASS = /^hljs-[a-z-]+$/;

function keptClass(attr: string): string | null {
  for (const name of attr.split(/\s+/)) {
    if (HLJS_CLASS.test(name)) return name;
  }
  return null;
}

/**
 * Cuts one highlighted block into one HTML string per line, closing the spans that are
 * still open at a line break and reopening them on the next line. A span whose class is
 * not one of highlight.js's own is dropped and its text kept.
 */
function splitLines(html: string, expected: number): string[] | null {
  const lines: string[] = [];
  const stack: (string | null)[] = [];
  let current = '';

  const openTags = (): string[] => stack.filter((name): name is string => name !== null);

  const breakLine = () => {
    const open = openTags();
    lines.push(current + '</span>'.repeat(open.length));
    current = open.map((name) => `<span class="${name}">`).join('');
  };

  const addText = (raw: string) => {
    const parts = raw.split('\n');
    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0) breakLine();
      current += parts[i] ?? '';
    }
  };

  SPAN.lastIndex = 0;
  let at = 0;
  for (let match = SPAN.exec(html); match !== null; match = SPAN.exec(html)) {
    addText(html.slice(at, match.index));
    at = match.index + match[0].length;
    const attr = match[1];
    if (attr === undefined) {
      if (stack.pop() !== null) current += '</span>';
    } else {
      const name = keptClass(attr);
      stack.push(name);
      if (name !== null) current += `<span class="${name}">`;
    }
  }
  addText(html.slice(at));
  lines.push(current + '</span>'.repeat(openTags().length));

  // A line count that does not match would shift every following line's colouring onto
  // the wrong text, so the whole block falls back to plain rather than lie.
  return lines.length === expected ? lines : null;
}

const LEFT: ReadonlySet<DiffLine['type']> = new Set(['context', 'del']);
const RIGHT: ReadonlySet<DiffLine['type']> = new Set(['context', 'add']);

function highlightStream(
  lines: readonly DiffLine[],
  sides: ReadonlySet<DiffLine['type']>,
  grammar: Grammar,
  into: (string | null)[],
): void {
  const picked: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line !== undefined && sides.has(line.type)) picked.push(i);
  }
  if (picked.length === 0) return;

  const code = picked.map((i) => lines[i]?.text ?? '').join('\n');
  const html = hljs.highlight(code, { language: grammar, ignoreIllegals: true }).value;
  const split = splitLines(html, picked.length);
  if (split === null) return;
  picked.forEach((i, n) => {
    into[i] = split[n] ?? null;
  });
}

/**
 * Sanitised HTML for every line of one hunk, in hunk order; null where the line renders as
 * plain text. The two sides are highlighted as separate streams so that a string or comment
 * opened on a deleted line cannot colour the added lines that replaced it.
 */
export function highlightHunk(
  hunk: Pick<Hunk, 'lines'>,
  grammar: Grammar | null,
): (string | null)[] {
  const out: (string | null)[] = hunk.lines.map(() => null);
  if (grammar === null) return out;

  highlightStream(hunk.lines, RIGHT, grammar, out);
  if (hunk.lines.some((line) => line.type === 'del')) {
    highlightStream(hunk.lines, LEFT, grammar, out);
  }

  // A line highlight.js gave no span to carries no colouring, so it is handed back as null
  // and rendered as a text node: one DOMPurify call less, and one less line of markup.
  return out.map((html) =>
    html === null || !html.includes('<span') ? null : sanitizeCodeHtml(html),
  );
}

const cache = new WeakMap<Pick<Hunk, 'lines'>, Map<string, (string | null)[]>>();

/** highlightHunk, computed once per hunk per grammar for as long as the document lives. */
export function highlightHunkCached(
  hunk: Pick<Hunk, 'lines'>,
  grammar: Grammar | null,
): (string | null)[] {
  let byGrammar = cache.get(hunk);
  if (byGrammar === undefined) {
    byGrammar = new Map();
    cache.set(hunk, byGrammar);
  }
  const key = grammar ?? 'plain';
  const hit = byGrammar.get(key);
  if (hit !== undefined) return hit;
  const computed = highlightHunk(hunk, grammar);
  byGrammar.set(key, computed);
  return computed;
}
