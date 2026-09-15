// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  effectiveTheme,
  readChoice,
  themeKey,
  watchSystemTheme,
  writeChoice,
} from '../src/lib/theme';

type Listener = (event: { matches: boolean }) => void;

interface FakeQuery {
  matches: boolean;
  listeners: Listener[];
  addEventListener: (type: string, listener: Listener) => void;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function systemPrefers(dark: boolean): FakeQuery {
  const query: FakeQuery = {
    matches: dark,
    listeners: [],
    addEventListener: (_type, listener) => {
      query.listeners.push(listener);
    },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', () => query);
  window.matchMedia = (() => query) as unknown as typeof window.matchMedia;
  return query;
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('readChoice', () => {
  it('is system until the reviewer picks one', () => {
    expect(readChoice()).toBe('system');
  });

  it('reads back what was written', () => {
    writeChoice('dark');
    expect(localStorage.getItem(themeKey)).toBe('dark');
    expect(readChoice()).toBe('dark');
  });

  it('drops a stored value it does not recognise', () => {
    localStorage.setItem(themeKey, 'solarized');
    expect(readChoice()).toBe('system');
  });

  it('forgets the choice again when it goes back to system', () => {
    writeChoice('light');
    writeChoice('system');
    expect(localStorage.getItem(themeKey)).toBeNull();
    expect(readChoice()).toBe('system');
  });
});

describe('effectiveTheme', () => {
  it('follows the system when nothing was chosen', () => {
    systemPrefers(true);
    expect(effectiveTheme('system')).toBe('dark');
    systemPrefers(false);
    expect(effectiveTheme('system')).toBe('light');
  });

  it('lets an explicit choice override the system', () => {
    systemPrefers(true);
    expect(effectiveTheme('light')).toBe('light');
  });
});

describe('applyTheme', () => {
  it('writes the theme where the stylesheet reads it', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('watchSystemTheme', () => {
  it('reports a flip and unsubscribes', () => {
    const query = systemPrefers(false);
    const seen: string[] = [];

    const stop = watchSystemTheme((theme) => seen.push(theme));
    expect(query.listeners).toHaveLength(1);
    for (const listener of query.listeners) listener({ matches: true });
    expect(seen).toEqual(['dark']);

    stop();
    expect(query.removeEventListener).toHaveBeenCalled();
  });

  it('is inert where matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(() => watchSystemTheme(() => {})()).not.toThrow();
  });
});
