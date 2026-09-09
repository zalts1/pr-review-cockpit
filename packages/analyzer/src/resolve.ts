import type { PrInfo } from '@review-cockpit/schema';
import { run, runOk } from './exec.js';
import type { PrRef } from './paths.js';

export interface RemoteRepo {
  owner: string;
  repo: string;
}

const GITHUB_REMOTE = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/;

export function parseRemoteUrl(url: string): RemoteRepo | null {
  const match = GITHUB_REMOTE.exec(url.trim());
  if (!match) return null;
  return { owner: match[1] as string, repo: match[2] as string };
}

export function repoRoot(cwd: string): string | null {
  const result = run('git', ['-C', cwd, 'rev-parse', '--show-toplevel']);
  return result.code === 0 ? result.stdout.trim() : null;
}

export function githubRemote(repoPath: string): RemoteRepo | null {
  const result = run('git', ['-C', repoPath, 'remote', '-v']);
  if (result.code !== 0) return null;

  const byName = new Map<string, RemoteRepo>();
  for (const line of result.stdout.split('\n')) {
    const [name, rest] = line.split('\t');
    if (!name || !rest) continue;
    const parsed = parseRemoteUrl(rest.split(' ')[0] ?? '');
    if (parsed && !byName.has(name)) byName.set(name, parsed);
  }

  return (
    byName.get('origin') ?? byName.get('upstream') ?? [...byName.values()][0] ?? null
  );
}

export interface ParsedArg {
  owner: string | null;
  repo: string | null;
  number: number;
}

export function parsePrArg(arg: string): ParsedArg {
  const trimmed = arg.trim();

  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(trimmed);
  if (url) {
    return { owner: url[1] as string, repo: url[2] as string, number: Number(url[3]) };
  }

  const short = /^([^/\s]+)\/([^#\s]+)#(\d+)$/.exec(trimmed);
  if (short) {
    return { owner: short[1] as string, repo: short[2] as string, number: Number(short[3]) };
  }

  const bare = /^#?(\d+)$/.exec(trimmed);
  if (bare) return { owner: null, repo: null, number: Number(bare[1]) };

  throw new Error(
    `"${arg}" is not a pull request. Use 123, owner/repo#123, or a GitHub pull request URL.`,
  );
}

/** Resolves the argument to owner, repo and number without calling GitHub. */
export function resolveRef(arg: string, cwd: string): PrRef {
  const parsed = parsePrArg(arg);
  if (parsed.owner !== null && parsed.repo !== null) {
    return { owner: parsed.owner, repo: parsed.repo, number: parsed.number };
  }

  const root = repoRoot(cwd);
  const remote = root === null ? null : githubRemote(root);
  if (!remote) {
    throw new Error(
      `A bare pull request number needs a GitHub clone: ${cwd} is not inside one, or it has no github.com remote. Pass owner/repo#${parsed.number} instead.`,
    );
  }
  return { ...remote, number: parsed.number };
}

interface GhPr {
  number: number;
  title: string;
  body: string;
  author: { login: string } | null;
  isDraft: boolean;
  labels: Array<{ name: string }>;
  baseRefName: string;
  baseRefOid: string;
  headRefName: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  url: string;
  commits: Array<{ oid: string; authors?: Array<{ email?: string; login?: string }> }>;
}

const GH_FIELDS = [
  'number',
  'title',
  'body',
  'author',
  'isDraft',
  'labels',
  'baseRefName',
  'baseRefOid',
  'headRefName',
  'headRefOid',
  'additions',
  'deletions',
  'changedFiles',
  'url',
  'commits',
].join(',');

export function requireGhAuth(): void {
  const result = run('gh', ['auth', 'status']);
  if (result.code === 0) return;
  const detail = (result.stderr || result.stdout).trim().split('\n')[0] ?? '';
  throw new Error(`gh is not authenticated (${detail}). Run: gh auth login`);
}

export interface ResolvedPr {
  ref: PrRef;
  pr: PrInfo;
  /** Committer emails on the pull request's own commits, lowercased. */
  authorEmails: string[];
  commitShas: string[];
}

export function resolvePr(arg: string, cwd: string): ResolvedPr {
  const ref = resolveRef(arg, cwd);
  requireGhAuth();

  const raw = runOk('gh', [
    'pr',
    'view',
    String(ref.number),
    '-R',
    `${ref.owner}/${ref.repo}`,
    '--json',
    GH_FIELDS,
  ]);
  const view = JSON.parse(raw) as GhPr;

  const emails = new Set<string>();
  for (const commit of view.commits) {
    for (const author of commit.authors ?? []) {
      if (author.email) emails.add(author.email.toLowerCase());
    }
  }

  const pr: PrInfo = {
    owner: ref.owner,
    repo: ref.repo,
    number: view.number,
    url: view.url,
    title: view.title,
    body: view.body,
    author: view.author?.login ?? '',
    draft: view.isDraft,
    labels: view.labels.map((label) => label.name),
    base: { ref: view.baseRefName, sha: view.baseRefOid },
    head: { ref: view.headRefName, sha: view.headRefOid },
    additions: view.additions,
    deletions: view.deletions,
    changedFiles: view.changedFiles,
  };

  return {
    ref,
    pr,
    authorEmails: [...emails],
    commitShas: view.commits.map((commit) => commit.oid),
  };
}
