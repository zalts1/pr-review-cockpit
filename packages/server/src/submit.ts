import { spawnSync } from 'node:child_process';
import type { Draft, DraftsFile } from '@review-cockpit/schema';
import { documentHead, readDrafts, rotateSubmittedDrafts } from './drafts.js';

export type Verdict = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';

export const VERDICTS: readonly Verdict[] = ['COMMENT', 'REQUEST_CHANGES', 'APPROVE'];

export interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Injected so a test posts nothing; the default runs the gh command line. */
export type GhCommand = (args: readonly string[], input?: string) => GhResult;

export const ghCommand: GhCommand = (args, input) => {
  const result = spawnSync('gh', [...args], {
    ...(input === undefined ? {} : { input }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    const reason =
      (result.error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'gh is not on PATH. Install the GitHub CLI and run gh auth login.'
        : result.error.message;
    return { code: 127, stdout: '', stderr: reason };
  }
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

export interface ReviewComment {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
  body: string;
}

export interface ReviewPayload {
  commit_id: string;
  body: string;
  event: Verdict;
  comments: ReviewComment[];
}

export interface SubmitRequest {
  prDir: string;
  gh: GhCommand;
  verdict: Verdict;
  summaryBody: string;
  now?: Date;
}

export type SubmitBody =
  | { url: string; id: number; comments: number; submitted: string }
  | { code: 'head_moved'; expected: string; actual: string; message: string }
  | { code: 'own_pr'; message: string }
  | { code: 'gh_failed'; message: string; exitCode: number }
  | { code: 'no_document'; message: string };

export interface SubmitOutcome {
  status: number;
  body: SubmitBody;
}

export function reviewPayload(drafts: readonly Draft[], commitId: string, body: string, event: Verdict): ReviewPayload {
  return {
    commit_id: commitId,
    body,
    event,
    comments: drafts.map((draft) => ({
      path: draft.path,
      line: draft.line,
      side: draft.side,
      ...(draft.startLine === null || draft.startSide === null
        ? {}
        : { start_line: draft.startLine, start_side: draft.startSide }),
      body: draft.body,
    })),
  };
}

const OWN_PR = /can ?not (?:approve|request changes on) your own pull request/i;

/**
 * The drafts come off disk rather than out of the request, so what the dry-run
 * list showed is what GitHub is asked to post.
 */
export async function submitReview(request: SubmitRequest): Promise<SubmitOutcome> {
  const now = request.now ?? new Date();
  const head = await documentHead(request.prDir);
  if (head === null) {
    return {
      status: 503,
      body: {
        code: 'no_document',
        message:
          'There is no analysed review document for this pull request, so there is no head commit to bind the comments to. Run cockpit analyze first.',
      },
    };
  }

  const drafts = await readDrafts(request.prDir, now.toISOString());
  const pr = drafts.pr;
  const slug = `${pr.owner}/${pr.repo}`;

  const view = request.gh(['pr', 'view', String(pr.number), '--repo', slug, '--json', 'headRefOid']);
  if (view.code !== 0) return ghFailure(view);

  const actual = parseHeadRefOid(view.stdout);
  if (actual === null) {
    return {
      status: 502,
      body: {
        code: 'gh_failed',
        message: `gh pr view did not report a head commit: ${firstLines(view.stdout)}`,
        exitCode: view.code,
      },
    };
  }
  if (actual !== head) {
    return {
      status: 409,
      body: {
        code: 'head_moved',
        expected: head,
        actual,
        message: `The pull request head moved from ${head.slice(0, 7)} to ${actual.slice(0, 7)} since this review was analysed.`,
      },
    };
  }

  const payload = reviewPayload(drafts.drafts, head, request.summaryBody, request.verdict);
  const post = request.gh(
    ['api', `repos/${slug}/pulls/${pr.number}/reviews`, '-X', 'POST', '--input', '-'],
    `${JSON.stringify(payload)}\n`,
  );
  if (post.code !== 0) return ghFailure(post);

  const created = parseCreatedReview(post.stdout);
  if (created === null) {
    return {
      status: 502,
      body: {
        code: 'gh_failed',
        message: `The review was posted but gh returned no review url: ${firstLines(post.stdout)}`,
        exitCode: post.code,
      },
    };
  }

  const posted: DraftsFile = {
    ...drafts,
    verdict: request.verdict,
    summaryBody: request.summaryBody,
    updatedAt: now.toISOString(),
  };
  delete posted.orphaned;
  const submitted = await rotateSubmittedDrafts(request.prDir, posted, now);

  return {
    status: 200,
    body: { url: created.url, id: created.id, comments: payload.comments.length, submitted },
  };
}

function ghFailure(result: GhResult): SubmitOutcome {
  const text = `${result.stderr}\n${result.stdout}`;
  if (OWN_PR.test(text)) {
    return {
      status: 422,
      body: {
        code: 'own_pr',
        message: 'GitHub does not let you approve or request changes on your own pull request. Post it as a comment review instead.',
      },
    };
  }
  return {
    status: 502,
    body: {
      code: 'gh_failed',
      message: firstLines(result.stderr) || firstLines(result.stdout) || 'gh failed and said nothing.',
      exitCode: result.code,
    },
  };
}

function firstLines(text: string, count = 5): string {
  return text.trim().split('\n').slice(0, count).join('\n').trim();
}

function parseHeadRefOid(stdout: string): string | null {
  try {
    const value = (JSON.parse(stdout) as { headRefOid?: unknown }).headRefOid;
    return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function parseCreatedReview(stdout: string): { url: string; id: number } | null {
  try {
    const value = JSON.parse(stdout) as { html_url?: unknown; id?: unknown };
    if (typeof value.html_url !== 'string' || typeof value.id !== 'number') return null;
    return { url: value.html_url, id: value.id };
  } catch {
    return null;
  }
}
