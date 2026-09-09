import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './exec.js';

export function readWorktreeFile(worktree: string, path: string): string | null {
  try {
    return readFileSync(join(worktree, path), 'utf8');
  } catch {
    return null;
  }
}

/** The base side of a file, which only exists in the object store. */
export function showFile(repo: string, sha: string, path: string): string | null {
  const result = run('git', ['-C', repo, 'show', `${sha}:${path}`]);
  return result.code === 0 ? result.stdout : null;
}

export function firstLines(source: string | null, count: number): string[] {
  if (source === null) return [];
  return source.split('\n', count);
}
