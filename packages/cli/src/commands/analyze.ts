import { analyze } from '@review-cockpit/analyzer';
import type { ReviewDocument, RiskLevel } from '@review-cockpit/schema';
import { progress } from '../progress.js';

export interface AnalyzeFlags {
  foldGenerated: boolean;
  skipGraph: boolean;
  cwd: string;
}

function countByLevel(document: ReviewDocument): Record<RiskLevel, number> {
  const counts: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0 };
  for (const file of document.files) {
    for (const hunk of file.hunks) counts[hunk.risk.level] += 1;
  }
  return counts;
}

export async function analyzeCommand(prArg: string, flags: AnalyzeFlags): Promise<number> {
  const step = progress('analyze');
  const result = await analyze({
    prArg,
    cwd: flags.cwd,
    foldGenerated: flags.foldGenerated,
    skipGraph: flags.skipGraph,
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
  if (document.status.graph.state === 'failed') {
    step(`graph: ${document.status.graph.message ?? 'failed'}`);
  }

  console.log(result.documentPath);
  return 0;
}
