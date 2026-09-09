import type { ReadySummary, SectionStatus } from '@review-cockpit/schema';
import type { ReviewPath } from '../lib/derive';
import { pendingLabel } from '../lib/derive';
import { Markdown, MarkdownInline } from '../lib/markdown';

interface Props {
  summary: ReadySummary | null;
  status: SectionStatus;
  prBody: string;
  path: ReviewPath;
  collapsed: boolean;
  onToggle(): void;
}

export function SummaryCard({ summary, status, prBody, path, collapsed, onToggle }: Props) {
  const pending = status.state === 'pending';
  const failed = status.state === 'failed';

  return (
    <section className="card summary">
      <button className="summary-head" onClick={onToggle} aria-expanded={!collapsed}>
        <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        <span>Summary</span>
        {pending && <span className="label-pending">{pendingLabel(status)}</span>}
        {failed && <span className="label-pending">Summary unavailable</span>}
        {collapsed && summary && <span className="summary-collapsed">{summary.tldr}</span>}
      </button>

      {!collapsed &&
        (summary ? (
          <>
            <p className="summary-oneliner">
              <MarkdownInline text={summary.tldr} />
            </p>

            {summary.whereItFits.length > 0 && (
              <>
                <div className="summary-label">Where it fits</div>
                <ul className="summary-focus">
                  {summary.whereItFits.map((line) => (
                    <li key={line}>
                      <MarkdownInline text={line} />
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="summary-flow">
              <div>
                <span className="summary-flow-label">before:</span>
                <span className="summary-flow-line">{summary.flow.before}</span>
              </div>
              <div>
                <span className="summary-flow-label">after:</span>
                <span className="summary-flow-line">{summary.flow.after}</span>
              </div>
            </div>

            {summary.example && <Markdown className="summary-example" text={summary.example} />}

            {path.rows.length > 0 && (
              <>
                <div className="summary-label">Review path</div>
                <table className="summary-path">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>file</th>
                      <th>why here</th>
                      <th>what it does</th>
                    </tr>
                  </thead>
                  <tbody>
                    {path.rows.map((row) => (
                      <tr key={row.step}>
                        <td>{row.step}</td>
                        <td className="summary-path-file">{row.file}</td>
                        <td>{row.why ? <MarkdownInline text={row.why} /> : '—'}</td>
                        <td className="summary-path-file">{row.what}</td>
                      </tr>
                    ))}
                    {path.more && (
                      <tr className="summary-path-more">
                        <td>…</td>
                        <td colSpan={3}>
                          and {path.more.steps} more steps: {path.more.phases.join(', ')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </>
            )}

            {summary.watchFor.length > 0 && (
              <>
                <div className="summary-label">Watch for</div>
                <ul className="summary-focus">
                  {summary.watchFor.map((line) => (
                    <li key={line}>
                      <MarkdownInline text={line} />
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="summary-counts">
              {summary.counts.hunks} hunks · {summary.counts.highRisk} high risk ·{' '}
              {summary.counts.skimmable} skimmable
            </div>
          </>
        ) : (
          <Markdown className="summary-body" text={prBody || 'This PR has no description.'} />
        ))}
    </section>
  );
}
