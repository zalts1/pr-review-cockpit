import { randomBytes } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SERVER_FILENAME } from './paths.js';

export interface ServerFile {
  port: number;
  pid: number;
  url: string;
  startedAt: string;
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
