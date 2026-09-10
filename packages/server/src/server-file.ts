import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SERVER_FILENAME } from './paths.js';

export interface ServerFile {
  port: number;
  pid: number;
  url: string;
  startedAt: string;
  /**
   * Proof of identity for `cockpit stop`. A pid on its own is not enough: pids are reused, and
   * a stale server.json would otherwise name a process that has nothing to do with the cockpit.
   * `/api/health` answers with the same token, so a match says the process on that port wrote
   * this file.
   */
  token: string;
  /** The Claude Code session that ran `cockpit run`, when it named itself. */
  sessionId?: string;
}

export function newServerToken(): string {
  return randomBytes(16).toString('hex');
}

export async function writeServerFile(prDir: string, contents: ServerFile): Promise<void> {
  const target = join(prDir, SERVER_FILENAME);
  const temp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, `${JSON.stringify(contents, null, 2)}\n`, 'utf8');
  try {
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export function readServerFile(prDir: string): ServerFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(prDir, SERVER_FILENAME), 'utf8'));
  } catch {
    return null;
  }
  const file = parsed as Partial<ServerFile> | null;
  if (typeof file?.pid !== 'number' || typeof file.port !== 'number') return null;
  return {
    port: file.port,
    pid: file.pid,
    url: file.url ?? `http://127.0.0.1:${file.port}`,
    startedAt: file.startedAt ?? '',
    token: typeof file.token === 'string' ? file.token : '',
    ...(typeof file.sessionId === 'string' ? { sessionId: file.sessionId } : {}),
  };
}

export function serverIsAlive(file: ServerFile): boolean {
  return pidIsAlive(file.pid);
}

/** Signal 0 asks the kernel whether the process exists without touching it. */
export function pidIsAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function removeServerFile(prDir: string, pid: number): Promise<void> {
  const target = join(prDir, SERVER_FILENAME);
  let raw: string;
  try {
    raw = await readFile(target, 'utf8');
  } catch {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!isServerFileForPid(parsed, pid)) return;
  await unlink(target).catch(() => undefined);
}

function isServerFileForPid(value: unknown, pid: number): boolean {
  return typeof value === 'object' && value !== null && (value as { pid?: unknown }).pid === pid;
}
