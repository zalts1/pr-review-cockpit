import { describe, expect, it } from 'vitest';
import type { Connection, ConnectionEvent } from '../src/lib/connection';
import {
  connectionBanner,
  hasGivenUp,
  initialConnection,
  nextConnection,
  RECONNECT_TRIES,
  shutdownReasonOf,
} from '../src/lib/connection';

function after(...events: ConnectionEvent[]): Connection {
  return events.reduce(nextConnection, initialConnection);
}

const target = 'owner/repo#123';

describe('nextConnection', () => {
  it('rides out a connection that comes back', () => {
    expect(after({ kind: 'failed' })).toEqual({ state: 'dropped', tries: 1 });
    expect(after({ kind: 'failed' }, { kind: 'failed' })).toEqual({ state: 'dropped', tries: 2 });
    expect(after({ kind: 'failed' }, { kind: 'open' })).toEqual({ state: 'live' });
  });

  it('gives up after the last try, and not before', () => {
    const failures = Array.from({ length: RECONNECT_TRIES }, () => ({ kind: 'failed' }) as ConnectionEvent);

    const oneShort = after(...failures.slice(0, -1));
    expect(oneShort).toEqual({ state: 'dropped', tries: RECONNECT_TRIES - 1 });
    expect(hasGivenUp(oneShort)).toBe(false);

    const spent = after(...failures);
    expect(spent).toEqual({ state: 'stopped', reason: 'gave-up' });
    expect(hasGivenUp(spent)).toBe(true);
  });

  it('believes a server that says it is stopping, on the first event', () => {
    const idle = after({ kind: 'shutdown', reason: 'idle' });
    expect(idle).toEqual({ state: 'stopped', reason: 'idle' });
    expect(hasGivenUp(idle)).toBe(true);

    expect(after({ kind: 'shutdown', reason: 'stopped' })).toEqual({
      state: 'stopped',
      reason: 'stopped',
    });
  });

  it('keeps a shutdown it was told about through the failures that follow it', () => {
    const stopped = after(
      { kind: 'shutdown', reason: 'idle' },
      { kind: 'failed' },
      { kind: 'failed' },
    );
    expect(stopped).toEqual({ state: 'stopped', reason: 'idle' });
  });

  it('comes back to life if the server does', () => {
    expect(after({ kind: 'shutdown', reason: 'idle' }, { kind: 'open' })).toEqual({ state: 'live' });
  });
});

describe('connectionBanner', () => {
  it('shows nothing while the stream is live', () => {
    expect(connectionBanner({ state: 'live' }, target)).toBeNull();
  });

  it('says only that the connection dropped while it is still retrying', () => {
    const banner = connectionBanner({ state: 'dropped', tries: 2 }, target);
    expect(banner).toEqual({
      tone: 'dropped',
      text: 'Disconnected from the local server. Drafts are saved locally.',
      command: null,
    });
  });

  it('names the idle window and the command that brings the server back', () => {
    const banner = connectionBanner({ state: 'stopped', reason: 'idle' }, target);
    expect(banner?.tone).toBe('stopped');
    expect(banner?.text).toBe('Server stopped after 30 idle minutes.');
    expect(banner?.command).toBe('cockpit run owner/repo#123');
  });

  it('does not blame the clock for a shutdown that gave another reason', () => {
    expect(connectionBanner({ state: 'stopped', reason: 'stopped' }, target)?.text).toBe(
      'The local server stopped.',
    );
  });

  it('guesses at the idle window when the server said nothing at all', () => {
    const banner = connectionBanner({ state: 'stopped', reason: 'gave-up' }, target);
    expect(banner?.text).toContain('is not answering');
    expect(banner?.text).toContain('30 idle minutes');
    expect(banner?.command).toBe('cockpit run owner/repo#123');
  });
});

describe('shutdownReasonOf', () => {
  it('reads the reason out of the shutdown event', () => {
    expect(shutdownReasonOf('{"type":"shutdown","reason":"idle"}')).toBe('idle');
    expect(shutdownReasonOf('{"type":"shutdown","reason":"stopped"}')).toBe('stopped');
  });

  it('treats a shutdown with an unknown reason as a plain stop', () => {
    expect(shutdownReasonOf('{"type":"shutdown"}')).toBe('stopped');
  });

  it('ignores every other event and anything that is not one', () => {
    expect(shutdownReasonOf('{"type":"document"}')).toBeNull();
    expect(shutdownReasonOf('not json')).toBeNull();
    expect(shutdownReasonOf(undefined)).toBeNull();
  });
});
