import type { Check, CheckStatus, PrInfo } from '../types';
import { shortSha } from '../lib/derive';

const icons: Record<CheckStatus, string> = {
  success: '✓',
  failure: '✗',
  pending: '●',
  neutral: '○',
  skipped: '○',
  cancelled: '○',
};

export type Tab = 'files' | 'map';

interface Props {
  pr: PrInfo;
  checks: Check[];
  checksPending: boolean;
  draftCount: number;
  tab: Tab;
  onTab(tab: Tab): void;
  onSubmit(): void;
  onHelp(): void;
}

export function Header({
  pr,
  checks,
  checksPending,
  draftCount,
  tab,
  onTab,
  onSubmit,
  onHelp,
}: Props) {
  return (
    <header className="header">
      <div className="header-top">
        <h1 className="header-title">
          <span className="header-number">
            {pr.repo} #{pr.number}
          </span>{' '}
          {pr.title}
        </h1>
        <div className="header-spacer" />
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'files'} onClick={() => onTab('files')}>
            Files
          </button>
          <button role="tab" aria-selected={tab === 'map'} onClick={() => onTab('map')}>
            Map
          </button>
        </div>
      </div>

      <div className="header-sub">
        {pr.author} wants to merge <code>{pr.head.ref}</code> into <code>{pr.base.ref}</code> ·{' '}
        <code title={pr.head.sha}>{shortSha(pr.head.sha)}</code> ·{' '}
        <a href={pr.url} target="_blank" rel="noreferrer">
          open on GitHub
        </a>
        {pr.labels.length > 0 && <> · {pr.labels.join(', ')}</>}
      </div>

      <div className="header-bottom">
        <div className="checks">
          {checksPending && <span className="label-pending">Loading checks…</span>}
          {!checksPending && checks.length === 0 && (
            <span className="empty">No checks reported</span>
          )}
          {checks.map((check) => (
            <a
              key={check.name}
              className={`check check-${check.status}`}
              href={check.url}
              target="_blank"
              rel="noreferrer"
              title={`${check.name}: ${check.status}`}
            >
              <span className="check-icon" aria-hidden="true">
                {icons[check.status]}
              </span>
              {check.name}
              <span className="tree-count">{check.status}</span>
            </a>
          ))}
        </div>
        <div className="header-spacer" />
        <span className="draft-count">
          <strong>{draftCount}</strong> {draftCount === 1 ? 'draft' : 'drafts'}
        </span>
        <button className="btn btn-small" onClick={onHelp} title="Keyboard shortcuts">
          ?
        </button>
        <button className="btn btn-primary" onClick={onSubmit}>
          Submit review
        </button>
      </div>
    </header>
  );
}
