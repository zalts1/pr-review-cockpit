import type { CheckoutInfo, PrInfo, ReviewDocument, RiskLevel } from '@review-cockpit/schema';
import { summaryCounts } from '@review-cockpit/schema';
import type { HunkFeatures } from './features.js';
import type { CarryOutcome } from './carry.js';
import { carryStage2 } from './carry.js';
import { checkout } from './checkout.js';
import { diffBytes, formatBytes, writeCompact } from './compact.js';
import { readUserConfig } from './config.js';
import { nowIso, readDocument, status, writeDocument } from './document.js';
import type { GhRunner } from './gh.js';
import type { FanCounts, GraphResult } from './graph.js';
import { buildGoGraph } from './graph.js';
import type { PrRef } from './paths.js';
import { compactFile, documentFile, indexDir } from './paths.js';
import type { ReattachOutcome } from './reattach.js';
import { reattachStoredDrafts } from './reattach.js';
import { resolvePr } from './resolve.js';
import { modeOf, riskOf } from './score.js';
import { analyzeStage1 } from './stage1.js';

export interface AnalyzeOptions {
  prArg: string;
  cwd: string;
  /** Injected so a test reaches no network; the default runs the gh command line. */
  gh?: GhRunner;
  foldGenerated?: boolean;
  skipGraph?: boolean;
  /** True when a judgment pass will follow, so stage 2 reads as running rather than absent. */
  expectJudgment?: boolean;
  onProgress?: (message: string) => void;
  /**
   * Called once stage 1 is on disk and before the graph starts. `cockpit run` serves the
   * document and opens the browser from here, so the cockpit is usable while the graph builds.
   */
  onStage1?: (handoff: Stage1Handoff) => void | Promise<void>;
}

export interface Stage1Handoff {
  ref: PrRef;
  checkout: CheckoutInfo;
  document: ReviewDocument;
  documentPath: string;
  compactPath: string;
  stage1Ms: number;
}

export interface AnalyzeResult {
  ref: PrRef;
  checkout: CheckoutInfo;
  document: ReviewDocument;
  documentPath: string;
  compactPath: string;
  compactBytes: number;
  stage1Ms: number;
  graph: GraphResult | null;
  /** Whether the stage 2 of an earlier run of the same head was kept. */
  carry: CarryOutcome;
  /** Whether the drafts stored beside the document were re-attached to the new diff. */
  reattach: ReattachOutcome;
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

      // A carried stage 2 may already hold a raise above the old floor, and a
      // raise the new floor has caught up with is no longer a raise.
      const level = rankOf(hunk.risk.level) > rankOf(floor) ? hunk.risk.level : floor;
      hunk.risk.score = refined.score;
      hunk.risk.floor = floor;
      hunk.risk.level = level;
      hunk.risk.mode = modeOf(level);
      hunk.risk.adjustedBy =
        hunk.risk.adjustedBy === null || level === floor
          ? null
          : { from: floor, to: level, why: hunk.risk.adjustedBy.why };
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
    expectJudgment: options.expectJudgment === true,
    ...(options.gh ? { gh: options.gh } : {}),
    ...(onProgress ? { onProgress } : {}),
  });

  const documentPath = documentFile(resolved.ref);
  const compactPath = compactFile(resolved.ref);
  const previous = readPrevious(documentPath);
  const carry = carryStage2From(previous, stage1.document);
  if (carry.kind === 'carried') {
    stage1.document = carry.document;
    onProgress?.(
      `stage 2 kept from the previous run at the same head: ${carry.document.groups.length} groups, ${carry.document.path.length} steps` +
        (carry.log.length > 0 ? `, ${carry.log.length} merge log entries` : ''),
    );
  } else {
    onProgress?.(`stage 2 not carried forward: ${carry.why}`);
  }
  writeDocument(documentPath, stage1.document);

  const reattach = reattachStoredDrafts(resolved.ref, previous, stage1.document, nowIso());
  onProgress?.(
    reattach.kind === 'done'
      ? `drafts re-attached: ${reattach.kept} kept, ${reattach.orphaned} could not be placed in the new diff`
      : `drafts not re-attached: ${reattach.why}`,
  );

  let compactBytes = writeCompact(compactPath, stage1.document);
  const stage1Ms = Date.now() - stage1Started;
  onProgress?.(`stage 1 written to ${documentPath} (${stage1Ms} ms total)`);
  onProgress?.(
    `compact view written to ${compactPath}: ${formatBytes(compactBytes)} against ${formatBytes(diffBytes(stage1.document))} of diff`,
  );

  await options.onStage1?.({
    ref: resolved.ref,
    checkout: info,
    document: stage1.document,
    documentPath,
    compactPath,
    stage1Ms,
  });

  if (options.skipGraph === true) {
    return {
      ref: resolved.ref,
      checkout: info,
      document: stage1.document,
      documentPath,
      compactPath,
      compactBytes,
      stage1Ms,
      graph: null,
      carry,
      reattach,
    };
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
    compactBytes = writeCompact(compactPath, document);
    onProgress?.(
      `graph: ${graph.graph.nodes.length} nodes, ${graph.graph.edges.length} edges, ${refined.raised} hunks raised, ${refined.kept} floors kept (${graph.stats.ms} ms)`,
    );
    return {
      ref: resolved.ref,
      checkout: info,
      document,
      documentPath,
      compactPath,
      compactBytes,
      stage1Ms,
      graph,
      carry,
      reattach,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    document.status.graph = status(
      'failed',
      nowIso(),
      `the call graph could not be built: ${message}`,
    );
    writeDocument(documentPath, document);
    onProgress?.(`graph failed: ${message}`);
    return {
      ref: resolved.ref,
      checkout: info,
      document,
      documentPath,
      compactPath,
      compactBytes,
      stage1Ms,
      graph: null,
      carry,
      reattach,
    };
  }
}

function readPrevious(documentPath: string): ReviewDocument | null {
  try {
    return readDocument(documentPath);
  } catch {
    return null;
  }
}

function carryStage2From(previous: ReviewDocument | null, fresh: ReviewDocument): CarryOutcome {
  if (previous === null) {
    return { kind: 'skipped', why: 'there is no cached document for this pull request' };
  }
  return carryStage2(previous, fresh, { now: nowIso() });
}
