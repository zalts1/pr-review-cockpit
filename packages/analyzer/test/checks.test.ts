import { describe, expect, it } from 'vitest';
import {
  checkRunStatus,
  commitStatusStatus,
  countByStatus,
  dedupeChecks,
  mapCheckRuns,
  mapCommitStatuses,
} from '../src/checks.js';
import type { GhCheckRun } from '../src/checks.js';

const PR_URL = 'https://github.com/northwind-labs/tenant-platform/pull/7';

function run(over: Partial<GhCheckRun> = {}): GhCheckRun {
  return {
    name: 'lint-and-test',
    status: 'completed',
    conclusion: 'success',
    details_url: 'https://github.com/northwind-labs/tenant-platform/actions/runs/1/job/1',
    html_url: 'https://github.com/northwind-labs/tenant-platform/runs/1',
    started_at: '2026-09-08T11:00:00Z',
    completed_at: '2026-09-08T11:02:00Z',
    app: { slug: 'github-actions', name: 'GitHub Actions' },
    ...over,
  };
}

describe('checkRunStatus', () => {
  it.each([
    ['completed', 'success', 'success'],
    ['completed', 'failure', 'failure'],
    ['completed', 'timed_out', 'failure'],
    ['completed', 'action_required', 'failure'],
    ['completed', 'neutral', 'neutral'],
    ['completed', 'skipped', 'skipped'],
    ['completed', 'cancelled', 'cancelled'],
    ['completed', 'stale', 'cancelled'],
  ])('maps %s/%s to %s', (status, conclusion, expected) => {
    expect(checkRunStatus(status, conclusion)).toBe(expected);
  });

  it('is pending while the run has not completed, whatever the conclusion says', () => {
    expect(checkRunStatus('in_progress', null)).toBe('pending');
    expect(checkRunStatus('queued', 'success')).toBe('pending');
    expect(checkRunStatus('completed', null)).toBe('pending');
  });

  it('calls a conclusion it does not know neutral', () => {
    expect(checkRunStatus('completed', 'inconclusive')).toBe('neutral');
  });
});

describe('commitStatusStatus', () => {
  it('maps the four legacy states', () => {
    expect(commitStatusStatus('success')).toBe('success');
    expect(commitStatusStatus('failure')).toBe('failure');
    expect(commitStatusStatus('error')).toBe('failure');
    expect(commitStatusStatus('pending')).toBe('pending');
  });
});

describe('mapCheckRuns', () => {
  it('names the app by its slug and links to the job', () => {
    const [mapped] = mapCheckRuns([run()], PR_URL);
    expect(mapped?.check).toEqual({
      name: 'lint-and-test',
      app: 'github-actions',
      status: 'success',
      url: 'https://github.com/northwind-labs/tenant-platform/actions/runs/1/job/1',
      completedAt: '2026-09-08T11:02:00Z',
    });
  });

  it('falls back to the check page and then to the pull request', () => {
    const [withHtml] = mapCheckRuns([run({ details_url: null })], PR_URL);
    expect(withHtml?.check.url).toBe('https://github.com/northwind-labs/tenant-platform/runs/1');
    const [withNeither] = mapCheckRuns([run({ details_url: null, html_url: null })], PR_URL);
    expect(withNeither?.check.url).toBe(PR_URL);
  });
});

describe('mapCommitStatuses', () => {
  it('uses the context as both name and app', () => {
    const [mapped] = mapCommitStatuses(
      [
        {
          context: 'ci/circleci: build',
          state: 'failure',
          target_url: 'https://circleci.com/gh/northwind-labs/tenant-platform/900',
          updated_at: '2026-09-08T11:06:00Z',
        },
      ],
      PR_URL,
    );
    expect(mapped?.check).toEqual({
      name: 'ci/circleci: build',
      app: 'ci/circleci: build',
      status: 'failure',
      url: 'https://circleci.com/gh/northwind-labs/tenant-platform/900',
      completedAt: '2026-09-08T11:06:00Z',
    });
  });

  it('leaves a pending status with no completion time', () => {
    const [mapped] = mapCommitStatuses(
      [{ context: 'buildkite', state: 'pending', updated_at: '2026-09-08T11:06:00Z' }],
      PR_URL,
    );
    expect(mapped?.check.completedAt).toBeNull();
  });
});

describe('dedupeChecks', () => {
  it('keeps the latest run of a name and drops the earlier attempt', () => {
    const checks = dedupeChecks(
      mapCheckRuns(
        [
          run({ conclusion: 'failure', completed_at: '2026-09-08T11:02:00Z' }),
          run({ conclusion: 'success', completed_at: '2026-09-08T11:40:00Z' }),
        ],
        PR_URL,
      ),
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe('success');
  });

  it('keeps a running attempt over an older completed one', () => {
    const checks = dedupeChecks(
      mapCheckRuns(
        [
          run({ completed_at: '2026-09-08T11:02:00Z' }),
          run({ status: 'in_progress', conclusion: null, completed_at: null, started_at: '2026-09-08T12:00:00Z' }),
        ],
        PR_URL,
      ),
    );
    expect(checks).toEqual([
      {
        name: 'lint-and-test',
        app: 'github-actions',
        status: 'pending',
        url: 'https://github.com/northwind-labs/tenant-platform/actions/runs/1/job/1',
        completedAt: null,
      },
    ]);
  });

  it('keeps different names apart and in the order they arrived', () => {
    const checks = dedupeChecks(
      mapCheckRuns([run({ name: 'Wiz' }), run({ name: 'CodeQL' })], PR_URL),
    );
    expect(checks.map((check) => check.name)).toEqual(['Wiz', 'CodeQL']);
  });

  it('deduplicates a legacy status against a check run of the same name', () => {
    const checks = dedupeChecks([
      ...mapCheckRuns([run({ name: 'build', completed_at: '2026-09-08T11:02:00Z' })], PR_URL),
      ...mapCommitStatuses(
        [{ context: 'build', state: 'failure', updated_at: '2026-09-08T11:30:00Z' }],
        PR_URL,
      ),
    ]);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe('failure');
  });
});

describe('countByStatus', () => {
  it('counts every status, including the ones with none', () => {
    const checks = dedupeChecks(
      mapCheckRuns(
        [
          run({ name: 'a' }),
          run({ name: 'b', conclusion: 'failure' }),
          run({ name: 'c', status: 'queued', conclusion: null }),
        ],
        PR_URL,
      ),
    );
    expect(countByStatus(checks)).toEqual({
      success: 1,
      failure: 1,
      pending: 1,
      neutral: 0,
      skipped: 0,
      cancelled: 0,
    });
  });
});
