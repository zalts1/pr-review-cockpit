#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { analyzeCommand } from './commands/analyze.js';
import { cleanCommand } from './commands/clean.js';
import { compactCommand } from './commands/compact.js';
import { doctorCommand } from './commands/doctor.js';
import { judgeMergeCommand } from './commands/judgeMerge.js';
import { judgePromptCommand } from './commands/judgePrompt.js';
import { markFailedCommand } from './commands/markFailed.js';
import { mergeCommand } from './commands/merge.js';
import { prepareCommand } from './commands/prepare.js';
import { runCommand } from './commands/run.js';
import { serveCommand } from './commands/serve.js';
import type { FileKind } from './commands/validate.js';
import { validateCommand } from './commands/validate.js';
import { sessionIdFromEnv } from './session.js';
import { usage } from './usage.js';

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
        judgment: { type: 'string' },
        port: { type: 'string' },
        'idle-minutes': { type: 'string' },
        session: { type: 'string' },
        stage: { type: 'string' },
        message: { type: 'string' },
        open: { type: 'boolean' },
        'no-open': { type: 'boolean' },
        'reuse-server': { type: 'boolean' },
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

  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    return fail(`--port must be a port number, not "${values.port}"`);
  }

  const idleMinutes = values['idle-minutes'] === undefined ? undefined : Number(values['idle-minutes']);
  if (idleMinutes !== undefined && (!Number.isFinite(idleMinutes) || idleMinutes < 0)) {
    return fail(`--idle-minutes must be minutes, or 0 to never stop, not "${values['idle-minutes']}"`);
  }

  const sessionId = values.session ?? sessionIdFromEnv();

  if (command === 'doctor') return doctorCommand();

  const prCommands = [
    'run',
    'prepare',
    'analyze',
    'compact',
    'judge-prompt',
    'judge-merge',
    'mark-failed',
    'serve',
    'clean',
  ];

  if (prCommands.includes(command)) {
    const [prArg] = rest;
    if (prArg === undefined) return fail(`${command} needs a pull request`);

    if (command === 'run') {
      return runCommand(prArg, {
        cwd,
        reuseServer: values['reuse-server'] === true,
        open: values['no-open'] !== true,
        skipGraph: values['skip-graph'] === true,
        ...(port === undefined ? {} : { port }),
        ...(idleMinutes === undefined ? {} : { idleMinutes }),
        ...(sessionId === undefined ? {} : { sessionId }),
      });
    }
    if (command === 'prepare') return prepareCommand(prArg, cwd);
    if (command === 'analyze') {
      return analyzeCommand(prArg, {
        cwd,
        foldGenerated: values['no-fold-generated'] !== true,
        skipGraph: values['skip-graph'] === true,
        expectJudgment: values['expect-judgment'] === true,
      });
    }
    if (command === 'compact') return compactCommand(prArg, cwd);
    if (command === 'judge-prompt') return judgePromptCommand(prArg, cwd);
    if (command === 'judge-merge') {
      return judgeMergeCommand(prArg, {
        cwd,
        ...(values.judgment === undefined ? {} : { judgment: values.judgment }),
      });
    }
    if (command === 'mark-failed') {
      if (values.stage === undefined || values.message === undefined) {
        return fail('mark-failed needs --stage 2 and --message "<one line>"');
      }
      return markFailedCommand(prArg, { cwd, stage: values.stage, message: values.message });
    }
    if (command === 'serve') {
      return serveCommand(prArg, {
        cwd,
        open: values.open === true,
        ...(port === undefined ? {} : { port }),
        ...(idleMinutes === undefined ? {} : { idleMinutes }),
        ...(sessionId === undefined ? {} : { sessionId }),
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
