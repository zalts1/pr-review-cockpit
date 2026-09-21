import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { BotSummary, Check, PrInfo } from '@review-cockpit/schema';
import {
  ArrowRight,
  Bot,
  Check as CheckMark,
  ChevronRight,
  Clock,
  Keyboard,
  Loader2,
  Minus,
  Moon,
  RefreshCw,
  Sun,
  X,
} from 'lucide-react';
import { shortSha } from '../lib/derive';
import { Markdown } from '../lib/markdown';
import type { Theme } from '../lib/theme';
import { cn } from '../lib/utils';
import { Badge, BadgeLink } from './ui/badge';
import { Button } from './ui/button';
import { TabsList, TabsTrigger } from './ui/tabs';

export type Tab = 'files' | 'map';

interface Props {
  pr: PrInfo;
  checks: Check[];
  checksPending: boolean;
  checksFailed: string | null;
  botSummaries: BotSummary[];
  draftCount: number;
  nextLabel: string | null;
  /** Null in fixture mode, where there is no server to fetch from. */
  onRefresh: (() => void) | null;
  refreshing: boolean;
  refreshError: string | null;
  tab: Tab;
  theme: Theme;
  onTab(tab: Tab): void;
  onNext(): void;
  onSubmit(): void;
  /** Null in fixture mode, where there is no server to finish. */
  onFinish: (() => void) | null;
  onHelp(): void;
  onTheme(): void;
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
  variant,
  checks,
  pr,
  title,
  children,
}: {
  variant: 'ok' | 'high' | 'medium' | 'muted';
  checks: Check[];
  pr: PrInfo;
  title: string;
  children: ReactNode;
}) {
  const single = checks.length === 1 ? checks[0] : undefined;
  return (
    <BadgeLink variant={variant} href={single ? single.url : checksTab(pr)} title={title}>
      {children}
    </BadgeLink>
  );
}

