import type { ReadySummary, SectionStatus } from '@review-cockpit/schema';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { pendingLabel } from '../lib/derive';
import { MarkdownInline } from '../lib/markdown';
import { cn } from '../lib/utils';
import { BriefDetail } from './PlanStrip';
import { Button } from './ui/button';

interface Props {
  summary: ReadySummary | null;
  status: SectionStatus;
  prBody: string;
  open: boolean;
  onToggle(): void;
}

/**
 * The column layout's brief: the TL;DR on one line at the top of the column,
 * and the whole brief unfolding in place under it rather than over the diff.
 */
export function BriefCard({ summary, status, prBody, open, onToggle }: Props) {
  const pending = status.state === 'pending';
  const failed = status.state === 'failed';
  const placeholder = pending ? pendingLabel(status) : 'Summary unavailable';
  const detailLabel = summary === null ? 'PR description' : 'Read the brief';

  return (
    <section className="flex-none rounded-lg border border-border bg-card shadow-xs">
      <div className="flex items-center gap-3.5 px-4 py-2.5">
        <span className="flex-none text-[11px] font-semibold text-muted-foreground">TL;DR</span>
        {summary === null ? (
          <span className={cn('min-w-0 flex-1 text-[13.5px]', failed ? 'text-high' : 'text-medium')}>
            {placeholder}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13.5px]">
            <MarkdownInline text={summary.tldr} />
          </span>
        )}
        <Button variant="ghost" size="sm" className="flex-none text-link" onClick={onToggle} aria-expanded={open}>
          {detailLabel}
          {summary !== null && summary.watchFor.length > 0 && (
            <span className="rounded-full bg-medium-wash px-1.5 text-[11px] font-semibold text-medium">
              {summary.watchFor.length} to watch for
            </span>
          )}
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </Button>
      </div>
      {open && (
        <div className="flex flex-col gap-2.5 border-t border-border bg-muted px-4 py-3">
          <BriefDetail summary={summary} prBody={prBody} />
        </div>
      )}
    </section>
  );
}
