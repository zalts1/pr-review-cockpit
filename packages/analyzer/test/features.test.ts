import { describe, expect, it } from 'vitest';
import type { DiffLine } from '@review-cockpit/schema';
import type { KindInput } from '../src/features.js';
import { classifyKind, hunkFeatures, importRanges } from '../src/features.js';
import { exportedTsSymbols } from '../src/fanin.js';

function lines(spec: string): DiffLine[] {
  let oldNo = 1;
  let newNo = 1;
  return spec
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const text = line.slice(1);
      if (line.startsWith('+')) return { type: 'add', oldNo: null, newNo: newNo++, text };
      if (line.startsWith('-')) return { type: 'del', oldNo: oldNo++, newNo: null, text };
      return { type: 'context', oldNo: oldNo++, newNo: newNo++, text };
    });
}

function input(overrides: Partial<KindInput> & { lines: DiffLine[] }): KindInput {
  return {
    header: '',
    symbols: [],
    language: 'go',
    testFile: false,
    headImportRanges: [],
    baseImportRanges: [],
    ...overrides,
  };
}

describe('import ranges', () => {
  it('covers a Go import block and a single-line import', () => {
    const source = ['package tenant', '', 'import (', '\t"context"', '\t"fmt"', ')', '', 'import "os"', ''].join('\n');
    expect(importRanges(source, 'go')).toEqual([
      [3, 6],
      [8, 8],
    ]);
  });

  it('covers a TypeScript import, including a multi-line one', () => {
    const source = [
      "import { a } from './a';",
      'import {',
      '  b,',
      "} from './b';",
      '',
      'const c = 1;',
    ].join('\n');
    expect(importRanges(source, 'ts')).toEqual([
      [1, 1],
      [2, 4],
    ]);
  });
});

describe('kind classification', () => {
  it('calls a hunk whose changed lines all sit in an import block an import', () => {
    const kind = classifyKind(
      input({
        lines: lines('+\t"context"\n+\t"fmt"\n \t"os"'),
        headImportRanges: [[1, 10]],
        baseImportRanges: [[1, 10]],
      }),
    );
    expect(kind).toBe('import');
  });

  it('will not call string lines outside an import block an import', () => {
    expect(classifyKind(input({ lines: lines('+\t"context"\n+\t"fmt"') }))).toBe('code');
  });

  it('sees reindentation as whitespace only', () => {
    expect(
      classifyKind(input({ lines: lines('-    if x {\n+\tif x {') })),
    ).toBe('whitespace-only');
  });

  it('sees added blank lines as whitespace only', () => {
    expect(classifyKind(input({ lines: lines('+\n+   ') }))).toBe('whitespace-only');
  });

  it('sees a doc comment change as comment only', () => {
    expect(
      classifyKind(input({ lines: lines('-// Update saves a record.\n+// Update writes a record.') })),
    ).toBe('comment-only');
  });

  it('reads # as the comment marker where there is no C-style comment', () => {
    expect(classifyKind(input({ lines: lines('+# a note'), language: null }))).toBe('comment-only');
    expect(classifyKind(input({ lines: lines('+// a note'), language: null }))).toBe('code');
  });

  it('calls a real change in a test file a test hunk', () => {
    expect(classifyKind(input({ lines: lines('+\tassert(1)'), testFile: true }))).toBe('test');
  });

  it('decides a trivial kind before it decides test', () => {
    expect(
      classifyKind(
        input({
          lines: lines('+\t"testing"'),
          testFile: true,
          headImportRanges: [[1, 4]],
        }),
      ),
    ).toBe('import');
  });

  it('calls everything else code', () => {
    expect(classifyKind(input({ lines: lines('+\treturn nil') }))).toBe('code');
  });
});

describe('hunk features', () => {
  it('counts size and the deletion ratio', () => {
    const features = hunkFeatures(input({ lines: lines('-a\n-b\n+c\n d') }));
    expect(features.size).toBe(3);
    expect(features.deleteRatio).toBeCloseTo(2 / 3);
  });

  it('counts a changed line once however many hazards it holds, and names them', () => {
    const features = hunkFeatures(
      input({ lines: lines('+\tgo func() { defer wg.Done() }()\n+\ttime.Sleep(time.Second)') }),
    );
    expect(features.hazards).toBe(2);
    expect(features.hazardNames).toContain('go func');
    expect(features.hazardNames).toContain('defer');
    expect(features.hazardNames).toContain('time.Sleep');
  });

  it('counts the TypeScript hazards for a TypeScript hunk', () => {
    const features = hunkFeatures(
      input({ lines: lines('+  el.innerHTML = raw as any;'), language: 'ts' }),
    );
    expect(features.hazards).toBe(1);
    expect(features.hazardNames).toEqual(expect.arrayContaining(['innerHTML', 'as any']));
  });

  it('adds the repository hazard patterns to the built-in ones', () => {
    const features = hunkFeatures(input({ lines: lines('+\ttenant.Unsafe(ctx)') }), {
      go: ['tenant.Unsafe'],
    });
    expect(features.hazards).toBe(1);
  });

  it('sees the error path', () => {
    expect(hunkFeatures(input({ lines: lines('+\tif err != nil {') })).touchesErrorPath).toBe(true);
    expect(hunkFeatures(input({ lines: lines('+  throw new Error(x)'), language: 'ts' })).touchesErrorPath).toBe(true);
    expect(hunkFeatures(input({ lines: lines('+\tx := 1') })).touchesErrorPath).toBe(false);
  });

  it('sees the public surface through an exported Go symbol or a type declaration', () => {
    expect(
      hunkFeatures(input({ lines: lines('+\treturn nil'), symbols: ['Service.UpdateRecord'] }))
        .touchesPublicSurface,
    ).toBe(true);
    expect(
      hunkFeatures(input({ lines: lines('+\treturn nil'), symbols: ['service.updateRecord'] }))
        .touchesPublicSurface,
    ).toBe(false);
    expect(
      hunkFeatures(input({ lines: lines('+type Record struct {') })).touchesPublicSurface,
    ).toBe(true);
  });

  it('reads nothing in a test file as public surface', () => {
    expect(
      hunkFeatures(
        input({ lines: lines('+\tt.Log("x")'), symbols: ['TestUpdate'], testFile: true }),
      ).touchesPublicSurface,
    ).toBe(false);
  });

  it('sees the public surface through an export in TypeScript', () => {
    expect(
      hunkFeatures(input({ lines: lines('+export function load() {}'), language: 'ts' }))
        .touchesPublicSurface,
    ).toBe(true);
    expect(
      hunkFeatures(input({ lines: lines('+  const x = 1;'), language: 'ts' })).touchesPublicSurface,
    ).toBe(false);
  });
});

describe('exported TypeScript symbols', () => {
  it('reads declarations and export lists', () => {
    const source = [
      'export function load() {}',
      'export const NAME = 1;',
      'export interface Options {}',
      'export default class Widget {}',
      'const hidden = 2;',
      'export { hidden as shown };',
    ].join('\n');
    expect(exportedTsSymbols(source).sort()).toEqual(
      ['NAME', 'Options', 'Widget', 'load', 'shown'].sort(),
    );
  });
});
