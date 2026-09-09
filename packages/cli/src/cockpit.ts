#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { analyzeCommand } from './commands/analyze.js';
import { cleanCommand } from './commands/clean.js';
import { mergeCommand } from './commands/merge.js';
import { prepareCommand } from './commands/prepare.js';
import { serveCommand } from './commands/serve.js';
import type { FileKind } from './commands/validate.js';
import { validateCommand } from './commands/validate.js';

const usage = `cockpit — the PR review cockpit command line tool

Usage:
  cockpit prepare  <pr> [--cwd <dir>]
  cockpit analyze  <pr> [--expect-judgment] [--no-fold-generated] [--skip-graph] [--cwd <dir>]
  cockpit serve    <pr> [--port <n>] [--open] [--cwd <dir>]
  cockpit clean    <pr> [--cwd <dir>]
  cockpit validate <file> [--as document|judgment|drafts]
  cockpit merge <document> <judgment> [--out <file>]

<pr> is 123, owner/repo#123, or a GitHub pull request URL. A bare number is
read against the GitHub remote of the repository holding the working directory.

prepare   Resolves the pull request through gh and checks it out: a worktree on
          a local clone when one is found, a cached clone when not. Prints the
          checkout as JSON.

analyze   Runs prepare, then stage 1 (diff, git signals, tree-sitter structure,
          risk) and stage 3 (the Go call graph), writing review.json into the
          cache directory. Progress and timings go to stderr, the document path
          to stdout. --no-fold-generated keeps generated files unfolded and
          scored, and still records the rule that matched them.
          --expect-judgment says a judgment pass will follow, so the stage 2
          sections read as pending. Without it they carry the message
          "not-attached" and the cockpit says "Not analyzed" rather than
          "Analyzing…". The review skill always passes it.

serve     Serves the cockpit and the document on 127.0.0.1 and pushes every
          change to review.json over server-sent events. Prints the URL.

clean     Stops the server, removes the worktree and the review-cockpit ref,
          and keeps review.json.

validate  Checks a file against its JSON Schema and the referential rules.
          The kind is detected from the file unless --as says otherwise.
          Prints every error and warning and exits non-zero on an error.

merge     Applies a judgment file to a review document: clamps risk to the
          floor, assigns group ids, renumbers the walk, caps the reasons and
          recomputes the counts. Prints the log of everything it dropped or
          clamped. Writes the merged document to --out, or to stdout.
`;

const kinds: FileKind[] = ['document', 'judgment', 'drafts'];

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        as: { type: 'string' },
        out: { type: 'string' },
        cwd: { type: 'string' },
        port: { type: 'string' },
        open: { type: 'boolean' },
        'no-fold-generated': { type: 'boolean' },
        'expect-judgment': { type: 'boolean' },
        'skip-graph': { type: 'boolean' },
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

  const cwd = values.cwd ?? process.cwd();

  if (command === 'prepare' || command === 'analyze' || command === 'serve' || command === 'clean') {
    const [prArg] = rest;
    if (prArg === undefined) return fail(`${command} needs a pull request`);

    if (command === 'prepare') return prepareCommand(prArg, cwd);
    if (command === 'analyze') {
      return analyzeCommand(prArg, {
        cwd,
        foldGenerated: values['no-fold-generated'] !== true,
        skipGraph: values['skip-graph'] === true,
        expectJudgment: values['expect-judgment'] === true,
      });
    }
    if (command === 'serve') {
      const port = values.port === undefined ? undefined : Number(values.port);
      if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
        return fail(`--port must be a port number, not "${values.port}"`);
      }
      return serveCommand(prArg, {
        cwd,
        open: values.open === true,
        ...(port === undefined ? {} : { port }),
      });
    }
    return cleanCommand(prArg, cwd);
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
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
