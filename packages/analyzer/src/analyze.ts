import type { CheckoutInfo, PrInfo, ReviewDocument } from '@review-cockpit/schema';
import type { HunkFeatures } from './features.js';
import { checkout } from './checkout.js';
import { readUserConfig } from './config.js';
import { nowIso, status, writeDocument } from './document.js';
import type { FanCounts, GraphResult } from './graph.js';
import { buildGoGraph } from './graph.js';
import type { PrRef } from './paths.js';
import { documentFile, indexDir } from './paths.js';
import { resolvePr } from './resolve.js';
import { levelOf, modeOf, riskOf } from './score.js';
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
 * Stage 3 may raise the risk it finds with a resolved call graph but never
 * lowers it: the grep estimate over-counts, and a floor that fell after the
 * reviewer had already seen it would be a floor in name only.
 */
export function applyGraphFan(
  document: ReviewDocument,
  fanByFile: ReadonlyMap<string, FanCounts>,
  featuresByHunk: ReadonlyMap<string, HunkFeatures>,
): number {
  let raised = 0;

  for (const file of document.files) {
    const fan = fanByFile.get(file.path);
    if (!fan) continue;
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
      if (refined.score <= hunk.risk.score) continue;
      const floor = levelOf(refined.score);
      if (floor === hunk.risk.floor) {
        hunk.risk.score = refined.score;
        hunk.risk.factors = refined.factors;
        continue;
      }
      hunk.risk.score = refined.score;
      hunk.risk.factors = refined.factors;
      hunk.risk.floor = refined.floor;
      hunk.risk.level = refined.floor;
      hunk.risk.mode = modeOf(refined.floor);
      raised += 1;
    }
  }

  return raised;
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
    const raised = applyGraphFan(document, graph.fanByFile, stage1.featuresByHunk);
    document.graph = graph.graph;
    document.status.graph = status('ready', nowIso());
    writeDocument(documentPath, document);
    onProgress?.(
      `graph: ${graph.graph.nodes.length} nodes, ${graph.graph.edges.length} edges, ${raised} hunks raised (${graph.stats.ms} ms)`,
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
