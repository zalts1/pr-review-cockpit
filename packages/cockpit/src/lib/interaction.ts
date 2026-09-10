import type { DiffLine, Hunk, ReviewFile, Side } from '@review-cockpit/schema';

export interface LineTarget {
  fileId: string;
  hunkId: string;
  path: string;
  side: Side;
  line: number;
}

export interface EditorTarget extends LineTarget {
  startLine: number | null;
  startSide: Side | null;
}

export interface DragRange {
  start: LineTarget;
  end: LineTarget;
}

export function sameLine(a: LineTarget, b: LineTarget): boolean {
  return a.hunkId === b.hunkId && a.side === b.side && a.line === b.line;
}

export function rangeOf(drag: DragRange): { from: number; to: number } {
  return {
    from: Math.min(drag.start.line, drag.end.line),
    to: Math.max(drag.start.line, drag.end.line),
  };
}

export function editorTargetFromDrag(drag: DragRange): EditorTarget {
  const { from, to } = rangeOf(drag);
  const anchor = drag.start.line <= drag.end.line ? drag.end : drag.start;
  return {
    ...anchor,
    line: to,
    startLine: from === to ? null : from,
    startSide: from === to ? null : anchor.side,
  };
}

export function lineTarget(file: ReviewFile, hunk: Hunk, line: DiffLine): LineTarget | null {
  if (line.newNo !== null) {
    return { fileId: file.id, hunkId: hunk.id, path: file.path, side: 'RIGHT', line: line.newNo };
  }
  if (line.oldNo !== null) {
    return { fileId: file.id, hunkId: hunk.id, path: file.path, side: 'LEFT', line: line.oldNo };
  }
  return null;
}

/**
 * Where `c` puts the editor when the pointer is nowhere near the diff. An
 * added line first: a remark about a hunk is nearly always about the code
 * that replaced the old, and one left on a deleted line reads as a comment
 * on the wrong side. Deletions then context cover a hunk that only removes.
 */
export function firstCommentableLine(file: ReviewFile, hunk: Hunk): LineTarget | null {
  const byType = (type: DiffLine['type']) => hunk.lines.find((line) => line.type === type);
  for (const line of [byType('add'), byType('del'), hunk.lines[0]]) {
    if (!line) continue;
    const target = lineTarget(file, hunk, line);
    if (target) return target;
  }
  return null;
}
