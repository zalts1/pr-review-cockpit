import type { Hunk as HunkModel, ReviewFile, RiskLevel } from '@review-cockpit/schema';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import type { DiffHandlers } from './Hunk';
import { Hunk } from './Hunk';
import { Badge } from './ui/badge';

interface Props {
  file: ReviewFile;
  hunks: HunkModel[];
  open: boolean;
  viewed: boolean;
  current: boolean;
  heat: RiskLevel;
  /** The step this file is reached at, or null when the walk never reaches it. */
  step: number | null;
  handlers: DiffHandlers;
  registerFile(id: string, el: HTMLElement | null): void;
  onToggleOpen(): void;
  onToggleViewed(): void;
}

export const closedRowClass =
  'flex h-[38px] w-full flex-none cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-3 text-left text-xs shadow-xs hover:border-subtle';
export const pathClass = 'min-w-0 truncate font-mono text-xs font-semibold';

export function Stats({ file }: { file: ReviewFile }) {
  return (
    <>
      <span className="flex-none font-mono text-xs text-ok">+{file.additions}</span>
      <span className="flex-none font-mono text-xs text-high">−{file.deletions}</span>
    </>
  );
}

export function Where({ text, heat }: { text: string; heat?: RiskLevel }) {
  return (
    <span
      className={cn(
        'ml-auto whitespace-nowrap text-muted-foreground',
        heat === 'high' && 'font-semibold text-high',
      )}
    >
      {text}
    </span>
  );
}

export function DiffFile({
  file,
  hunks,
  open,
  viewed,
  current,
  heat,
  step,
  handlers,
  registerFile,
  onToggleOpen,
  onToggleViewed,
}: Props) {
  const path = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;

  if (!open) {
    return (
      <button
        type="button"
        className={closedRowClass}
        ref={(el) => registerFile(file.id, el)}
        data-file-id={file.id}
        onClick={onToggleOpen}
        title={`${path} · ${hunks.length} ${hunks.length === 1 ? 'hunk' : 'hunks'}`}
      >
        <ChevronRight className="size-[11px] flex-none text-muted-foreground" />
        <span className={cn(pathClass, 'font-medium', viewed && 'text-muted-foreground')}>
          {path}
        </span>
        <Stats file={file} />
        <Where text={step === null ? heat : `step ${step} · ${heat}`} heat={heat} />
      </button>
    );
  }

  return (
    <section
      className={cn(
        'flex-none overflow-hidden rounded-lg border border-border bg-card shadow-xs',
        current && 'border-walk ring-[3px] ring-walk-ring',
      )}
      ref={(el) => registerFile(file.id, el)}
      data-file-id={file.id}
    >
      <div className="sticky top-0 z-[3] flex h-10 items-center gap-2.5 border-b border-border bg-muted px-3 text-xs">
        <button
          type="button"
          className="inline-flex cursor-pointer text-muted-foreground"
          onClick={onToggleOpen}
          aria-label={`Collapse ${file.path}`}
        >
          <ChevronDown className="size-[11px]" />
        </button>
        <span className={pathClass}>{path}</span>
        <Stats file={file} />
        {file.generated.is && (
          <Badge title={`matched ${file.generated.rule}`}>generated</Badge>
        )}
        {file.status !== 'modified' && <Badge>{file.status}</Badge>}
        {file.signals.testFile && <Badge>test</Badge>}
        <label className="ml-auto inline-flex flex-none cursor-pointer items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            className="size-[15px] accent-walk"
            checked={viewed}
            onChange={onToggleViewed}
          />
          Viewed
        </label>
      </div>

      {hunks.map((hunk) => (
        <Hunk key={hunk.id} hunk={hunk} file={file} handlers={handlers} />
      ))}
    </section>
  );
}
