import type { Judgment, MergeLogEntry, ReviewDocument } from '@review-cockpit/schema';
import { isReadySummary, merge, validateDocument } from '@review-cockpit/schema';

/**
 * Stage 2 read back out of a document as a judgment file. A proposed group
 * carries no id, so a step for one names a hunk inside it and the merge places
 * the group there, exactly as the judgment pass writes it.
 */
export function judgmentFromDocument(document: ReviewDocument): Judgment | null {
  if (document.status.summary.state !== 'ready' || !isReadySummary(document.summary)) return null;

  const stage2 = document.groups.filter((group) => group.producedBy === 'stage2');
  const firstHunk = new Map(stage2.map((group) => [group.id, group.hunkIds[0]]));
  const hunks = document.files.flatMap((file) => file.hunks);

  return {
    schemaVersion: document.schemaVersion,
    groups: stage2.map((group) => ({
      kind: group.kind,
      title: group.title,
      description: group.description,
      hunkIds: [...group.hunkIds],
      mode: group.mode,
      collapsedByDefault: group.collapsedByDefault,
    })),
    path: document.path.map((step) => {
      const carriedHunk = step.ref.kind === 'group' ? firstHunk.get(step.ref.id) : undefined;
      return {
        ref: carriedHunk === undefined ? step.ref : { kind: 'hunk' as const, id: carriedHunk },
        phase: step.phase,
        note: step.note,
      };
    }),
    reasons: Object.fromEntries(
      hunks
        .filter((hunk) => hunk.risk.reason !== null)
        .map((hunk) => [hunk.id, hunk.risk.reason as string]),
    ),
    riskAdjustments: hunks.flatMap((hunk) => {
      const raise = hunk.risk.adjustedBy;
      return raise === null ? [] : [{ hunkId: hunk.id, level: raise.to, why: raise.why }];
    }),
    summary: {
      tldr: document.summary.tldr,
      whereItFits: [...document.summary.whereItFits],
      flow: { ...document.summary.flow },
      example: document.summary.example,
      watchFor: [...document.summary.watchFor],
    },
  };
}

export type CarryOutcome =
  | { kind: 'carried'; document: ReviewDocument; log: MergeLogEntry[] }
  | { kind: 'skipped'; why: string };

export interface CarryOptions {
  now?: string;
}

/**
 * Keeps the judgment pass's work across a re-analysis of the same head. The
 * merge base can still have moved under an unchanged head, so the carried
 * stage 2 is validated against the new stage 1 and dropped if it no longer fits.
 */
export function carryStage2(
  previous: ReviewDocument,
  fresh: ReviewDocument,
  options: CarryOptions = {},
): CarryOutcome {
  if (previous.pr.head.sha !== fresh.pr.head.sha) {
    return {
      kind: 'skipped',
      why: `the head moved from ${previous.pr.head.sha.slice(0, 12)} to ${fresh.pr.head.sha.slice(0, 12)}`,
    };
  }

  const judgment = judgmentFromDocument(previous);
  if (judgment === null) {
    return { kind: 'skipped', why: 'the cached document carries no judgment' };
  }

  const merged = merge(fresh, judgment, options.now === undefined ? {} : { now: options.now });
  const result = validateDocument(merged.document);
  if (!result.ok) {
    return {
      kind: 'skipped',
      why: `the carried judgment no longer fits this diff: ${result.errors[0]?.message ?? 'validation failed'}`,
    };
  }

  return { kind: 'carried', document: merged.document, log: merged.log };
}
