import type { Phase } from '@review-cockpit/schema';
import { PHASE_LABELS } from '../lib/plan';
import { ChevronLeftIcon, CheckIcon, SparkIcon } from './Icons';

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
    <div className="step-card">
      <div className="step-number">
        <span className="step-number-label">STEP</span>
        <span className="step-number-value">{step}</span>
        <span className="step-number-of">of {total}</span>
      </div>

      <div className="step-body">
        <div className="step-where">
          <span className="step-phase">{PHASE_LABELS[phase]}</span>
          <span className="step-sep">·</span>
          <code>{symbol ?? fileLabel}</code>
        </div>
        <div className="step-note">
          {note ?? <span className="empty">No note for this step. Read it on its own terms.</span>}
        </div>
      </div>

      <div className="step-actions">
        <button className="btn btn-small" onClick={onPrev} disabled={!canPrev} title="Previous step (p)">
          <ChevronLeftIcon size={11} /> Prev
        </button>
        <button
          className={`btn btn-small${reviewed ? ' is-on' : ''}`}
          onClick={onMarkReviewed}
          title="Mark this file viewed and move on (v then n)"
        >
          <CheckIcon size={12} /> Mark reviewed
        </button>
        <button
          className="btn btn-small"
          onClick={onAsk}
          disabled={!canAsk}
          title="Copy a prompt about this hunk to the clipboard (a)"
        >
          <SparkIcon size={13} /> Ask Claude about this hunk
        </button>
      </div>
    </div>
  );
}
