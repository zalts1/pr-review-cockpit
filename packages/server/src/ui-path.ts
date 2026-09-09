import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UI_PATH_ENV_VAR = 'REVIEW_COCKPIT_UI';

const COCKPIT_HTML_FROM_WORKSPACE_ROOT = join('packages', 'cockpit', 'dist', 'index.html');

export function resolveUiHtmlPath(override?: string): string | null {
  if (override !== undefined && override !== '') return resolve(override);

  const fromEnv = process.env[UI_PATH_ENV_VAR];
  if (fromEnv !== undefined && fromEnv !== '') return resolve(fromEnv);

  for (const candidate of discoveryCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function discoveryCandidates(): string[] {
  const candidates: string[] = [];

  const fromPackage = cockpitPackageHtml();
  if (fromPackage !== null) candidates.push(fromPackage);

  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    candidates.push(join(dir, COCKPIT_HTML_FROM_WORKSPACE_ROOT));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return candidates;
}

function cockpitPackageHtml(): string | null {
  try {
    const manifest = createRequire(import.meta.url).resolve('@review-cockpit/cockpit/package.json');
    return join(dirname(manifest), 'dist', 'index.html');
  } catch {
    return null;
  }
}
