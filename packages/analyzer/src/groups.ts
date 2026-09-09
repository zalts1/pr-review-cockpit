import type { Group, ReviewFile } from '@review-cockpit/schema';

/**
 * The deterministic groups: the three kinds whose floor rules guarantee a low
 * floor, so a skim group can never hide a hunk the reviewer had to read.
 */
export function stage1Groups(files: readonly ReviewFile[]): Group[] {
  const generated: string[] = [];
  const imports: string[] = [];
  const whitespace: string[] = [];
  let generatedFiles = 0;

  for (const file of files) {
    if (file.generated.is) {
      generatedFiles += 1;
      for (const hunk of file.hunks) generated.push(hunk.id);
      continue;
    }
    for (const hunk of file.hunks) {
      if (hunk.kind === 'import') imports.push(hunk.id);
      else if (hunk.kind === 'whitespace-only') whitespace.push(hunk.id);
    }
  }

  const groups: Group[] = [];
  const add = (kind: 'generated' | 'import' | 'whitespace', title: string, description: string, hunkIds: string[]): void => {
    if (hunkIds.length === 0) return;
    groups.push({
      id: `g${groups.length + 1}`,
      kind,
      title,
      description,
      hunkIds,
      mode: 'skim',
      collapsedByDefault: true,
      producedBy: 'stage1',
    });
  };

  const foldedFiles = generatedFiles === 1 ? '1 file' : `${generatedFiles} files`;
  add(
    'generated',
    'Generated files',
    `${foldedFiles} matched a generated-code rule. The rule that folded each one is on the file.`,
    generated,
  );
  add('import', 'Import changes', 'Hunks where only import statements change.', imports);
  add('whitespace', 'Whitespace only', 'Hunks whose changed lines differ only in whitespace.', whitespace);

  return groups;
}
