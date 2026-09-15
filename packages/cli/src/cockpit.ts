#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolveRef } from '@review-cockpit/analyzer';
import { analyzeCommand } from './commands/analyze.js';
import { cleanCommand } from './commands/clean.js';
import { compactCommand } from './commands/compact.js';
import { configCommand } from './commands/config.js';
import { doctorCommand } from './commands/doctor.js';
import { gcCommand, GC_DEFAULT_DAYS } from './commands/gc.js';
import { judgeCommand } from './commands/judge.js';
import { judgeMergeCommand } from './commands/judgeMerge.js';
import { markFailedCommand } from './commands/markFailed.js';
import { mergeCommand } from './commands/merge.js';
import { openCommand } from './commands/open.js';
import { prepareCommand } from './commands/prepare.js';
import { psCommand } from './commands/ps.js';
import type { OpenWhen } from './commands/run.js';
import { OPEN_WHEN, runCommand } from './commands/run.js';
import { serveCommand } from './commands/serve.js';
import type { StopSelector } from './commands/stop.js';
import { stopCommand } from './commands/stop.js';
import type { FileKind } from './commands/validate.js';
import { validateCommand } from './commands/validate.js';
import type { JudgmentMode } from '@review-cockpit/analyzer';
import { JUDGMENT_MODES } from '@review-cockpit/analyzer';
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
        'started-by': { type: 'string' },
        all: { type: 'boolean' },
        days: { type: 'string' },
        'dry-run': { type: 'boolean' },
        stage: { type: 'string' },
        message: { type: 'string' },
        open: { type: 'boolean' },
        'no-open': { type: 'boolean' },
        'reuse-server': { type: 'boolean' },
        'open-when': { type: 'string' },
        force: { type: 'boolean' },
        headless: { type: 'boolean' },
        model: { type: 'string' },
        timeout: { type: 'string' },
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
  if (command === 'ps') return psCommand();
  if (command === 'config') return configCommand(rest[0], rest[1]);

  if (command === 'gc') {
    const days = values.days === undefined ? GC_DEFAULT_DAYS : Number(values.days);
    if (!Number.isFinite(days) || days < 0) {
      return fail(`--days must be a number of days, not "${values.days}"`);
    }
    return gcCommand({ days, dryRun: values['dry-run'] === true });
  }

  if (command === 'stop') {
    const selector = stopSelector(values.all === true, values['started-by'], rest[0], cwd);
    if (selector === null) return fail('stop needs a pull request, --all, or --started-by <id>');
    return stopCommand({ selector });
  }

  const prCommands = [
    'run',
    'open',
    'prepare',
    'analyze',
    'compact',
    'judge',
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
      const openWhen = values['open-when'] ?? 'ready';
      if (!OPEN_WHEN.includes(openWhen as OpenWhen)) {
        return fail(`--open-when must be one of ${OPEN_WHEN.join(', ')}, not "${openWhen}"`);
      }
      if (values.judgment !== undefined && !JUDGMENT_MODES.includes(values.judgment as JudgmentMode)) {
        return fail(`--judgment must be one of ${JUDGMENT_MODES.join(', ')}, not "${values.judgment}"`);
      }
      return runCommand(prArg, {
        cwd,
        reuseServer: values['reuse-server'] === true,
        open: values['no-open'] !== true,
        openWhen: openWhen as OpenWhen,
        skipGraph: values['skip-graph'] === true,
        ...(values.judgment === undefined ? {} : { judgment: values.judgment as JudgmentMode }),
        ...(port === undefined ? {} : { port }),
        ...(idleMinutes === undefined ? {} : { idleMinutes }),
        ...(sessionId === undefined ? {} : { sessionId }),
      });
    }
    if (command === 'open') {
      return openCommand(prArg, { cwd, force: values.force === true });
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
    if (command === 'judge' || command === 'judge-prompt') {
      const minutes = values.timeout === undefined ? undefined : Number(values.timeout);
      if (minutes !== undefined && (!Number.isFinite(minutes) || minutes <= 0)) {
        return fail(`--timeout must be a number of minutes, not "${values.timeout}"`);
      }
      return judgeCommand(prArg, {
        cwd,
        headless: command === 'judge' && values.headless === true,
        ...(values.model === undefined ? {} : { model: values.model }),
        ...(minutes === undefined ? {} : { timeoutMinutes: minutes }),
      });
    }
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

/** A session id is a uuid, so `--started-by all` can only mean the hook's fallback. */
function stopSelector(
  all: boolean,
  startedBy: string | undefined,
  prArg: string | undefined,
  cwd: string,
): StopSelector | null {
  if (all || startedBy === 'all') return { kind: 'all' };
  if (startedBy !== undefined) return { kind: 'session', sessionId: startedBy };
  if (prArg !== undefined) return { kind: 'pr', ref: resolveRef(prArg, cwd) };
  return null;
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
