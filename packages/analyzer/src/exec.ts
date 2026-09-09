import { spawnSync } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
}

// A single git log or git grep over a two-year history can exceed the 1 MB
// spawnSync default and would be silently truncated.
const MAX_BUFFER = 512 * 1024 * 1024;

export function run(command: string, args: string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });

  if (result.error) {
    const reason = (result.error as NodeJS.ErrnoException).code === 'ENOENT'
      ? `${command} is not on PATH`
      : result.error.message;
    return { code: 127, stdout: '', stderr: reason };
  }

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export class CommandFailed extends Error {
  constructor(
    readonly command: string,
    readonly args: string[],
    readonly result: RunResult,
  ) {
    const shown = [command, ...args].join(' ');
    const detail = (result.stderr.trim() || result.stdout.trim()).split('\n').slice(0, 5).join('\n');
    super(`${shown} exited ${result.code}\n${detail}`);
    this.name = 'CommandFailed';
  }
}

export function runOk(command: string, args: string[], options: RunOptions = {}): string {
  const result = run(command, args, options);
  if (result.code !== 0) throw new CommandFailed(command, args, result);
  return result.stdout;
}

export function git(cwd: string, args: string[]): RunResult {
  return run('git', ['-C', cwd, ...args]);
}

export function gitOk(cwd: string, args: string[]): string {
  return runOk('git', ['-C', cwd, ...args]);
}
