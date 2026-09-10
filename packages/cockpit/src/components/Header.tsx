import type { ReactNode } from 'react';
import type { BotSummary, Check, PrInfo } from '@review-cockpit/schema';
import { shortSha } from '../lib/derive';
import { Markdown } from '../lib/markdown';
import {
  ArrowRightIcon,
  BotIcon,
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
  checksFailed: string | null;
  botSummaries: BotSummary[];
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
  passedChecks: Check[];
  failed: Check[];
  runningChecks: Check[];
  otherChecks: Check[];
}

function pillsOf(checks: Check[]): Pills {
  const passed = checks.filter((check) => check.status === 'success');
  return {
    passed: { count: passed.length, names: passed.map((check) => check.name) },
    passedChecks: passed,
    failed: checks.filter((check) => check.status === 'failure'),
    runningChecks: checks.filter((check) => check.status === 'pending'),
    otherChecks: checks.filter((check) =>
      ['neutral', 'skipped', 'cancelled'].includes(check.status),
    ),
  };
}

/** GitHub's own checks tab, which is where a pill standing for several checks goes. */
function checksTab(pr: PrInfo): string {
  return `${pr.url}/checks`;
}

function GroupPill({
  className,
  checks,
  pr,
  title,
  children,
}: {
  className: string;
  checks: Check[];
  pr: PrInfo;
  title: string;
  children: ReactNode;
}) {
  const single = checks.length === 1 ? checks[0] : undefined;
  return (
    <a
      className={`pill ${className}`}
      href={single ? single.url : checksTab(pr)}
      target="_blank"
      rel="noreferrer"
      title={title}
    >
      {children}
    </a>
  );
}

function CheckPills({ checks, pending, failed, pr }: { checks: Check[]; pending: boolean; failed: string | null; pr: PrInfo }) {
  if (failed !== null) {
    return (
      <span className="pill pill-fail" title={failed}>
        <CrossIcon size={10} /> Checks unavailable
      </span>
    );
  }
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
        <GroupPill className="pill-pass" checks={pills.passedChecks} pr={pr} title={pills.passed.names.join(', ')}>
          <CheckIcon size={10} /> {pills.passed.count}{' '}
          {pills.passed.count === 1 ? 'check' : 'checks'} passed
        </GroupPill>
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
      {pills.runningChecks.length > 0 && (
        <GroupPill
          className="pill-running"
          checks={pills.runningChecks}
          pr={pr}
          title={pills.runningChecks.map((check) => check.name).join(', ')}
        >
          <ClockIcon size={10} /> {pills.runningChecks.length} running
        </GroupPill>
      )}
      {pills.otherChecks.length > 0 && (
        <GroupPill
          className="pill-muted"
          checks={pills.otherChecks}
          pr={pr}
          title={pills.otherChecks.map((check) => `${check.name}: ${check.status}`).join(', ')}
        >
          <DashIcon size={10} /> {pills.otherChecks.length} skipped
        </GroupPill>
      )}
    </>
  );
}

/** "Cursor Bugbot" is the pill's own subject, so the pill says "Bugbot". */
function shortBotName(name: string): string {
  return name.replace(/^cursor\s+/i, '');
}

function BotSummaryPill({ summary }: { summary: BotSummary }) {
  const level = summary.riskLevel;
  const className = level === 'high' ? 'pill-fail' : level === 'medium' ? 'pill-running' : 'pill-muted';
  return (
    <div className="pill-hover">
      <a
        className={`pill ${className}`}
        href={summary.url}
        target="_blank"
        rel="noreferrer"
      >
        <BotIcon size={10} /> {shortBotName(summary.source.name)}:{' '}
        {level === null ? 'summary' : `${level} risk`}
      </a>
      <div className="hovercard" role="note">
        <span className="hovercard-head">
          {summary.source.name}
          {level !== null && ` · ${level} risk`}
        </span>
        <Markdown text={summary.body} className="hovercard-body" />
      </div>
    </div>
  );
}

export function Header({
  pr,
  checks,
  checksPending,
  checksFailed,
  botSummaries,
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
          <div className="header-checks">
            <CheckPills checks={checks} pending={checksPending} failed={checksFailed} pr={pr} />
            {botSummaries.map((summary) => (
              <BotSummaryPill key={summary.source.name} summary={summary} />
            ))}
          </div>
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
