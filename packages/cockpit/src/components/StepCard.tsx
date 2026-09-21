import type { Phase } from '@review-cockpit/schema';
import { Check, ChevronLeft, Sparkles } from 'lucide-react';
import { PHASE_LABELS } from '../lib/plan';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

interface Props {
  step: number;
  total: number;
  phase: Phase;
  symbol: string | null;
  note: string | null;
  fileLabel: string;
  reviewed: boolean;
  canPrev: boolean;
  canAsk: boolean;
  onPrev(): void;
  onMarkReviewed(): void;
  onAsk(): void;
}

export function StepCard({
  step,
  total,
  phase,
  symbol,
  note,
  fileLabel,
  reviewed,
  canPrev,
  canAsk,
  onPrev,
  onMarkReviewed,
  onAsk,
}: Props) {
  return (
    <div className="flex flex-none items-start gap-4 rounded-lg border border-border bg-card px-4 py-3 shadow-xs">
      <div className="flex min-w-12 flex-col items-center pt-0.5">
        <span className="text-[22px] leading-none font-semibold text-walk">{step}</span>
        <span className="mt-1 text-[11px] text-muted-foreground">of {total}</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground capitalize">{PHASE_LABELS[phase]}</span>
          <span>·</span>
          <code className="truncate text-xs">{symbol ?? fileLabel}</code>
        </div>
        <div className="text-[13.5px]">
          {note ?? (
            <span className="text-muted-foreground">
              No note for this step. Read it on its own terms.
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-none gap-1.5">
        <Button size="sm" onClick={onPrev} disabled={!canPrev} title="Previous step (p)">
          <ChevronLeft className="size-3" /> Prev
        </Button>
        <Button
          size="sm"
          className={cn(reviewed && 'border-ok text-ok')}
          onClick={onMarkReviewed}
          title="Mark this file viewed and move on (v then n)"
        >
          <Check className="size-3" /> Mark reviewed
        </Button>
        <Button
          size="sm"
          onClick={onAsk}
          disabled={!canAsk}
          title="Copy a prompt about this hunk to the clipboard (a)"
        >
          <Sparkles className="size-3" /> Ask Claude about this hunk
        </Button>
      </div>
    </div>
  );
}
