import { analyze, commentStats, countByStatus } from '@review-cockpit/analyzer';
import type { CheckStatus, ReviewDocument, RiskLevel } from '@review-cockpit/schema';
import { progress } from '../progress.js';

export interface AnalyzeFlags {
  foldGenerated: boolean;
  skipGraph: boolean;
  expectJudgment: boolean;
  cwd: string;
}

function countByLevel(document: ReviewDocument): Record<RiskLevel, number> {
  const counts: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0 };
  for (const file of document.files) {
    for (const hunk of file.hunks) counts[hunk.risk.level] += 1;
  }
  return counts;
}

function reportSignals(document: ReviewDocument, step: (message: string) => void): void {
  if (document.status.comments.state === 'failed') {
    step(`comments: ${document.status.comments.message ?? 'failed'}`);
  } else {
    const stats = commentStats({
      comments: document.comments,
      conversation: document.conversation ?? [],
    });
    step(
      `comments: ${stats.total} on the diff (${stats.placed} placed, ${stats.outdated} outdated), ` +
        `${stats.threads} threads with ${stats.resolvedThreads} resolved, ` +
        `${stats.conversation} on the conversation`,
    );
  }

  if (document.status.checks.state === 'failed') {
    step(`checks: ${document.status.checks.message ?? 'failed'}`);
  } else {
    const counts = countByStatus(document.checks);
    const named = (Object.keys(counts) as CheckStatus[])
      .filter((status) => counts[status] > 0)
      .map((status) => `${counts[status]} ${status}`);
    step(`checks: ${document.checks.length} runs${named.length > 0 ? ` — ${named.join(', ')}` : ''}`);
  }

  for (const summary of document.botSummaries ?? []) {
    step(`${summary.source.name} summary: ${summary.riskLevel ?? 'no'} risk, ${summary.body.length} characters`);
  }
}

export async function analyzeCommand(prArg: string, flags: AnalyzeFlags): Promise<number> {
  const step = progress('analyze');
  const result = await analyze({
    prArg,
    cwd: flags.cwd,
    foldGenerated: flags.foldGenerated,
    skipGraph: flags.skipGraph,
    expectJudgment: flags.expectJudgment,
    onProgress: step,
  });

  const { document } = result;
  const hunks = document.files.reduce((total, file) => total + file.hunks.length, 0);
  const counts = countByLevel(document);
  const folded = document.files.filter((file) => file.generated.is);

  step(
    `${document.files.length} files, ${hunks} hunks: ${counts.high} high, ${counts.medium} medium, ${counts.low} low`,
  );
  if (folded.length > 0) {
    step(`folded as generated: ${folded.map((file) => `${file.path} (${file.generated.rule})`).join(', ')}`);
  }
  reportSignals(document, step);

  if (!flags.expectJudgment && document.status.summary.state !== 'ready') {
    step('stage 2 marked "not-attached": no judgment pass is running, and the cockpit says so');
  }
  if (document.status.graph.state === 'failed') {
    step(`graph: ${document.status.graph.message ?? 'failed'}`);
  }

  console.log(result.documentPath);
  return 0;
}
