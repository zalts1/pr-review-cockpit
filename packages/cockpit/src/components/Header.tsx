import type { Check, PrInfo } from '@review-cockpit/schema';
import { shortSha } from '../lib/derive';
import {
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  CrossIcon,
  DashIcon,
  FilesIcon,
  KeyboardIcon,
  MapIcon,
} from './Icons';

export type Tab = 'files' | 'map';

interface Props {
  pr: PrInfo;
  checks: Check[];
  checksPending: boolean;
  draftCount: number;
  nextLabel: string | null;
  tab: Tab;
  onTab(tab: Tab): void;
  onNext(): void;
  onSubmit(): void;
  onHelp(): void;
}

interface Pills {
  passed: { count: number; names: string[] };
  failed: Check[];
  running: number;
  other: number;
}

function pillsOf(checks: Check[]): Pills {
  const passed = checks.filter((check) => check.status === 'success');
  return {
    passed: { count: passed.length, names: passed.map((check) => check.name) },
    failed: checks.filter((check) => check.status === 'failure'),
    running: checks.filter((check) => check.status === 'pending').length,
    other: checks.filter((check) =>
      ['neutral', 'skipped', 'cancelled'].includes(check.status),
    ).length,
  };
}

function CheckPills({ checks, pending }: { checks: Check[]; pending: boolean }) {
  if (pending) {
    return (
      <span className="pill pill-running">
        <ClockIcon size={10} /> Loading checks
      </span>
    );
  }
  if (checks.length === 0) return <span className="pill pill-muted">No checks reported</span>;

  const pills = pillsOf(checks);
  return (
    <>
      {pills.passed.count > 0 && (
        <span className="pill pill-pass" title={pills.passed.names.join(', ')}>
          <CheckIcon size={10} /> {pills.passed.count}{' '}
          {pills.passed.count === 1 ? 'check' : 'checks'} passed
        </span>
      )}
      {pills.failed.map((check) => (
        <a
          key={check.name}
          className="pill pill-fail"
          href={check.url}
          target="_blank"
          rel="noreferrer"
          title={`${check.name} failed`}
        >
          <CrossIcon size={10} /> {check.name} failed
        </a>
      ))}
      {pills.running > 0 && (
        <span className="pill pill-running">
          <ClockIcon size={10} /> {pills.running} running
        </span>
      )}
      {pills.other > 0 && (
        <span className="pill pill-muted">
          <DashIcon size={10} /> {pills.other} skipped
        </span>
      )}
    </>
  );
}

export function Header({
  pr,
  checks,
  checksPending,
  draftCount,
  nextLabel,
  tab,
  onTab,
  onNext,
  onSubmit,
  onHelp,
}: Props) {
  return (
    <header className="header">
      <div className="header-identity">
        <div className="header-line">
          <span className="header-repo">{pr.repo}</span>
          <h1 className="header-title">
            <a href={pr.url} target="_blank" rel="noreferrer">
              {pr.title}
            </a>
          </h1>
          <span className="header-number">#{pr.number}</span>
          {pr.draft && <span className="pill pill-muted">draft</span>}
        </div>
        <div className="header-meta">
          <span>{pr.author}</span>
          <span className="header-dot">·</span>
          <code>{pr.head.ref}</code>
          <ArrowRightIcon size={11} className="header-arrow" />
          <code>{pr.base.ref}</code>
          <span className="header-dot">·</span>
          <code title={pr.head.sha}>{shortSha(pr.head.sha)}</code>
          <span className="header-checks">
            <CheckPills checks={checks} pending={checksPending} />
          </span>
        </div>
      </div>

      <div className="header-actions">
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'files'}
            onClick={() => onTab('files')}
            title="Files (m)"
          >
            <FilesIcon size={12} /> Files
          </button>
          <button
            role="tab"
            aria-selected={tab === 'map'}
            onClick={() => onTab('map')}
            title="Map (m)"
          >
            <MapIcon size={12} /> Map
          </button>
        </div>
        <span className="draft-count">
          {draftCount} {draftCount === 1 ? 'draft' : 'drafts'}
        </span>
        <button className="btn btn-icon" onClick={onHelp} title="Keyboard shortcuts (?)">
          <KeyboardIcon size={14} />
        </button>
        <button className="btn" onClick={onSubmit}>
          Submit review
        </button>
        <button
          className="btn btn-primary"
          onClick={onNext}
          disabled={nextLabel === null}
          title="Go to the next step of the review path (n)"
        >
          {nextLabel === null ? 'Walk complete' : `Next: ${nextLabel}`}
          <ArrowRightIcon size={12} />
        </button>
      </div>
    </header>
  );
}
