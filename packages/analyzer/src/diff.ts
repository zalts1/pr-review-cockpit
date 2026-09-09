import type { DiffLine, FileStatus } from '@review-cockpit/schema';

export interface ParsedHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface ParsedFile {
  path: string;
  previousPath: string | null;
  status: FileStatus;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: ParsedHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Git quotes a path containing control characters, quotes or non-ASCII bytes. */
function unquote(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path;
  const body = path.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i] as string;
    if (char !== '\\') {
      bytes.push(...new TextEncoder().encode(char));
      continue;
    }
    const next = body[i + 1] as string;
    const octal = /^[0-7]{3}$/.exec(body.slice(i + 1, i + 4));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
      continue;
    }
    const simple: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92 };
    bytes.push(simple[next] ?? new TextEncoder().encode(next)[0] ?? 63);
    i += 1;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function stripPrefix(path: string): string | null {
  const unquoted = unquote(path.trim());
  if (unquoted === '/dev/null') return null;
  return unquoted.replace(/^[ab]\//, '');
}

/** A path with a space makes the header ambiguous, and git quotes only when it must. */
function pathsFromHeader(line: string): { a: string | null; b: string | null } {
  const rest = line.slice('diff --git '.length);
  if (rest.startsWith('"')) {
    const end = /(?<!\\)"/g;
    end.lastIndex = 1;
    const match = end.exec(rest);
    if (match) {
      return {
        a: stripPrefix(rest.slice(0, match.index + 1)),
        b: stripPrefix(rest.slice(match.index + 2)),
      };
    }
  }
  const parts = rest.split(' ');
  for (let split = 1; split < parts.length; split += 1) {
    const a = parts.slice(0, split).join(' ');
    const b = parts.slice(split).join(' ');
    if (a.startsWith('a/') && b.startsWith('b/') && a.slice(2) === b.slice(2)) {
      return { a: stripPrefix(a), b: stripPrefix(b) };
    }
  }
  return { a: stripPrefix(parts.slice(0, 1).join(' ')), b: stripPrefix(parts.slice(1).join(' ')) };
}

interface Draft {
  aPath: string | null;
  bPath: string | null;
  renameFrom: string | null;
  renameTo: string | null;
  status: FileStatus;
  binary: boolean;
  hunks: ParsedHunk[];
}

export function parseDiff(text: string): ParsedFile[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const files: Draft[] = [];
  let current: Draft | null = null;
  let hunk: ParsedHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;

  const closeHunk = (): void => {
    hunk = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      closeHunk();
      const { a, b } = pathsFromHeader(line);
      current = {
        aPath: a,
        bPath: b,
        renameFrom: null,
        renameTo: null,
        status: 'modified',
        binary: false,
        hunks: [],
      };
      files.push(current);
      continue;
    }
    if (!current) continue;

    if (hunk && oldLeft <= 0 && newLeft <= 0 && line[0] !== '\\') closeHunk();

    if (hunk) {
      const marker = line[0];
      if (marker === ' ' || line === '') {
        hunk.lines.push({ type: 'context', oldNo, newNo, text: line.slice(1) });
        oldNo += 1;
        newNo += 1;
        oldLeft -= 1;
        newLeft -= 1;
        continue;
      }
      if (marker === '+') {
        hunk.lines.push({ type: 'add', oldNo: null, newNo, text: line.slice(1) });
        newNo += 1;
        newLeft -= 1;
        continue;
      }
      if (marker === '-') {
        hunk.lines.push({ type: 'del', oldNo, newNo: null, text: line.slice(1) });
        oldNo += 1;
        oldLeft -= 1;
        continue;
      }
      if (marker === '\\') continue;
      closeHunk();
    }

    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[3]);
      oldLeft = header[2] === undefined ? 1 : Number(header[2]);
      newLeft = header[4] === undefined ? 1 : Number(header[4]);
      hunk = {
        oldStart: oldNo,
        oldLines: oldLeft,
        newStart: newNo,
        newLines: newLeft,
        header: header[5] ?? '',
        lines: [],
      };
      current.hunks.push(hunk);
      continue;
    }

    if (line.startsWith('new file mode')) current.status = 'added';
    else if (line.startsWith('deleted file mode')) current.status = 'deleted';
    else if (line.startsWith('rename from ')) {
      current.status = 'renamed';
      current.renameFrom = stripPrefix(line.slice('rename from '.length));
    } else if (line.startsWith('rename to ')) {
      current.status = 'renamed';
      current.renameTo = stripPrefix(line.slice('rename to '.length));
    } else if (line.startsWith('copy from ')) {
      current.status = 'added';
    } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.binary = true;
    } else if (line.startsWith('--- ')) {
      current.aPath = stripPrefix(line.slice(4)) ?? current.aPath;
    } else if (line.startsWith('+++ ')) {
      current.bPath = stripPrefix(line.slice(4)) ?? current.bPath;
    }
  }

  return files.map(finish);
}

function finish(draft: Draft): ParsedFile {
  const headSide = draft.renameTo ?? draft.bPath;
  const baseSide = draft.renameFrom ?? draft.aPath;
  const path = (draft.status === 'deleted' ? baseSide : headSide) ?? baseSide ?? '';
  const previousPath = draft.status === 'renamed' ? baseSide : null;

  let additions = 0;
  let deletions = 0;
  for (const hunk of draft.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') additions += 1;
      if (line.type === 'del') deletions += 1;
    }
  }

  return {
    path,
    previousPath: previousPath === path ? null : previousPath,
    status: draft.status,
    binary: draft.binary,
    additions,
    deletions,
    hunks: draft.hunks,
  };
}
