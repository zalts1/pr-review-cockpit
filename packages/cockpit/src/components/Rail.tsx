import type { ReactNode, RefObject } from 'react';
import type { Comment, ConversationComment, Draft, RiskLevel } from '@review-cockpit/schema';
import { Check, ChevronRight } from 'lucide-react';
import { draftTarget, preview } from '../lib/drafts';
import type { RailEntry, SkippableEntry } from '../lib/plan';
import { railPath } from '../lib/plan';
import { cn } from '../lib/utils';

interface Props {
  entries: RailEntry[];
  skippable: SkippableEntry[];
  currentIndex: number;
  currentFileId: string | null;
  currentGroupId: string | null;
  viewed: Set<string>;
  /** The label for a pending path section, or null when the walk is the real one. */
  pathPending: string | null;
  fileCount: number;
  outdated: Comment[];
  /** Drafts a re-analysis could not place in the new diff. */
  orphaned: Draft[];
  orphansRef: RefObject<HTMLDivElement>;
  conversation: ConversationComment[];
  onEntry(entry: RailEntry): void;
  onSkippable(groupId: string): void;
}

const heatWord: Record<RiskLevel, string> = {
  high: 'high risk',
  medium: 'medium risk',
  low: 'low risk',
};

function HeatDot({ level }: { level: RiskLevel }) {
  if (level === 'low') return null;
  return (
    <span
      className={cn(
        'size-[7px] flex-none rounded-full',
        level === 'high' ? 'bg-high' : 'border-[1.5px] border-medium',
      )}
      title={heatWord[level]}
    />
  );
}

function SectionHead({ title, count }: { title: string; count?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-4 pb-2 text-[11px] font-semibold text-muted-foreground">
      <span>{title}</span>
      {count !== undefined && <span className="font-normal whitespace-nowrap">{count}</span>}
    </div>
  );
}

function Divider() {
  return <div className="mx-4 mt-3 mb-2 border-t border-border" />;
}

const noteClass = 'px-4 pb-2 text-xs text-muted-foreground';
const itemLinkClass = 'font-mono text-[11px]';

