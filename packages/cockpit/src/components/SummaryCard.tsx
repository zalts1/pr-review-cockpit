import type { SectionStatus, Summary } from '../types';

interface Props {
  summary: Summary | null;
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
        {collapsed && summary && <span className="summary-collapsed">{summary.oneLiner}</span>}
      </button>

      {!collapsed && (
        <>
          {summary ? (
            <>
              <p className="summary-oneliner">{summary.oneLiner}</p>
              {summary.reviewFocus.length > 0 && (
                <ul className="summary-focus">
                  {summary.reviewFocus.map((focus) => (
                    <li key={focus}>{focus}</li>
                  ))}
                </ul>
              )}
              <div className="summary-counts">
                {summary.counts.hunks} hunks · {summary.counts.highRisk} high risk ·{' '}
                {summary.counts.skimmable} skimmable
              </div>
            </>
          ) : (
            <p className="summary-body">{prBody || 'This PR has no description.'}</p>
          )}
        </>
      )}
    </section>
  );
}
