import type { ReadySummary, SectionStatus } from '@review-cockpit/schema';
import { Markdown } from '../lib/markdown';

interface Props {
  summary: ReadySummary | null;
  status: SectionStatus;
  prBody: string;
  collapsed: boolean;
  onToggle(): void;
}

export function SummaryCard({ summary, status, prBody, collapsed, onToggle }: Props) {
  const pending = status.state === 'pending';
  const failed = status.state === 'failed';

  return (
    <section className="card summary">
      <button className="summary-head" onClick={onToggle} aria-expanded={!collapsed}>
        <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        <span>Summary</span>
        {pending && <span className="label-pending">Analyzing summary…</span>}
        {failed && <span className="label-pending">Summary unavailable</span>}
        {collapsed && summary && <span className="summary-collapsed">{summary.tldr}</span>}
      </button>

      {!collapsed && (
        <>
          {summary ? (
            <>
              <p className="summary-oneliner">{summary.tldr}</p>
              {summary.whereItFits.length > 0 && (
                <ul className="summary-focus">
                  {summary.whereItFits.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              <div className="summary-flow">
                <div>
                  <span className="summary-flow-label">before:</span> {summary.flow.before}
                </div>
                <div>
                  <span className="summary-flow-label">after:</span> {summary.flow.after}
                </div>
              </div>
              <p className="summary-body">{summary.example}</p>
              {summary.watchFor.length > 0 && (
                <ul className="summary-focus">
                  {summary.watchFor.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              <div className="summary-counts">
                {summary.counts.hunks} hunks · {summary.counts.highRisk} high risk ·{' '}
                {summary.counts.skimmable} skimmable
              </div>
            </>
          ) : (
            <Markdown className="summary-body" text={prBody || 'This PR has no description.'} />
          )}
        </>
      )}
    </section>
  );
}
