import type { ReadySummary, SectionStatus } from '@review-cockpit/schema';
import { pendingLabel } from '../lib/derive';
import type { PhaseProgress } from '../lib/plan';
import { Markdown, MarkdownInline } from '../lib/markdown';
import { useEffect } from 'react';
import { ChevronDownIcon, ChevronRightIcon, CrossIcon, FilesIcon } from './Icons';

function CloseDetail({ onClose }: { onClose(): void }) {
  return (
    <button
      className="btn btn-icon plan-detail-close"
      onClick={onClose}
      aria-label="Close the brief"
      title="Close the brief (Esc)"
    >
      <CrossIcon size={12} />
    </button>
  );
}

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
    <div className="plan-phases">
      {phases.map((phase) => {
        const share = phase.total === 0 ? 0 : Math.round((phase.done / phase.total) * 100);
        const fill =
          share === 0
            ? 'var(--border)'
            : share === 100
              ? 'var(--success)'
              : `linear-gradient(90deg, var(--success) ${share}%, var(--border) ${share}%)`;
        return (
          <div className="plan-phase" key={phase.phase} style={{ width: barWidth(phase) }}>
            <div className="plan-bar" style={{ background: fill }} />
            <span className={`plan-phase-label${phase.current ? ' is-current' : ''}`}>
              {phase.label} {phase.done}/{phase.total}
            </span>
          </div>
        );
      })}
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
  const detailLabel =
    summary === null ? 'PR description' : 'Read the brief';

  return (
    <section className="plan">
      <div className="plan-tldr-row">
        <span className="plan-label">TL;DR</span>
        {summary === null ? (
          <span className={failed ? 'plan-failed' : 'plan-pending'}>{placeholder}</span>
        ) : (
          <span className="plan-tldr">
            <MarkdownInline text={summary.tldr} />
          </span>
        )}
      </div>

      <div className="plan-row">
        <button className="plan-disclosure" onClick={onToggle} aria-expanded={open}>
          <FilesIcon size={14} />
          <span>{detailLabel}</span>
          {summary !== null && summary.watchFor.length > 0 && (
            <span className="plan-disclosure-badge">{summary.watchFor.length} to watch for</span>
          )}
          {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
        </button>

        <PhaseBars phases={phases} />

        <div className="plan-position">
          {stepCount === 0
            ? 'Nothing to walk'
            : `Step ${Math.max(0, stepIndex + 1)} of ${stepCount}`}
          {highAhead > 0 && (
            <>
              {' · '}
              <span className="plan-high">{highAhead} high-risk</span> ahead
            </>
          )}
          {skippable > 0 && ` · ${skippable} hunks skippable`}
        </div>
      </div>

      {open && <div className="plan-backdrop" onClick={onToggle} />}
      {open &&
        (summary === null ? (
          <div className="plan-detail">
            <CloseDetail onClose={onToggle} />
            <div className="plan-panel">
              <Markdown className="plan-body" text={prBody || 'This PR has no description.'} />
            </div>
          </div>
        ) : (
          <div className="plan-detail plan-brief">
            <CloseDetail onClose={onToggle} />
            <div className="plan-col">
              <div className="plan-detail-label">Flow</div>
              <div className="plan-flow">
                <div className="plan-flow-row">
                  <span className="plan-flow-label">before</span>
                  <code>{summary.flow.before}</code>
                </div>
                <div className="plan-flow-row">
                  <span className="plan-flow-label">after</span>
                  <code>{summary.flow.after}</code>
                </div>
              </div>
              {summary.whereItFits.length > 0 && (
                <>
                  <div className="plan-detail-label">Where it fits</div>
                  <ul className="plan-bullets">
                    {summary.whereItFits.map((line) => (
                      <li key={line}>
                        <MarkdownInline text={line} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="plan-col">
              {summary.watchFor.length > 0 && (
                <>
                  <div className="plan-detail-label plan-detail-warn">Watch for</div>
                  <ul className="plan-bullets">
                    {summary.watchFor.map((line) => (
                      <li key={line}>
                        <MarkdownInline text={line} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {summary.example && (
                <>
                  <div className="plan-detail-label">Example</div>
                  <Markdown className="plan-body" text={summary.example} />
                </>
              )}
            </div>
          </div>
        ))}
    </section>
  );
}
