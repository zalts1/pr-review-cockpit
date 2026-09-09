#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mergeCommand } from './commands/merge.js';
import type { FileKind } from './commands/validate.js';
import { validateCommand } from './commands/validate.js';

const usage = `cockpit — the PR review cockpit command line tool

Usage:
  cockpit validate <file> [--as document|judgment|drafts]
  cockpit merge <document> <judgment> [--out <file>]

validate  Checks a file against its JSON Schema and the referential rules.
          The kind is detected from the file unless --as says otherwise.
          Prints every error and warning and exits non-zero on an error.

merge     Applies a judgment file to a review document: clamps risk to the
          floor, assigns group ids, renumbers the walk, caps the reasons and
          recomputes the counts. Prints the log of everything it dropped or
          clamped. Writes the merged document to --out, or to stdout.
`;

const kinds: FileKind[] = ['document', 'judgment', 'drafts'];

function main(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        as: { type: 'string' },
        out: { type: 'string' },
      },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`\n${usage}`);
    return 2;
  }

  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;

  if (values.help || command === undefined) {
    console.log(usage);
    return command === undefined && !values.help ? 2 : 0;
  }

  if (command === 'validate') {
    const [file] = rest;
    if (file === undefined) return fail('validate needs one file');
    if (values.as !== undefined && !kinds.includes(values.as as FileKind)) {
      return fail(`--as must be one of ${kinds.join(', ')}`);
    }
    return validateCommand(file, values.as as FileKind | undefined);
  }

  if (command === 'merge') {
    const [documentFile, judgmentFile] = rest;
    if (documentFile === undefined || judgmentFile === undefined) {
      return fail('merge needs a document and a judgment file');
    }
    return mergeCommand(documentFile, judgmentFile, values.out);
  }

  return fail(`unknown command "${command}"`);
}

function fail(message: string): number {
  console.error(`${message}\n\n${usage}`);
  return 2;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
