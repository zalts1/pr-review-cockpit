import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { join } from 'node:path';
import { prFromPath } from './drafts.js';

const LOG_FILENAME = 'log.txt';

export interface FinishHooks {
  /** Starts the teardown, which has to outlive the process it is started from. */
  clean(purge: boolean): void;
  exit(): void;
}

/**
 * The teardown is a detached `cockpit clean` rather than work done here: the server is one of
 * the things being removed, so it cannot be the process that waits for its own removal.
 */
export function detachedClean(prDir: string, cliEntry: string | undefined): FinishHooks {
  return {
    clean(purge) {
      if (cliEntry === undefined) return;
      const pr = prFromPath(prDir);
      const output = logOutput(prDir);
      const child = spawn(
        process.execPath,
        [
          cliEntry,
          'clean',
          `${pr.owner}/${pr.repo}#${pr.number}`,
          ...(purge ? ['--purge'] : []),
          '--yes',
        ],
        { detached: true, stdio: ['ignore', output, output] },
      );
      child.unref();
    },
    exit() {
      process.exit(0);
    },
  };
}

function logOutput(prDir: string): number | 'ignore' {
  try {
    return openSync(join(prDir, LOG_FILENAME), 'a');
  } catch {
    return 'ignore';
  }
}
