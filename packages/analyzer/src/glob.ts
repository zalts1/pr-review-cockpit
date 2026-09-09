const specials = /[.+^${}()|[\]\\]/g;

/**
 * Glob semantics: `**` spans path segments, `*` and `?` stay inside one, and a
 * pattern without a slash matches the basename, as gitignore does. That is what
 * makes `Dockerfile*` and `package-lock.json` in the built-in lists work.
 */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] as string;
    if (char === '*') {
      const doubled = pattern[i + 1] === '*';
      if (doubled && pattern[i + 2] === '/') {
        out += '(?:[^/]+/)*';
        i += 2;
      } else if (doubled) {
        out += '.*';
        i += 1;
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      continue;
    }
    out += char.replace(specials, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

const cache = new Map<string, RegExp>();

function compiled(pattern: string): RegExp {
  let regex = cache.get(pattern);
  if (!regex) {
    regex = globToRegExp(pattern);
    cache.set(pattern, regex);
  }
  return regex;
}

export function matchesGlob(path: string, pattern: string): boolean {
  const subject = pattern.includes('/') ? path : (path.split('/').pop() ?? path);
  return compiled(pattern).test(subject);
}

/** The first pattern that matches, so the reported rule is the one a reader can check. */
export function firstMatch(path: string, patterns: readonly string[]): string | null {
  for (const pattern of patterns) {
    if (matchesGlob(path, pattern)) return pattern;
  }
  return null;
}
