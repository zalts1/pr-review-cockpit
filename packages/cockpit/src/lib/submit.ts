import type { DraftsFile } from '@review-cockpit/schema';

export const SUBMIT_URL = '/api/submit';

export type Verdict = Exclude<DraftsFile['verdict'], null>;

export type SubmitResult =
  | { kind: 'posted'; url: string; comments: number }
  | { kind: 'head_moved'; expected: string; actual: string }
  | { kind: 'refused'; message: string };

interface SubmitError {
  code?: string;
  message?: string;
  expected?: string;
  actual?: string;
  error?: string;
}

/**
 * Posts the review. The drafts are not in the request: the server reads them
 * from the file it served, so what the dry-run list showed is what is posted.
 */
export async function postReview(verdict: Verdict, summaryBody: string): Promise<SubmitResult> {
  let response: Response;
  try {
    response = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict, summaryBody }),
    });
  } catch (error) {
    return {
      kind: 'refused',
      message: `The local server did not answer: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const body = (await response.json().catch(() => ({}))) as SubmitError & {
    url?: string;
    comments?: number;
  };

  if (response.ok && typeof body.url === 'string') {
    return { kind: 'posted', url: body.url, comments: body.comments ?? 0 };
  }
  if (body.code === 'head_moved') {
    return { kind: 'head_moved', expected: body.expected ?? '', actual: body.actual ?? '' };
  }
  return {
    kind: 'refused',
    message: body.message ?? body.error ?? `The server answered ${response.status}.`,
  };
}