export function Rail({
  entries,
  skippable,
  currentIndex,
  currentFileId,
  currentGroupId,
  viewed,
  pathPending,
  fileCount,
  outdated,
  orphaned,
  orphansRef,
  conversation,
  onEntry,
  onSkippable,
}: Props) {
  return (
    <nav className="py-3.5 pb-6 text-[13px]" aria-label="Review path">
      <SectionHead
        title="Review path"
        count={
          <span title={`${fileCount} ${fileCount === 1 ? 'file' : 'files'} changed in this PR`}>
            {fileCount} changed
          </span>
        }
      />

      {pathPending !== null && (
        <div className={noteClass}>
          Recommended order: {pathPending.toLowerCase()}. Walking files in order, riskiest hunk
          of each first.
        </div>
      )}

      {/* The spine: one line through every step's number, the way a numbered
          list reads as one route rather than a set of files. */}
      <ul className="relative m-0 list-none px-2 before:absolute before:top-3.5 before:bottom-3.5 before:left-[27px] before:w-px before:bg-border">
        {entries.map((entry) => {
          // A file the walk visits at several steps has one row, so the row is
          // current whenever the walk is anywhere inside that file.
          const current =
            entry.kind === 'file'
              ? entry.fileId === currentFileId
              : entry.groupId === currentGroupId;
          const done =
            !current &&
            (entry.stepIndex < currentIndex ||
              (entry.kind === 'file' && viewed.has(entry.fileId)));
          const label = entry.kind === 'file' ? railPath(entry.path) : entry.title;
          const tip = [
            entry.kind === 'file' ? entry.path : entry.title,
            `step ${entry.step}`,
            entry.note ?? 'no step note',
          ].join(' · ');
          return (
            <li key={entry.id} className="relative">
              <button
                type="button"
                className={cn(
                  'grid w-full cursor-pointer grid-cols-[22px_1fr_auto] items-center gap-2.5 rounded-md px-2 py-[5px] text-left text-muted-foreground hover:bg-muted',
                  current && 'bg-walk-wash text-foreground hover:bg-walk-wash',
                )}
                onClick={() => onEntry(entry)}
                title={tip}
              >
                <span
                  className={cn(
                    'relative z-[1] grid size-[22px] place-items-center rounded-full border-[1.5px] border-border bg-card font-mono text-[11px] font-medium text-muted-foreground',
                    done && 'border-ok bg-ok text-white',
                    current && 'border-walk bg-walk text-white ring-[3px] ring-walk-ring',
                  )}
                >
                  {done ? <Check className="size-[11px]" strokeWidth={2.6} /> : entry.step}
                </span>
                <span
                  className={cn(
                    'truncate',
                    entry.kind === 'file' ? 'font-mono text-xs' : 'text-[12.5px]',
                    current && 'font-semibold',
                  )}
                >
                  {label}
                </span>
                {!done && entry.kind === 'file' && <HeatDot level={entry.heat} />}
              </button>
            </li>
          );
        })}
        {entries.length === 0 && (
          <li>
            <div className={noteClass}>
              {fileCount === 0 ? 'No files changed.' : 'Nothing to walk in this PR.'}
            </div>
          </li>
        )}
      </ul>

      {skippable.length > 0 && (
        <>
          <Divider />
          <SectionHead title="Skippable" />
          <ul className="m-0 list-none p-0">
            {skippable.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 px-4 py-1.5 text-left text-[12.5px] whitespace-nowrap hover:bg-muted',
                    group.id === currentGroupId && 'bg-walk-wash',
                  )}
                  onClick={() => onSkippable(group.id)}
                  title={`${group.title} · ${group.hunkCount} hunks · skim`}
                >
                  <ChevronRight className="size-[11px] flex-none text-subtle" />
                  <span className="min-w-0 flex-1 truncate">{group.title}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {group.fileCount} {group.fileCount === 1 ? 'file' : 'files'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {outdated.length > 0 && (
        <>
          <Divider />
          <SectionHead title="Outdated comments" count={outdated.length} />
          <ul className="m-0 flex list-none flex-col gap-2 px-4">
            {outdated.map((comment) => (
              <li key={comment.id} className="flex flex-col text-xs text-muted-foreground">
                <a href={comment.url} target="_blank" rel="noreferrer" className={itemLinkClass}>
                  {railPath(comment.path)}:{comment.line}
                </a>
                <span>
                  {comment.author}: {preview(comment.body, 52)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {orphaned.length > 0 && (
        <div ref={orphansRef}>
          <Divider />
          <SectionHead title="Drafts that did not re-attach" count={orphaned.length} />
          <div className={noteClass}>
            New commits moved or removed these lines. Copy what you still want to say onto a
            line the current diff has.
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 px-4">
            {orphaned.map((draft) => (
              <li key={draft.id} className="flex flex-col text-xs text-muted-foreground">
                <span className={itemLinkClass}>{draftTarget(draft)}</span>
                <span>{preview(draft.body, 72)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {conversation.length > 0 && (
        <>
          <Divider />
          <details>
            <summary className="flex cursor-pointer items-center justify-between px-4 pb-2 text-[11px] font-semibold text-muted-foreground marker:text-subtle">
              <span>Conversation</span>
              <span className="font-normal">{conversation.length}</span>
            </summary>
            <ul className="m-0 flex list-none flex-col gap-2 px-4">
              {conversation.map((comment) => (
                <li key={comment.id} className="flex flex-col text-xs text-muted-foreground">
                  <a href={comment.url} target="_blank" rel="noreferrer" className={itemLinkClass}>
                    {comment.source.name}
                    {comment.path === null ? '' : ` · ${railPath(comment.path)}`}
                  </a>
                  <span>{preview(comment.body, 72)}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </nav>
  );
}
