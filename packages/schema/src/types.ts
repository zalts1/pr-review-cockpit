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

/** A summary once status.summary is ready: the validator guarantees all three fields. */
export type ReadySummary = Required<Summary>;

export function isReadySummary(summary: Summary): summary is ReadySummary {
  return (
    typeof summary.oneLiner === 'string' &&
    Array.isArray(summary.reviewFocus) &&
    summary.counts !== undefined
  );
}
