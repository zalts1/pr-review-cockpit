import { useEffect } from 'react';
import type { ReadySummary, SectionStatus } from '@review-cockpit/schema';
import { ChevronDown, ChevronRight, FileText, X } from 'lucide-react';
import { pendingLabel } from '../lib/derive';
import { Markdown, MarkdownInline } from '../lib/markdown';
import type { PhaseProgress } from '../lib/plan';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

interface Props {
  summary: ReadySummary | null;
  status: SectionStatus;
  prBody: string;
  phases: PhaseProgress[];
  stepIndex: number;
  stepCount: number;
  highAhead: number;
  skippable: number;
  open: boolean;
  onToggle(): void;
}

const BAR_MIN = 56;
const BAR_MAX = 170;
const CHAR = 6.2;
const PER_STEP = 12;

/** Wide enough for the label, and wider for a phase that holds more of the walk. */
function barWidth({ label, done, total }: PhaseProgress): number {
  const text = `${label} ${done}/${total}`;
  return Math.round(
    Math.min(BAR_MAX, Math.max(BAR_MIN + total * PER_STEP, text.length * CHAR + 10)),
  );
}

function PhaseBars({ phases }: { phases: PhaseProgress[] }) {
  return (
    <div className="flex flex-none items-start gap-1.5">
      {phases.map((phase) => {
        const share = phase.total === 0 ? 0 : Math.round((phase.done / phase.total) * 100);
        return (
          <div className="flex flex-col gap-1.5" key={phase.phase} style={{ width: barWidth(phase) }}>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted-2">
              <div
                className={cn('h-full rounded-full', phase.current ? 'bg-walk' : 'bg-ok')}
                style={{ width: `${share}%` }}
              />
            </div>
            <span
              className={cn(
                'text-[11px] whitespace-nowrap text-muted-foreground',
                phase.current && 'font-semibold text-foreground',
              )}
            >
              {phase.label} {phase.done}/{phase.total}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DetailLabel({ children, warn }: { children: string; warn?: boolean }) {
  return (
    <div
      className={cn(
        'mb-1 text-[11px] font-semibold text-muted-foreground',
        warn && 'text-medium',
      )}
    >
      {children}
    </div>
  );
}

export function PlanStrip({
  summary,
  status,
  prBody,
  phases,
  stepIndex,
  stepCount,
  highAhead,
  skippable,
  open,
  onToggle,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onToggle]);

  const pending = status.state === 'pending';
  const failed = status.state === 'failed';
  const placeholder = pending ? pendingLabel(status) : 'Summary unavailable';
  const detailLabel = summary === null ? 'PR description' : 'Read the brief';

  return (
    <section className="relative flex-none border-b border-border bg-muted">
      <div className="relative z-30 flex items-center gap-7 px-5 py-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-muted-foreground">TL;DR</span>
          {summary === null ? (
            <span className={cn('text-[13px]', failed ? 'text-high' : 'text-medium')}>
              {placeholder}
            </span>
          ) : (
            <span className="truncate text-[13px]">
              <MarkdownInline text={summary.tldr} />
            </span>
          )}
        </div>

        <PhaseBars phases={phases} />

        <div className="flex-none text-xs whitespace-nowrap text-muted-foreground">
          <span className="font-semibold text-foreground">
            {stepCount === 0
              ? 'Nothing to walk'
              : `Step ${Math.max(0, stepIndex + 1)} of ${stepCount}`}
          </span>
          {highAhead > 0 && (
            <>
              {' · '}
              <span className="font-semibold text-high">{highAhead} high-risk</span> ahead
            </>
          )}
          {skippable > 0 && ` · ${skippable} hunks skippable`}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className={cn('flex-none text-link', open && 'bg-walk-wash')}
          onClick={onToggle}
          aria-expanded={open}
        >
          <FileText className="size-3.5" />
          <span>{detailLabel}</span>
          {summary !== null && summary.watchFor.length > 0 && (
            <span className="rounded-full bg-medium-wash px-1.5 text-[11px] font-semibold text-medium">
              {summary.watchFor.length} to watch for
            </span>
          )}
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </Button>
      </div>

      {/* The brief is a disclosure, not a modal: its backdrop only catches a
          click-away, so it sits below the chrome (the row at z-30, the header
          at z-40) rather than over it. */}
      {open && <div className="fixed inset-0 z-10 bg-scrim-soft" onClick={onToggle} />}
      {open && (
        <div className="absolute top-full right-0 left-0 z-20 flex max-h-[calc(100vh-200px)] flex-col gap-2.5 overflow-auto border-b border-border bg-muted py-3 pr-[52px] pl-5 shadow-panel">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2.5 right-4"
            onClick={onToggle}
            aria-label="Close the brief"
            title="Close the brief (Esc)"
          >
            <X className="size-3" />
          </Button>
          {summary === null ? (
            <div className="rounded-md border border-border bg-card px-3 py-2.5">
              <Markdown text={prBody || 'This PR has no description.'} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-7 gap-y-2">
              <div className="col-span-2 max-w-[78ch] min-w-0">
                <DetailLabel>Summary</DetailLabel>
                <Markdown text={summary.overview ?? summary.tldr} />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <DetailLabel>Flow</DetailLabel>
                <div className="flex flex-col gap-1 overflow-x-auto rounded-md border border-border bg-card px-2.5 py-2">
                  {(['before', 'after'] as const).map((side) => (
                    <div className="grid grid-cols-[48px_1fr] items-baseline gap-2" key={side}>
                      <span className="text-[11px] text-muted-foreground">{side}</span>
                      <code className="text-[11px] break-words whitespace-pre-wrap">
                        {summary.flow[side]}
                      </code>
                    </div>
                  ))}
                </div>
                {summary.whereItFits.length > 0 && (
                  <>
                    <DetailLabel>Where it fits</DetailLabel>
                    <ul className="m-0 list-disc pl-[18px] text-xs">
                      {summary.whereItFits.map((line) => (
                        <li key={line} className="mb-0.5">
                          <MarkdownInline text={line} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                {summary.watchFor.length > 0 && (
                  <>
                    <DetailLabel warn>Watch for</DetailLabel>
                    <ul className="m-0 list-disc pl-[18px] text-xs">
                      {summary.watchFor.map((line) => (
                        <li key={line} className="mb-0.5">
                          <MarkdownInline text={line} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {summary.example && (
                  <>
                    <DetailLabel>Example</DetailLabel>
                    <Markdown text={summary.example} />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
