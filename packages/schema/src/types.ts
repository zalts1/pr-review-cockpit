import type { DocumentStatus, Summary } from './generated/document.js';

export type SectionName = keyof DocumentStatus;

export const SECTION_NAMES: SectionName[] = [
  'files',
  'comments',
  'checks',
  'groups',
  'path',
  'summary',
  'graph',
];

/** A summary once status.summary is ready: the validator guarantees every field. */
export type ReadySummary = Required<Summary>;

export function isReadySummary(summary: Summary): summary is ReadySummary {
  return (
    typeof summary.tldr === 'string' &&
    Array.isArray(summary.whereItFits) &&
    summary.flow !== undefined &&
    typeof summary.example === 'string' &&
    Array.isArray(summary.watchFor) &&
    summary.counts !== undefined
  );
}

/**
 * The pending message that says no judgment pass is attached to this session.
 * A pending stage 2 section without it is being analyzed right now.
 */
export const NOT_ATTACHED = 'not-attached';
