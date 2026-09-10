export const REFRESH_URL = '/api/refresh';

export type RefreshResult =
  | { kind: 'done'; comments: number; checks: number }
  | { kind: 'failed'; message: string };

/**
 * Asks the server to re-read the comments and the checks from GitHub. The new document
 * arrives over the event stream like any other rewrite, so nothing here touches the page.
 */
export async function refreshFromGitHub(): Promise<RefreshResult> {
  let response: Response;
  try {
    response = await fetch(REFRESH_URL, { method: 'POST' });
  } catch (error) {
    return {
      kind: 'failed',
      message: `The local server did not answer: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const body = (await response.json().catch(() => ({}))) as {
    comments?: number;
    checks?: number;
    message?: string;
    error?: string;
  };

  if (!response.ok) {
    return {
      kind: 'failed',
      message: body.message ?? body.error ?? `The server answered ${response.status}.`,
    };
  }
  return { kind: 'done', comments: body.comments ?? 0, checks: body.checks ?? 0 };
}
