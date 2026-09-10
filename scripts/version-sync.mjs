import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function rewrite(relative, update) {
  const path = join(root, relative);
  const text = readFileSync(path, 'utf8');
  const json = JSON.parse(text);
  update(json);
  const next = `${JSON.stringify(json, null, 2)}\n`;
  if (next === text) return false;
  writeFileSync(path, next);
  return true;
}

const changed = [
  rewrite('.claude-plugin/plugin.json', (json) => {
    json.version = version;
  }),
  rewrite('.claude-plugin/marketplace.json', (json) => {
    const entry = json.plugins.find((plugin) => plugin.name === 'cockpit');
    if (entry === undefined) throw new Error('marketplace.json has no plugin entry named cockpit');
    entry.version = version;
  }),
].some(Boolean);

console.log(changed ? `synced the plugin manifests to ${version}` : `the plugin manifests are already ${version}`);
