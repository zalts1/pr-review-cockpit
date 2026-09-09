import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  { schema: 'review-document.schema.json', name: 'ReviewDocument', out: 'document.ts' },
  { schema: 'judgment.schema.json', name: 'Judgment', out: 'judgment.ts' },
  { schema: 'drafts.schema.json', name: 'DraftsFile', out: 'drafts.ts' },
];

// An open object generates an index signature that would let any typo typecheck.
// Unknown fields stay legal in the schema; the validator reports them as warnings.
function closeObjects(node) {
  if (Array.isArray(node)) return node.map(closeObjects);
  if (node === null || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'additionalProperties' && value === true) continue;
    out[key] = closeObjects(value);
  }
  return out;
}

await mkdir(resolve(root, 'src/generated'), { recursive: true });

for (const target of targets) {
  const schema = JSON.parse(await readFile(resolve(root, 'schemas', target.schema), 'utf8'));
  const ts = await compile(closeObjects(schema), target.name, {
    additionalProperties: false,
    bannerComment: `/* eslint-disable */\n/**\n * Generated from schemas/${target.schema} by \`npm run generate\`.\n * Do not edit by hand.\n */`,
    declareExternallyReferenced: true,
    enableConstEnums: false,
    style: { singleQuote: true, printWidth: 96 },
  });
  await writeFile(resolve(root, 'src/generated', target.out), ts, 'utf8');
  console.log(`generated src/generated/${target.out} from schemas/${target.schema}`);
}
