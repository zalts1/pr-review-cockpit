import type { ReadySummary, SectionStatus } from '@review-cockpit/schema';
import { pendingLabel } from '../lib/derive';
import type { PhaseProgress } from '../lib/plan';
import { Markdown, MarkdownInline } from '../lib/markdown';
import { ChevronDownIcon, ChevronRightIcon } from './Icons';

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
  const pending = status.state === 'pending';
  const failed = status.state === 'failed';
  const placeholder = pending ? pendingLabel(status) : 'Summary unavailable';
  const detailLabel =
    summary === null ? 'PR description' : 'Before and after, and what to watch for';

  return (
    <section className="plan">
      <div className="plan-row">
        <div className="plan-tldr">
          <span className="plan-label">TL;DR</span>
          {summary === null ? (
            <span className={failed ? 'plan-failed' : 'plan-pending'}>{placeholder}</span>
          ) : (
            <MarkdownInline text={summary.tldr} />
          )}
        </div>

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

      <button className="plan-disclosure" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
        <span>{detailLabel}</span>
        {!open && summary !== null && summary.watchFor.length > 0 && (
          <span className="plan-disclosure-hint">
            <MarkdownInline text={summary.watchFor[0] as string} />
          </span>
        )}
      </button>

      {open &&
        (summary === null ? (
          <div className="plan-detail">
            <div className="plan-panel">
              <Markdown className="plan-body" text={prBody || 'This PR has no description.'} />
            </div>
          </div>
        ) : (
          <div className="plan-detail">
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

            {summary.watchFor.length > 0 && (
              <div>
                <div className="plan-detail-label plan-detail-warn">Watch for</div>
                <ul className="plan-bullets">
                  {summary.watchFor.map((line) => (
                    <li key={line}>
                      <MarkdownInline text={line} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(summary.whereItFits.length > 0 || summary.example) && (
              <details className="plan-example">
                <summary>Where it fits, and one concrete example</summary>
                <div className="plan-example-body">
                  {summary.whereItFits.length > 0 && (
                    <ul className="plan-bullets">
                      {summary.whereItFits.map((line) => (
                        <li key={line}>
                          <MarkdownInline text={line} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {summary.example && <Markdown className="plan-body" text={summary.example} />}
                </div>
              </details>
            )}
          </div>
        ))}
    </section>
  );
}
