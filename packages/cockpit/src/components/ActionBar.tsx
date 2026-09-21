import { Check, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

interface Props {
  nextLabel: string | null;
  reviewed: boolean;
  canPrev: boolean;
  canAsk: boolean;
  onPrev(): void;
  onMarkReviewed(): void;
  onAsk(): void;
  onNext(): void;
}

export function ActionBar({
  nextLabel,
  reviewed,
  canPrev,
  canAsk,
  onPrev,
  onMarkReviewed,
  onAsk,
  onNext,
}: Props) {
  return (
    <div className="absolute bottom-5 left-1/2 z-[5] flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-border bg-card p-1.5 shadow-panel">
      <Button variant="ghost" className="text-foreground" onClick={onPrev} disabled={!canPrev} title="Previous step (p)">
        <ChevronLeft className="size-3" /> Prev
      </Button>
      <Button
        variant="ghost"
        className={cn('text-foreground', reviewed && 'text-ok')}
        onClick={onMarkReviewed}
        title="Mark this file viewed and move on (v then n)"
      >
        <Check className="size-3" /> Mark reviewed
      </Button>
      <Button
        variant="ghost"
        className="text-foreground"
        onClick={onAsk}
        disabled={!canAsk}
        title="Copy a prompt about this hunk to the clipboard (a)"
      >
        <Sparkles className="size-3" /> Ask Claude about this hunk
      </Button>
      <span className="mx-1 h-5 w-px bg-border" />
      <Button
        variant="default"
        onClick={onNext}
        disabled={nextLabel === null}
        title="Go to the next step of the review path (n)"
      >
        {nextLabel === null ? 'Walk complete' : `Next: ${nextLabel}`}
        <ChevronRight className="size-3" />
      </Button>
    </div>
  );
}
