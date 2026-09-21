import { Check } from 'lucide-react';
import type { StepperPhase } from '../lib/plan';
import { cn } from '../lib/utils';

interface Props {
  phases: StepperPhase[];
  stepIndex: number;
  stepCount: number;
  highAhead: number;
  skippable: number;
  onStep(index: number): void;
}

/**
 * The column layout's walk: one dot per step, grouped by phase, with the
 * position on the right. It replaces the rail and the plan strip's phase bars
 * in that layout; the rail itself is behind the Files button.
 */
export function Stepper({ phases, stepIndex, stepCount, highAhead, skippable, onStep }: Props) {
  return (
    <div className="flex h-16 flex-none items-center gap-6 border-b border-border bg-background px-6">
      <div className="flex min-w-0 flex-1 items-start overflow-x-auto">
        {phases.map((phase, at) => (
          <div
            key={`${phase.phase}-${at}`}
            className={cn(
              'flex flex-none flex-col gap-1.5 pr-5',
              at > 0 && 'ml-5 border-l border-dashed border-border pl-5',
            )}
          >
            <div className="flex items-center gap-1.5">
              {phase.steps.map((step) => (
                <button
                  key={step.index}
                  type="button"
                  className={cn(
                    'relative grid size-6 cursor-pointer place-items-center rounded-full border-[1.5px] border-border bg-card font-mono text-[11.5px] font-medium text-muted-foreground',
                    step.state === 'done' && 'border-ok bg-ok text-white',
                    step.state === 'current' &&
                      'border-walk bg-walk font-semibold text-white ring-4 ring-walk-ring',
                    step.high &&
                      'after:absolute after:-top-0.5 after:-right-0.5 after:size-2 after:rounded-full after:border-[1.5px] after:border-card after:bg-high',
                  )}
                  title={step.title}
                  aria-current={step.state === 'current' ? 'step' : undefined}
                  onClick={() => onStep(step.index)}
                >
                  {step.state === 'done' ? (
                    <Check className="size-3" strokeWidth={2.6} />
                  ) : (
                    step.step
                  )}
                </button>
              ))}
            </div>
            <span
              className={cn(
                'text-[11.5px] whitespace-nowrap text-muted-foreground',
                phase.current && 'font-semibold text-foreground',
              )}
            >
              {phase.label} · {phase.done} of {phase.total}
            </span>
          </div>
        ))}
        {phases.length === 0 && (
          <span className="text-xs text-muted-foreground">Nothing to walk in this PR.</span>
        )}
      </div>
      <div className="flex-none text-right text-xs leading-snug whitespace-nowrap text-muted-foreground">
        <div className="font-semibold text-foreground">
          {stepCount === 0 ? 'Nothing to walk' : `Step ${Math.max(0, stepIndex + 1)} of ${stepCount}`}
        </div>
        <div>
          {highAhead > 0 && (
            <>
              <span className="font-semibold text-high">{highAhead} high-risk</span> ahead
            </>
          )}
          {highAhead > 0 && skippable > 0 && ' · '}
          {skippable > 0 && `${skippable} hunks skippable`}
        </div>
      </div>
    </div>
  );
}
