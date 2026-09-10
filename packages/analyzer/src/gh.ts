import { runOk } from './exec.js';

/** Injected so a test can hand the mappers canned JSON and reach no network. */
export type GhRunner = (args: readonly string[]) => string;

export const ghCli: GhRunner = (args) => runOk('gh', [...args]);

/**
 * `gh api --paginate` prints one JSON value per page, so a multi-page fetch is
 * several documents in a row rather than one array.
 */
export function jsonValues(text: string): unknown[] {
  const values: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        values.push(JSON.parse(text.slice(start, i + 1)));
        start = -1;
      }
    }
  }

  return values;
}

/** Every element of every page, for an endpoint that answers with a JSON array. */
export function ghArray<T>(gh: GhRunner, args: readonly string[]): T[] {
  return jsonValues(gh(args)).flatMap((value) => (Array.isArray(value) ? (value as T[]) : []));
}

/** One page per call, for an endpoint that answers with an object. */
export function ghObjects<T>(gh: GhRunner, args: readonly string[]): T[] {
  return jsonValues(gh(args)).filter(
    (value): value is T => value !== null && typeof value === 'object' && !Array.isArray(value),
  );
}

export function ghMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n').slice(0, 3).join(' ').trim();
}