function CheckPills({
  checks,
  pending,
  failed,
  pr,
}: {
  checks: Check[];
  pending: boolean;
  failed: string | null;
  pr: PrInfo;
}) {
  if (failed !== null) {
    return (
      <Badge variant="high" title={failed}>
        <X /> Checks unavailable
      </Badge>
    );
  }
  if (pending) {
    return (
      <Badge variant="medium">
        <Clock /> Loading checks
      </Badge>
    );
  }
  if (checks.length === 0) return <Badge variant="muted">No checks reported</Badge>;

  const pills = pillsOf(checks);
  return (
    <>
      {pills.passed.count > 0 && (
        <GroupPill
          variant="ok"
          checks={pills.passedChecks}
          pr={pr}
          title={pills.passed.names.join(', ')}
        >
          <CheckMark /> {pills.passed.count} {pills.passed.count === 1 ? 'check' : 'checks'}{' '}
          passed
        </GroupPill>
      )}
      {pills.failed.map((check) => (
        <BadgeLink key={check.name} variant="high" href={check.url} title={`${check.name} failed`}>
          <X /> {check.name} failed
        </BadgeLink>
      ))}
      {pills.runningChecks.length > 0 && (
        <GroupPill
          variant="medium"
          checks={pills.runningChecks}
          pr={pr}
          title={pills.runningChecks.map((check) => check.name).join(', ')}
        >
          <Clock /> {pills.runningChecks.length} running
        </GroupPill>
      )}
      {pills.otherChecks.length > 0 && (
        <GroupPill
          variant="muted"
          checks={pills.otherChecks}
          pr={pr}
          title={pills.otherChecks.map((check) => `${check.name}: ${check.status}`).join(', ')}
        >
          <Minus /> {pills.otherChecks.length} skipped
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
  const variant = level === 'high' ? 'high' : level === 'medium' ? 'medium' : 'muted';
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-flex" ref={root}>
      <button
        type="button"
        className={cn(
          'inline-flex h-5 cursor-pointer items-center gap-1 rounded-full px-2 text-[11px] font-medium [&_svg]:size-2.5',
          variant === 'high' && 'bg-high-wash text-high',
          variant === 'medium' && 'bg-medium-wash text-medium',
          variant === 'muted' && 'bg-muted text-muted-foreground',
        )}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Bot /> {shortBotName(summary.source.name)}: {level === null ? 'summary' : `${level} risk`}
      </button>
      {open && (
        <div
          className="absolute top-[calc(100%+6px)] left-0 z-40 max-h-[420px] w-[460px] overflow-y-auto rounded-md border border-border bg-card p-3 text-left text-[13px] whitespace-normal shadow-pop"
          role="dialog"
        >
          <div className="mb-1.5 flex items-baseline justify-between text-[11px] font-semibold text-muted-foreground">
            <span>
              {summary.source.name}
              {level !== null && ` · ${level} risk`}
            </span>
            <a href={summary.url} target="_blank" rel="noreferrer" className="font-medium">
              Open on GitHub
            </a>
          </div>
          <Markdown text={summary.body} />
        </div>
      )}
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
  onRefresh,
  refreshing,
  refreshError,
  tab,
  theme,
  onTab,
  onNext,
  onSubmit,
  onFinish,
  onHelp,
  onTheme,
}: Props) {
  return (
    <header
      // Above the plan row, or the strip wins the tie on DOM order and paints
      // over the bot summary card this stacking context caps.
      className="relative z-40 flex min-h-[60px] flex-none items-center gap-3 border-b border-border bg-background px-5 py-2"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
          <span className="text-sm text-muted-foreground">{pr.repo}</span>
          <h1 className="m-0 min-w-0 truncate text-[15px] font-semibold">
            <a href={pr.url} target="_blank" rel="noreferrer" className="text-foreground">
              {pr.title}
            </a>
          </h1>
          <span className="text-sm text-subtle">#{pr.number}</span>
          {pr.draft && <Badge variant="muted">draft</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <span>{pr.author}</span>
          <span className="text-subtle">·</span>
          <code className="text-[11.5px]">{pr.head.ref}</code>
          <ArrowRight className="size-[11px] text-subtle" />
          <code className="text-[11.5px]">{pr.base.ref}</code>
          <span className="text-subtle">·</span>
          <code className="text-[11.5px]" title={pr.head.sha}>
            {shortSha(pr.head.sha)}
          </code>
          <span className="ml-1 inline-flex flex-wrap items-center gap-1.5">
            <CheckPills checks={checks} pending={checksPending} failed={checksFailed} pr={pr} />
            {botSummaries.map((summary) => (
              <BotSummaryPill key={summary.source.name} summary={summary} />
            ))}
            {onRefresh !== null && (
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn('size-[22px]', refreshError !== null && 'text-high')}
                onClick={onRefresh}
                disabled={refreshing}
                aria-label="Refresh from GitHub"
                title={
                  refreshError ??
                  (refreshing
                    ? 'Reading the comments and checks from GitHub…'
                    : 'Refresh from GitHub: read the comments and checks again')
                }
              >
                {refreshing ? (
                  <Loader2 className="size-3 spinner" />
                ) : (
                  <RefreshCw className="size-3" />
                )}
              </Button>
            )}
          </span>
        </div>
      </div>

      <TabsList>
        <TabsTrigger selected={tab === 'files'} onClick={() => onTab('files')} title="Files (m)">
          Files
        </TabsTrigger>
        <TabsTrigger selected={tab === 'map'} onClick={() => onTab('map')} title="Map (m)">
          Map
        </TabsTrigger>
      </TabsList>

      <div className="flex flex-none items-center gap-1.5">
        <span className="mx-1 text-xs whitespace-nowrap text-muted-foreground">
          {draftCount} {draftCount === 1 ? 'draft' : 'drafts'}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onTheme}
          title={`Switch to the ${theme === 'dark' ? 'light' : 'dark'} theme (t)`}
          aria-label={`Switch to the ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={onHelp} title="Keyboard shortcuts (?)">
          <Keyboard className="size-3.5" />
        </Button>
        <Button onClick={onSubmit}>Submit review</Button>
        {onFinish !== null && (
          <Button onClick={onFinish} title="Stop the local server and remove the checkout">
            Finish review
          </Button>
        )}
        <Button
          variant="default"
          onClick={onNext}
          disabled={nextLabel === null}
          title="Go to the next step of the review path (n)"
        >
          {nextLabel === null ? 'Walk complete' : `Next: ${nextLabel}`}
          <ChevronRight className="size-3" />
        </Button>
      </div>
    </header>
  );
}
