import type { Side } from '../types';

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
