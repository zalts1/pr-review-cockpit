import type { CheckoutInfo, PrInfo, ReviewDocument, RiskLevel } from '@review-cockpit/schema';
import { summaryCounts } from '@review-cockpit/schema';
import type { HunkFeatures } from './features.js';
import { checkout } from './checkout.js';
import { readUserConfig } from './config.js';
import { nowIso, status, writeDocument } from './document.js';
import type { FanCounts, GraphResult } from './graph.js';
import { buildGoGraph } from './graph.js';
import type { PrRef } from './paths.js';
import { documentFile, indexDir } from './paths.js';
import { resolvePr } from './resolve.js';
import { modeOf, riskOf } from './score.js';
import { analyzeStage1 } from './stage1.js';

export interface AnalyzeOptions {
  prArg: string;
  cwd: string;
  foldGenerated?: boolean;
  skipGraph?: boolean;
  onProgress?: (message: string) => void;
}

export interface AnalyzeResult {
  ref: PrRef;
  checkout: CheckoutInfo;
  document: ReviewDocument;
  documentPath: string;
  stage1Ms: number;
  graph: GraphResult | null;
}

export interface PrepareResult {
  ref: PrRef;
  checkout: CheckoutInfo;
  pr: PrInfo;
  documentPath: string;
}

export function prepare(prArg: string, cwd: string, onProgress?: (message: string) => void): PrepareResult {
  const resolved = resolvePr(prArg, cwd);
  onProgress?.(`${resolved.ref.owner}/${resolved.ref.repo}#${resolved.ref.number} at ${resolved.pr.head.sha.slice(0, 12)}`);
  const info = checkout({
    ref: resolved.ref,
    headSha: resolved.pr.head.sha,
    baseSha: resolved.pr.base.sha,
    baseRef: resolved.pr.base.ref,
    cwd,
    workspaceRoots: readUserConfig().workspaceRoots,
    ...(onProgress ? { onProgress } : {}),
  });
  return {
    ref: resolved.ref,
    checkout: info,
    pr: resolved.pr,
    documentPath: documentFile(resolved.ref),
  };
}

/**
 * Stage 3 rescores with resolved call counts. The score and the factors always
 * follow the new counts, so the hover text and the signals agree, but the floor
 * only ever rises: the grep estimate over-counts, and a floor that fell after
 * the reviewer saw it would be a floor in name only.
 */
export function applyGraphFan(
  document: ReviewDocument,
  fanByFile: ReadonlyMap<string, FanCounts>,
  featuresByHunk: ReadonlyMap<string, HunkFeatures>,
): { raised: number; kept: number } {
  let raised = 0;
  let kept = 0;

  for (const file of document.files) {
    const fan = fanByFile.get(file.path);
    if (!fan) continue;
    const estimated = file.signals.fanIn;
    file.signals.fanIn = fan.fanIn;
    file.signals.fanOut = fan.fanOut;
    file.signals.fanSource = 'graph';

    for (const hunk of file.hunks) {
      const features = featuresByHunk.get(hunk.id);
      if (!features) continue;
      const refined = riskOf({
        signals: file.signals,
        features,
        kind: hunk.kind,
        path: file.path,
        generated: file.generated,
      });

      const floor = rankOf(refined.floor) > rankOf(hunk.risk.floor) ? refined.floor : hunk.risk.floor;
      if (refined.floor !== floor) {
        kept += 1;
        hunk.risk.factors = [
          {
            signal: 'floor',
            contribution: 0,
            detail: `kept at ${floor} from the stage 1 estimate of ${estimated ?? 0} callers`,
          },
          ...refined.factors.slice(0, 2),
        ];
      } else {
        if (floor !== hunk.risk.floor) raised += 1;
        hunk.risk.factors = refined.factors;
      }

      hunk.risk.score = refined.score;
      hunk.risk.floor = floor;
      hunk.risk.level = floor;
      hunk.risk.mode = modeOf(floor);
    }
  }

  return { raised, kept };
}

const rank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

function rankOf(level: RiskLevel): number {
  return rank[level];
}

export async function analyze(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const onProgress = options.onProgress;
  const stage1Started = Date.now();

  const resolved = resolvePr(options.prArg, options.cwd);
  onProgress?.(
    `resolved ${resolved.ref.owner}/${resolved.ref.repo}#${resolved.ref.number}: "${resolved.pr.title}" by ${resolved.pr.author}`,
  );

  const info = checkout({
    ref: resolved.ref,
    headSha: resolved.pr.head.sha,
    baseSha: resolved.pr.base.sha,
    baseRef: resolved.pr.base.ref,
    cwd: options.cwd,
    workspaceRoots: readUserConfig().workspaceRoots,
    ...(onProgress ? { onProgress } : {}),
  });
  onProgress?.(`checkout ${info.mode} at ${info.path}`);

  const stage1 = await analyzeStage1({
    pr: resolved.pr,
    checkout: info,
    authorEmails: resolved.authorEmails,
    foldGenerated: options.foldGenerated ?? true,
    ...(onProgress ? { onProgress } : {}),
  });

  const documentPath = documentFile(resolved.ref);
  writeDocument(documentPath, stage1.document);
  const stage1Ms = Date.now() - stage1Started;
  onProgress?.(`stage 1 written to ${documentPath} (${stage1Ms} ms total)`);

  if (options.skipGraph === true) {
    return { ref: resolved.ref, checkout: info, document: stage1.document, documentPath, stage1Ms, graph: null };
  }

  const document = stage1.document;
  try {
    const graph = await buildGoGraph({
      worktree: info.path,
      headSha: resolved.pr.head.sha,
      files: document.files,
      indexDirectory: indexDir(resolved.ref),
      ...(onProgress ? { onProgress } : {}),
    });
    const refined = applyGraphFan(document, graph.fanByFile, stage1.featuresByHunk);
    document.summary.counts = summaryCounts(document);
    document.graph = graph.graph;
    document.status.graph = status('ready', nowIso());
    writeDocument(documentPath, document);
    onProgress?.(
      `graph: ${graph.graph.nodes.length} nodes, ${graph.graph.edges.length} edges, ${refined.raised} hunks raised, ${refined.kept} floors kept (${graph.stats.ms} ms)`,
    );
    return { ref: resolved.ref, checkout: info, document, documentPath, stage1Ms, graph };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    document.status.graph = status(
      'failed',
      nowIso(),
      `the call graph could not be built: ${message}`,
    );
    writeDocument(documentPath, document);
    onProgress?.(`graph failed: ${message}`);
    return { ref: resolved.ref, checkout: info, document, documentPath, stage1Ms, graph: null };
  }
}
