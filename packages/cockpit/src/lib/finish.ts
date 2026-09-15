export const FINISH_URL = '/api/finish';

export type FinishResult =
  /** The server accepted it and is shutting down; the end state waits for its shutdown event. */
  | { kind: 'finishing'; purge: boolean }
  | { kind: 'unsent_drafts'; count: number }
  | { kind: 'refused'; message: string };

interface FinishBody {
  status?: string;
  purge?: boolean;
  code?: string;
  count?: number;
  message?: string;
  error?: string;
}

export async function finishReview(purge: boolean, confirmDrafts: boolean): Promise<FinishResult> {
  let response: Response;
  try {
    response = await fetch(FINISH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purge, confirmDrafts }),
    });
  } catch (error) {
    return {
      kind: 'refused',
      message: `The local server did not answer: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const body = (await response.json().catch(() => ({}))) as FinishBody;

  if (response.ok && body.status === 'finishing') {
    return { kind: 'finishing', purge: body.purge === true };
  }
  if (body.code === 'unsent_drafts') {
    return { kind: 'unsent_drafts', count: body.count ?? 0 };
  }
  return {
    kind: 'refused',
    message: body.message ?? body.error ?? `The server answered ${response.status}.`,
  };
}
