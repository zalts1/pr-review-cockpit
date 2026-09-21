import type { Group, Hunk as HunkModel, ReviewFile } from '@review-cockpit/schema';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { groupLineCount } from '../lib/derive';
import { cn } from '../lib/utils';
import { closedRowClass, Where } from './DiffFile';
import type { DiffHandlers } from './Hunk';
import { Hunk } from './Hunk';

interface Props {
  group: Group;
  entries: Array<{ file: ReviewFile; hunks: HunkModel[] }>;
  expanded: boolean;
  isTarget: boolean;
  flashed: boolean;
  /** The step this group is reached at, or null when the walk never reaches it. */
  step: number | null;
  handlers: DiffHandlers;
  registerGroup(id: string, el: HTMLElement | null): void;
  onToggle(): void;
  onHover(id: string | null): void;
}

export function GroupHeader({
  group,
  entries,
  expanded,
  isTarget,
  flashed,
  step,
  handlers,
  registerGroup,
  onToggle,
  onHover,
}: Props) {
  const fileCount = entries.length;
  const lines = groupLineCount(entries);
  const where = step === null ? group.mode : `step ${step} · ${group.mode}`;
  const Caret = expanded ? ChevronDown : ChevronRight;

  return (
    <section
      className={cn(
        'flex-none',
        expanded && 'overflow-hidden rounded-lg border border-border bg-card shadow-xs',
        isTarget && 'border-walk',
        flashed && 'hunk-target',
      )}
      ref={(el) => registerGroup(group.id, el)}
      data-group-id={group.id}
      onMouseEnter={() => onHover(group.id)}
      onMouseLeave={() => onHover(null)}
    >
      <button
        type="button"
        className={cn(
          closedRowClass,
          expanded && 'rounded-none border-0 border-b bg-muted shadow-none hover:border-border',
          isTarget && !expanded && 'border-walk',
        )}
        onClick={onToggle}
        aria-expanded={expanded}
        title={group.description || group.title}
      >
        <Caret className="size-[11px] flex-none text-muted-foreground" />
        <span className="font-semibold">{group.title}</span>
        <span className="text-muted-foreground">
          {group.kind} · {fileCount} {fileCount === 1 ? 'file' : 'files'} · {lines} lines
        </span>
        <Where text={where} />
      </button>

      {expanded && (
        <div className="px-2.5 pt-2 pb-2.5">
          {group.description && (
            <p className="m-0 px-1 pb-1 text-xs text-muted-foreground">{group.description}</p>
          )}
          {entries.map(({ file, hunks }) => (
            <div key={file.id}>
              <div className="mt-2.5 mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate font-mono font-semibold">{file.path}</span>
                <span className="font-mono text-ok">+{file.additions}</span>
                <span className="font-mono text-high">−{file.deletions}</span>
              </div>
              {hunks.map((hunk) => (
                <Hunk key={hunk.id} hunk={hunk} file={file} handlers={handlers} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
