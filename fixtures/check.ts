import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReviewDocument } from '@review-cockpit/schema';
import { checkVersion, validateDocument } from '@review-cockpit/schema';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = readdirSync(here)
  .filter((f) => f.endsWith('.json'))
  .sort();

let broken = 0;

for (const file of fixtures) {
  const doc = JSON.parse(readFileSync(resolve(here, file), 'utf8')) as ReviewDocument;
  const { ok, errors, warnings } = validateDocument(doc);
  const version = checkVersion(doc);
  const hunks = doc.files.reduce((n, f) => n + f.hunks.length, 0);

  console.log(
    `${file}: schema ${doc.schemaVersion}, ${doc.files.length} files, ${hunks} hunks, ` +
      `${doc.path.length} path steps, ${doc.graph.nodes.length} graph nodes` +
      `${ok ? '' : ` — ${errors.length} error(s)`}`,
  );

  if (!version.ok) {
    console.error(`  major version ${version.documentMajor} is not ${version.supportedMajor}`);
    broken += 1;
  }
  for (const issue of errors) console.error(`  error   ${issue.message} [${issue.rule}]`);
  for (const issue of warnings) console.warn(`  warning ${issue.message} [${issue.rule}]`);
  if (!ok) broken += 1;
}

if (broken > 0) {
  console.error(`\n${broken} of ${fixtures.length} fixture(s) did not validate`);
  process.exit(1);
}
console.log(`\n${fixtures.length} fixture(s) validate against the schema`);
