import type {
  BotSummary,
  Check,
  Comment,
  ConversationComment,
  PrInfo,
  ReviewFile,
} from '@review-cockpit/schema';
import { parseBotSummaries } from './botsummary.js';
import type { GhCheckRun, GhCommitStatus } from './checks.js';
import { dedupeChecks, mapCheckRuns, mapCommitStatuses } from './checks.js';
import type { GhIssueComment, GhReviewComment, MappedComments } from './comments.js';
import { mapComments, threadsByComment } from './comments.js';
import type { GhRunner } from './gh.js';
import { ghArray, ghCli, ghMessage, ghObjects, jsonValues } from './gh.js';

/**
 * One query for every thread on the pull request. The comments carry no
 * resolution of their own: it belongs to the thread, and this is the only
 * GitHub API that reports it.
 */
export const REVIEW_THREADS_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$endCursor:String){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      reviewThreads(first:100,after:$endCursor){
        pageInfo{hasNextPage endCursor}
        nodes{id isResolved isOutdated comments(first:100){nodes{databaseId}}}
      }
    }
  }
}`;

export interface IngestOptions {
  pr: PrInfo;
  files: readonly ReviewFile[];
  gh?: GhRunner;
}

export interface IngestResult {
  comments: Comment[];
  conversation: ConversationComment[];
  checks: Check[];
  botSummaries: BotSummary[];
  /** The gh error, when the fetch failed: stage 1 keeps going and the section reads failed. */
  commentsError: string | null;
  checksError: string | null;
}

export function fetchComments(
  gh: GhRunner,
  pr: PrInfo,
  files: readonly ReviewFile[],
): MappedComments {
  const repo = `${pr.owner}/${pr.repo}`;
  const reviewComments = ghArray<GhReviewComment>(gh, [
    'api',
    `repos/${repo}/pulls/${pr.number}/comments`,
    '--paginate',
  ]);
  const issueComments = ghArray<GhIssueComment>(gh, [
    'api',
    `repos/${repo}/issues/${pr.number}/comments`,
    '--paginate',
  ]);
  const threads = threadsByComment(
    jsonValues(
      gh([
        'api',
        'graphql',
        '--paginate',
        '-F',
        `owner=${pr.owner}`,
        '-F',
        `repo=${pr.repo}`,
        '-F',
        `number=${pr.number}`,
        '-f',
        `query=${REVIEW_THREADS_QUERY}`,
      ]),
    ),
  );

  return mapComments({ reviewComments, issueComments, threads, files });
}

export function fetchChecks(gh: GhRunner, pr: PrInfo): Check[] {
  const repo = `${pr.owner}/${pr.repo}`;
  const runs = ghObjects<{ check_runs?: GhCheckRun[] }>(gh, [
    'api',
    `repos/${repo}/commits/${pr.head.sha}/check-runs`,
    '--paginate',
  ]).flatMap((page) => page.check_runs ?? []);
  const statuses = ghObjects<{ statuses?: GhCommitStatus[] }>(gh, [
    'api',
    `repos/${repo}/commits/${pr.head.sha}/status`,
  ]).flatMap((page) => page.statuses ?? []);

  return dedupeChecks([
    ...mapCheckRuns(runs, pr.url),
    ...mapCommitStatuses(statuses, pr.url),
  ]);
}

/** Each fetch fails on its own, so a broken one costs its section and nothing else. */
export function ingest(options: IngestOptions): IngestResult {
  const gh = options.gh ?? ghCli;
  const result: IngestResult = {
    comments: [],
    conversation: [],
    checks: [],
    botSummaries: parseBotSummaries(options.pr.body, options.pr.url),
    commentsError: null,
    checksError: null,
  };

  try {
    const mapped = fetchComments(gh, options.pr, options.files);
    result.comments = mapped.comments;
    result.conversation = mapped.conversation;
  } catch (error) {
    result.commentsError = ghMessage(error);
  }

  try {
    result.checks = fetchChecks(gh, options.pr);
  } catch (error) {
    result.checksError = ghMessage(error);
  }

  return result;
}
