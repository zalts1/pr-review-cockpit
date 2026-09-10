// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { DiffLine, DiffLineType } from '@review-cockpit/schema';
import { grammarFor, highlightHunk } from '../src/lib/highlight';

function line(type: DiffLineType, text: string): DiffLine {
  return { type, oldNo: type === 'add' ? null : 1, newNo: type === 'del' ? null : 1, text };
}

function html(lines: DiffLine[], grammar: Parameters<typeof highlightHunk>[1]) {
  return highlightHunk({ lines }, grammar);
}

describe('grammarFor', () => {
  it('maps the document language, then the extension', () => {
    expect(grammarFor({ language: 'go', path: 'api/record.go' })).toBe('go');
    expect(grammarFor({ language: 'tsx', path: 'src/App.tsx' })).toBe('typescript');
    expect(grammarFor({ language: 'proto', path: 'api/v1/record.proto' })).toBe('protobuf');
    expect(grammarFor({ language: 'other', path: 'db/0042.sql' })).toBe('sql');
    expect(grammarFor({ language: 'other', path: 'scripts/install.sh' })).toBe('bash');
    expect(grammarFor({ language: 'other', path: 'infra/main.tf' })).toBe('bash');
  });

  it('leaves an unknown extension and an extensionless path plain', () => {
    expect(grammarFor({ language: 'other', path: 'vendor/blob.bin' })).toBeNull();
    expect(grammarFor({ language: 'other', path: 'Makefile' })).toBeNull();
  });
});

describe('highlightHunk', () => {
  it('carries a Go block comment across all three of its lines', () => {
    const out = html(
      [
        line('context', '/* Update writes the record.'),
        line('context', '   It returns a wrapped error.'),
        line('context', '*/'),
        line('context', 'func Update() error { return nil }'),
      ],
      'go',
    );

    for (const i of [0, 1, 2]) {
      expect(out[i]).toContain('hljs-comment');
    }
    expect(out[3]).toContain('hljs-keyword');
    expect(out[3]).not.toContain('hljs-comment');
  });

  it('keeps the two sides apart, so an unterminated comment does not cross them', () => {
    const out = html(
      [
        line('del', '/* the old note'),
        line('del', '   over two lines'),
        line('add', 'func Update() error { return nil }'),
      ],
      'go',
    );

    expect(out[0]).toContain('hljs-comment');
    expect(out[1]).toContain('hljs-comment');
    expect(out[2]).toContain('hljs-keyword');
    expect(out[2]).not.toContain('hljs-comment');
  });

  it('keeps a comment opened on an added line off the deleted lines', () => {
    const out = html(
      [
        line('add', '/* the new note'),
        line('del', 'func Update() error { return nil }'),
      ],
      'go',
    );

    expect(out[0]).toContain('hljs-comment');
    expect(out[1]).toContain('hljs-keyword');
    expect(out[1]).not.toContain('hljs-comment');
  });

  it('renders an unknown language as plain text, not as HTML', () => {
    expect(html([line('context', 'const x = <b>1</b>;')], null)).toEqual([null]);
  });

  it('escapes markup in a line rather than passing it through', () => {
    const [only] = html([line('add', 'const s = "<script>alert(1)</script>"')], 'typescript');

    expect(only).not.toBeNull();
    expect(only).toContain('&lt;script&gt;');
    expect(only).not.toContain('<script');
    expect(only?.replace(/<\/?span[^>]*>/g, '')).toBe(
      'const s = "&lt;script&gt;alert(1)&lt;/script&gt;"',
    );
  });

  it('keeps only highlight.js classes on the spans it renders', () => {
    const out = html([line('context', 'type Record struct { ID string }')], 'go');
    const classes = [...(out[0] ?? '').matchAll(/class="([^"]*)"/g)].map((m) => m[1]);

    expect(classes.length).toBeGreaterThan(0);
    for (const name of classes) {
      expect(name).toMatch(/^hljs-[a-z-]+$/);
    }
  });
});
