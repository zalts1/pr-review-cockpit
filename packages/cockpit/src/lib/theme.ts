import { useCallback, useEffect, useState } from 'react';

/** What the reviewer chose. 'system' follows the OS and keeps following it. */
export type ThemeChoice = 'system' | 'light' | 'dark';

/** What the page renders as. data-theme always holds one of these two. */
export type Theme = 'light' | 'dark';

/**
 * Not scoped to a pull request, unlike the drafts key: the theme is a property
 * of the person reading, not of what they are reading.
 */
export const themeKey = 'review-cockpit:theme';

const darkQuery = '(prefers-color-scheme: dark)';

export function readChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(themeKey);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function writeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(themeKey);
    else localStorage.setItem(themeKey, choice);
  } catch {
    return;
  }
}

export function systemTheme(): Theme {
  try {
    return window.matchMedia(darkQuery).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function effectiveTheme(choice: ThemeChoice): Theme {
  return choice === 'system' ? systemTheme() : choice;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function watchSystemTheme(onChange: (theme: Theme) => void): () => void {
  let query: MediaQueryList;
  try {
    query = window.matchMedia(darkQuery);
  } catch {
    return () => {};
  }
  const listener = (event: MediaQueryListEvent) => onChange(event.matches ? 'dark' : 'light');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

export interface ThemeState {
  choice: ThemeChoice;
  theme: Theme;
  /** Flips to the opposite of what is on screen, which then stops following the OS. */
  toggle(): void;
}

export function useTheme(): ThemeState {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  const [theme, setTheme] = useState<Theme>(() => effectiveTheme(readChoice()));

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (choice !== 'system') return;
    return watchSystemTheme(setTheme);
  }, [choice]);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    writeChoice(next);
    setChoice(next);
    setTheme(next);
  }, [theme]);

  return { choice, theme, toggle };
}
