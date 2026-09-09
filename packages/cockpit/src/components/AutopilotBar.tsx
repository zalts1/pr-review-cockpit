import type { PathStep } from '@review-cockpit/schema';

interface Props {
  steps: PathStep[];
  index: number;
  /** The label for a pending path section, or null when it is not pending. */
  pathPending: string | null;
  stage2Failed: boolean;
  totalHigh: number;
  highRemaining: number;
  onPrev(): void;
  onNext(): void;
  onSkipHigh(): void;
}

function phasePosition(steps: PathStep[], index: number): string | null {
  const step = steps[index];
  if (!step) return null;
  const inPhase = steps.filter((s) => s.phase === step.phase);
  const position = inPhase.findIndex((s) => s.step === step.step) + 1;
  return `${step.phase} ${position}/${inPhase.length}`;
}

export function AutopilotBar({
  steps,
  index,
  pathPending,
  stage2Failed,
  totalHigh,
  highRemaining,
  onPrev,
  onNext,
  onSkipHigh,
}: Props) {
  const step = steps[index];
  const position = phasePosition(steps, index);

  const highText =
    totalHigh === 0
      ? `no high-risk hunks · ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}${
          stage2Failed ? ' · based on code signals only' : ''
        }`
      : highRemaining === 0
        ? 'all high-risk hunks seen'
        : `${highRemaining} high-risk remaining`;

  return (
    <div className="autopilot">
      <div className="autopilot-row">
        <span className="autopilot-label">
          {pathPending === null ? 'Autopilot' : `Recommended order: ${pathPending.toLowerCase()}`}
        </span>
        <button className="btn btn-small" onClick={onPrev} disabled={index <= 0}>
          ◀ Prev
        </button>
        <button
          className="btn btn-small"
          onClick={onNext}
          disabled={steps.length === 0 || index >= steps.length - 1}
        >
          Next ▶
        </button>
        <span
          className={`autopilot-progress${highRemaining === 0 && totalHigh > 0 ? ' is-done' : ''}`}
        >
          {position ? `${position} · ` : ''}
          {highText}
        </span>
        <div className="header-spacer" />
        <span className="autopilot-step">
          {steps.length === 0
            ? 'Nothing to walk'
            : index < 0
              ? `Step 0 of ${steps.length}`
              : `Step ${index + 1} of ${steps.length}`}
        </span>
        <button className="btn btn-small" onClick={onSkipHigh} disabled={highRemaining === 0}>
          Skip to next high-risk
        </button>
      </div>
      <div className="autopilot-note">
        {step ? (
          step.note ? (
            <>“{step.note}”</>
          ) : (
            <em>
              {step.ref.kind === 'group' ? 'Group' : 'Hunk'} {step.ref.id} · no note
            </em>
          )
        ) : (
          <em>Press Next to start the walkthrough.</em>
        )}
      </div>
    </div>
  );
}
