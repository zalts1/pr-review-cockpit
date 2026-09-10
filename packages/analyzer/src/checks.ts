import type { Check, CheckStatus } from '@review-cockpit/schema';

export interface GhCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  details_url?: string | null;
  html_url?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  app?: { slug?: string; name?: string } | null;
}

export interface GhCommitStatus {
  context: string;
  state: string;
  target_url?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

const CONCLUSIONS: Record<string, CheckStatus> = {
  success: 'success',
  failure: 'failure',
  timed_out: 'failure',
  action_required: 'failure',
  startup_failure: 'failure',
  neutral: 'neutral',
  skipped: 'skipped',
  cancelled: 'cancelled',
  stale: 'cancelled',
};

const STATES: Record<string, CheckStatus> = {
  success: 'success',
  failure: 'failure',
  error: 'failure',
  pending: 'pending',
};

/** A run that has not completed is pending whatever its conclusion field says. */
export function checkRunStatus(status: string, conclusion: string | null): CheckStatus {
  if (status !== 'completed') return 'pending';
  if (conclusion === null) return 'pending';
  return CONCLUSIONS[conclusion] ?? 'neutral';
}

export function commitStatusStatus(state: string): CheckStatus {
  return STATES[state] ?? 'neutral';
}

/** A check with the time the dedupe ranks it by, which the document does not carry. */
export interface TimedCheck {
  check: Check;
  at: string;
}

export function mapCheckRuns(runs: readonly GhCheckRun[], fallbackUrl: string): TimedCheck[] {
  return runs.map((run) => ({
    check: {
      name: run.name,
      app: run.app?.slug ?? run.app?.name ?? '',
      status: checkRunStatus(run.status, run.conclusion),
      url: run.details_url || run.html_url || fallbackUrl,
      completedAt: run.completed_at ?? null,
    },
    at: run.completed_at ?? run.started_at ?? '',
  }));
}

export function mapCommitStatuses(
  statuses: readonly GhCommitStatus[],
  fallbackUrl: string,
): TimedCheck[] {
  return statuses.map((status) => ({
    check: {
      name: status.context,
      app: status.context,
      status: commitStatusStatus(status.state),
      url: status.target_url || fallbackUrl,
      completedAt: status.state === 'pending' ? null : (status.updated_at ?? null),
    },
    at: status.updated_at ?? status.created_at ?? '',
  }));
}

/**
 * One entry per name, the latest by completion time. A workflow re-run leaves
 * both attempts on the commit, and the older one is not what the reviewer is
 * looking at.
 */
export function dedupeChecks(entries: readonly TimedCheck[]): Check[] {
  const latest = new Map<string, TimedCheck>();
  for (const entry of entries) {
    const held = latest.get(entry.check.name);
    if (held === undefined || entry.at > held.at) latest.set(entry.check.name, entry);
  }
  return [...latest.values()].map((entry) => entry.check);
}

export function countByStatus(checks: readonly Check[]): Record<CheckStatus, number> {
  const counts: Record<CheckStatus, number> = {
    success: 0,
    failure: 0,
    pending: 0,
    neutral: 0,
    skipped: 0,
    cancelled: 0,
  };
  for (const check of checks) counts[check.status] += 1;
  return counts;
}
