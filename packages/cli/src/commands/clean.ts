import { existsSync, readFileSync, rmSync } from 'node:fs';
import {
  cloneDir,
  documentFile,
  draftsFile,
  git,
  prRefName,
  readDocument,
  resolveRef,
  serverFile,
  worktreeDir,
} from '@review-cockpit/analyzer';

export function cleanCommand(prArg: string, cwd: string): number {
  const ref = resolveRef(prArg, cwd);
  const done: string[] = [];

  const server = serverFile(ref);
  if (existsSync(server)) {
    const { pid } = JSON.parse(readFileSync(server, 'utf8')) as { pid?: number };
    if (typeof pid === 'number' && pid !== process.pid) {
      try {
        process.kill(pid, 'SIGTERM');
        done.push(`stopped the server (pid ${pid})`);
      } catch {
        done.push(`no server running for pid ${pid}`);
      }
    }
    rmSync(server, { force: true });
  }

  const document = documentFile(ref);
  const host = existsSync(document) ? (readDocument(document).checkout.sourceRepo ?? cloneDir(ref)) : cloneDir(ref);
  const worktree = worktreeDir(ref);

  if (existsSync(worktree)) {
    const removed = git(host, ['worktree', 'remove', '--force', worktree]);
    rmSync(worktree, { recursive: true, force: true });
    done.push(removed.code === 0 ? `removed the worktree from ${host}` : `deleted ${worktree}`);
  }

  const refName = prRefName(ref);
  if (git(host, ['rev-parse', '--verify', '--quiet', refName]).code === 0) {
    git(host, ['update-ref', '-d', refName]);
    done.push(`deleted ${refName} from ${host}`);
  }

  const drafts = draftsFile(ref);
  for (const line of done) console.error(`[clean] ${line}`);
  console.error(`[clean] kept ${document}${existsSync(drafts) ? ` and ${drafts}` : ''}`);
  return 0;
}
