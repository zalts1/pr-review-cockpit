/**
 * A dropped connection comes back on its own within a couple of seconds, so four failures in a
 * row is the point where waiting longer tells the reader nothing they do not already know.
 */
export const RECONNECT_TRIES = 4;

/** The window the server stops itself after, and the number its own message names. */
export const IDLE_MINUTES = 30;

export type StoppedReason =
  /** The server said it was stopping because nobody was connected. */
  | 'idle'
  /** The server said it was stopping, without blaming the clock. */
  | 'stopped'
  /** The server said nothing and stopped answering, which is a guess about why. */
  | 'gave-up';

export type Connection =
  | { state: 'live' }
  | { state: 'dropped'; tries: number }
  | { state: 'stopped'; reason: StoppedReason };

export type ConnectionEvent =
  | { kind: 'open' }
  | { kind: 'failed' }
  | { kind: 'shutdown'; reason: 'idle' | 'stopped' };

export const initialConnection: Connection = { state: 'live' };

/**
 * A server that announced its shutdown is known to be gone from the first event, so the banner
 * says so at once. A connection that merely broke is retried, because a reload of the page and
 * a laptop waking up both look like this for a second or two.
 */
export function nextConnection(current: Connection, event: ConnectionEvent): Connection {
  if (event.kind === 'shutdown') return { state: 'stopped', reason: event.reason };
  if (event.kind === 'open') return { state: 'live' };
  if (current.state === 'stopped') return current;

  const tries = (current.state === 'dropped' ? current.tries : 0) + 1;
  return tries >= RECONNECT_TRIES ? { state: 'stopped', reason: 'gave-up' } : { state: 'dropped', tries };
}

/** True once the cockpit has stopped waiting, so the caller closes its event stream. */
export function hasGivenUp(connection: Connection): boolean {
  return connection.state === 'stopped';
}

export interface ConnectionBanner {
  tone: 'dropped' | 'stopped';
  text: string;
  /** The command that brings the server back, shown after the text as code. */
  command: string | null;
}

export function connectionBanner(connection: Connection, target: string): ConnectionBanner | null {
  if (connection.state === 'live') return null;
  if (connection.state === 'dropped') {
    return {
      tone: 'dropped',
      text: 'Disconnected from the local server. Drafts are saved locally.',
      command: null,
    };
  }

  const command = `cockpit run ${target}`;
  if (connection.reason === 'idle') {
    return { tone: 'stopped', text: `Server stopped after ${IDLE_MINUTES} idle minutes.`, command };
  }
  if (connection.reason === 'stopped') {
    return { tone: 'stopped', text: 'The local server stopped.', command };
  }
  return {
    tone: 'stopped',
    text: `The local server is not answering. It stops itself after ${IDLE_MINUTES} idle minutes.`,
    command,
  };
}

export function shutdownReasonOf(data: unknown): 'idle' | 'stopped' | null {
  if (typeof data !== 'string') return null;
  let parsed: { type?: unknown; reason?: unknown } | null;
  try {
    parsed = JSON.parse(data) as { type?: unknown; reason?: unknown } | null;
  } catch {
    return null;
  }
  if (parsed?.type !== 'shutdown') return null;
  return parsed.reason === 'idle' ? 'idle' : 'stopped';
}
