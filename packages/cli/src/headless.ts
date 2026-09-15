import { formatDuration } from './history.js';

/** The tools whose calls the progress line counts as the model reading the code. */
export const READING_TOOLS = new Set(['Read', 'Grep', 'Glob']);

export interface HeadlessProgress {
  sessionId: string | null;
  reads: number;
  writing: boolean;
  done: boolean;
  isError: boolean;
  /** The last assistant text, which holds the judgment when the model could not write the file. */
  finalText: string;
  /** What `claude` reported went wrong, when the run ended badly. */
  error: string | null;
}

export function newProgress(): HeadlessProgress {
  return {
    sessionId: null,
    reads: 0,
    writing: false,
    done: false,
    isError: false,
    finalText: '',
    error: null,
  };
}

type Block = { type?: string; name?: string; text?: string; input?: Record<string, unknown> };

function blocksOf(event: Record<string, unknown>): Block[] {
  const message = event['message'] as { content?: unknown } | undefined;
  return Array.isArray(message?.content) ? (message.content as Block[]) : [];
}

/**
 * A subagent's messages carry the id of the tool call that spawned them, and its own reads are
 * not the ones this progress line is counting.
 */
function fromMainConversation(event: Record<string, unknown>): boolean {
  const parent = event['parent_tool_use_id'];
  return parent === null || parent === undefined;
}

export function applyEvent(
  state: HeadlessProgress,
  event: unknown,
  judgmentPath: string,
): HeadlessProgress {
  if (event === null || typeof event !== 'object') return state;
  const record = event as Record<string, unknown>;

  if (record['type'] === 'system' && record['subtype'] === 'init') {
    state.sessionId = typeof record['session_id'] === 'string' ? record['session_id'] : null;
    return state;
  }

  if (record['type'] === 'assistant' && fromMainConversation(record)) {
    for (const block of blocksOf(record)) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        state.finalText = block.text;
      }
      if (block.type !== 'tool_use' || typeof block.name !== 'string') continue;
      if (READING_TOOLS.has(block.name)) state.reads += 1;
      if (block.name === 'Write' && writesJudgment(block.input, judgmentPath)) state.writing = true;
    }
    return state;
  }

  if (record['type'] === 'result') {
    state.done = true;
    state.writing = true;
    state.isError = record['is_error'] === true || record['subtype'] !== 'success';
    if (typeof record['result'] === 'string' && record['result'].trim() !== '') {
      state.finalText = record['result'];
    }
    if (state.isError) {
      state.error =
        typeof record['result'] === 'string' && record['result'].trim() !== ''
          ? record['result']
          : String(record['subtype'] ?? 'the run ended without a result');
    }
  }

  return state;
}

function writesJudgment(input: Record<string, unknown> | undefined, judgmentPath: string): boolean {
  const target = input?.['file_path'];
  return typeof target === 'string' && target.endsWith(basename(judgmentPath));
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function parseStream(
  text: string,
  judgmentPath: string,
  state: HeadlessProgress = newProgress(),
): HeadlessProgress {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      applyEvent(state, JSON.parse(trimmed), judgmentPath);
    } catch {
      continue;
    }
  }
  return state;
}

export function progressLine(
  state: HeadlessProgress,
  elapsedSeconds: number,
  estimateSeconds: number | null,
): string {
  const clock =
    estimateSeconds === null
      ? formatDuration(elapsedSeconds)
      : `${formatDuration(elapsedSeconds)} / ~${formatDuration(estimateSeconds)}`;
  const parts = ['judgment', clock, state.reads === 0 ? 'starting…' : `${state.reads} files read`];
  if (state.writing) parts.push('writing…');
  return parts.join(' · ');
}

const FENCE = /```(?:json)?\s*([\s\S]*?)```/;

function parses(candidate: string): string | null {
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function outermostObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return parses(text.slice(start, end + 1));
}

/**
 * The judgment as the model's last message left it, for a run whose Write was refused. The whole
 * message is tried before any fence, because a judgment carries fenced markdown of its own inside
 * `summary.example`.
 */
export function judgmentFromText(text: string): string | null {
  const trimmed = text.trim();
  return (
    parses(trimmed) ?? outermostObject(trimmed) ?? outermostObject(FENCE.exec(trimmed)?.[1] ?? '')
  );
}
