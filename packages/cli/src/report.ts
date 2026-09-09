import type { Issue, MergeLogEntry, ValidationResult } from '@review-cockpit/schema';

export function printIssues(result: ValidationResult): void {
  for (const issue of result.errors) console.error(`  error    ${line(issue)}`);
  for (const issue of result.warnings) console.error(`  warning  ${line(issue)}`);
}

function line(issue: Issue): string {
  return `${issue.message}  [${issue.rule}]`;
}

export function countsOf(result: ValidationResult): string {
  const errors = `${result.errors.length} error${result.errors.length === 1 ? '' : 's'}`;
  const warnings = `${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}`;
  return `${errors}, ${warnings}`;
}

export function printMergeLog(log: MergeLogEntry[]): void {
  if (log.length === 0) {
    console.error('merge log: nothing was dropped, clamped or appended');
    return;
  }
  console.error(`merge log: ${log.length} entr${log.length === 1 ? 'y' : 'ies'}`);
  for (const entry of log) {
    const subject = entry.hunkId === undefined ? '' : ` ${entry.hunkId}`;
    console.error(`  ${entry.rule}${subject}: ${entry.detail}`);
  }
}
