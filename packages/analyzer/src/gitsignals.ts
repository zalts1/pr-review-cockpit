import { run } from './exec.js';
import { BUGFIX_SUBJECT } from './patterns.js';

export interface CommitRecord {
  sha: string;
  timestamp: number;
  email: string;
  subject: string;
  files: string[];
}

export interface FileHistory {
  churnCommits90d: number;
  bugfixCommits: number;
  authorPriorCommits: number;
}

const RECORD = /^([0-9a-f]{40})\t(\d+)\t([^\t]*)\t(.*)$/;

export const LOG_FORMAT = '%H%x09%ct%x09%ae%x09%s';

export function parseLogPass(text: string): CommitRecord[] {
  const records: CommitRecord[] = [];
  let current: CommitRecord | null = null;

  for (const line of text.split('\n')) {
    const header = RECORD.exec(line);
    if (header) {
      current = {
        sha: header[1] as string,
        timestamp: Number(header[2]),
        email: (header[3] as string).toLowerCase(),
        subject: header[4] as string,
        files: [],
      };
      records.push(current);
      continue;
    }
    if (line.trim() === '' || !current) continue;
    current.files.push(line);
  }

  return records;
}

export const NINETY_DAYS = 90 * 24 * 60 * 60;

export function aggregate(
  records: readonly CommitRecord[],
  paths: ReadonlySet<string>,
  authorEmails: ReadonlySet<string>,
  now: number,
): Map<string, FileHistory> {
  const out = new Map<string, FileHistory>();
  for (const path of paths) {
    out.set(path, { churnCommits90d: 0, bugfixCommits: 0, authorPriorCommits: 0 });
  }

  const cutoff = now - NINETY_DAYS;
  for (const record of records) {
    const recent = record.timestamp >= cutoff;
    const bugfix = recent && BUGFIX_SUBJECT.test(record.subject);
    const byAuthor = authorEmails.has(record.email);
    if (!recent && !byAuthor) continue;

    for (const file of record.files) {
      const entry = out.get(file);
      if (!entry) continue;
      if (recent) entry.churnCommits90d += 1;
      if (bugfix) entry.bugfixCommits += 1;
      if (byAuthor) entry.authorPriorCommits += 1;
    }
  }

  return out;
}

export interface GitSignalsOptions {
  repo: string;
  baseSha: string;
  paths: ReadonlySet<string>;
  authorEmails: ReadonlySet<string>;
  now?: number;
}

/**
 * One log pass for the whole pull request: cost does not grow with the number
 * of changed files. Rename following is left out, so a file renamed inside the
 * two-year window reports the history of its current path only.
 */
export function gitSignals(options: GitSignalsOptions): Map<string, FileHistory> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const result = run('git', [
    '-c',
    'core.quotePath=false',
    '-C',
    options.repo,
    'log',
    options.baseSha,
    '--since=2.years',
    `--format=${LOG_FORMAT}`,
    '--name-only',
  ]);
  if (result.code !== 0) return new Map();
  return aggregate(parseLogPass(result.stdout), options.paths, options.authorEmails, now);
}
