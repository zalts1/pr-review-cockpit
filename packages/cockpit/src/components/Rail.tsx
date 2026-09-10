import type { RefObject } from 'react';
import type { Comment, ConversationComment, Draft, RiskLevel } from '@review-cockpit/schema';
import { draftTarget, preview } from '../lib/drafts';
import type { RailEntry, SkippableEntry } from '../lib/plan';
import { railPath } from '../lib/plan';
import { CheckIcon, ChevronRightIcon } from './Icons';

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
  if (level === 'low') return <span className="rail-dot rail-dot-none" />;
  return <span className={`rail-dot rail-dot-${level}`} title={heatWord[level]} />;
}

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
    <nav className="rail" aria-label="Review path">
      <div className="rail-head">
        <span className="rail-title">Review path</span>
        <span
          className="rail-count"
          title={`${fileCount} ${fileCount === 1 ? 'file' : 'files'} changed in this PR`}
        >
          {fileCount} changed
        </span>
      </div>

      {pathPending !== null && (
        <div className="rail-note">
          Recommended order: {pathPending.toLowerCase()}. Walking files in order, riskiest hunk
          of each first.
        </div>
      )}

      <ul className="rail-list">
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
            <li key={entry.id}>
              <button
                className={[
                  'rail-row',
                  current ? 'is-current' : '',
                  done ? 'is-done' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onEntry(entry)}
                title={tip}
              >
                {done ? (
                  <CheckIcon size={13} className="rail-check" />
                ) : (
                  <HeatDot level={entry.kind === 'file' ? entry.heat : 'low'} />
                )}
                <span className={entry.kind === 'file' ? 'rail-path' : 'rail-group'}>
                  {label}
                </span>
              </button>
            </li>
          );
        })}
        {entries.length === 0 && (
          <li>
            <div className="rail-note">
              {fileCount === 0 ? 'No files changed.' : 'Nothing to walk in this PR.'}
            </div>
          </li>
        )}
      </ul>

      {skippable.length > 0 && (
        <>
          <div className="rail-divider" />
          <div className="rail-head">
            <span className="rail-title">Skippable</span>
          </div>
          <ul className="rail-list">
            {skippable.map((group) => (
              <li key={group.id}>
                <button
                  className={`rail-row rail-skip${
                    group.id === currentGroupId ? ' is-current' : ''
                  }`}
                  onClick={() => onSkippable(group.id)}
                  title={`${group.title} · ${group.hunkCount} hunks · skim`}
                >
                  <ChevronRightIcon size={11} className="rail-caret" />
                  <span className="rail-group">{group.title}</span>
                  <span className="rail-count">
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
          <div className="rail-divider" />
          <div className="rail-head">
            <span className="rail-title">Outdated comments</span>
            <span className="rail-count">{outdated.length}</span>
          </div>
          <ul className="rail-outdated">
            {outdated.map((comment) => (
              <li key={comment.id}>
                <a href={comment.url} target="_blank" rel="noreferrer">
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
          <div className="rail-divider" />
          <div className="rail-head">
            <span className="rail-title">Drafts that did not re-attach</span>
            <span className="rail-count">{orphaned.length}</span>
          </div>
          <div className="rail-note">
            New commits moved or removed these lines. Copy what you still want to say onto a
            line the current diff has.
          </div>
          <ul className="rail-outdated">
            {orphaned.map((draft) => (
              <li key={draft.id}>
                <span className="rail-orphan-target">{draftTarget(draft)}</span>
                <span>{preview(draft.body, 72)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {conversation.length > 0 && (
        <>
          <div className="rail-divider" />
          <details className="rail-conversation">
            <summary>
              <span className="rail-title">Conversation</span>
              <span className="rail-count">{conversation.length}</span>
            </summary>
            <ul className="rail-outdated">
              {conversation.map((comment) => (
                <li key={comment.id}>
                  <a href={comment.url} target="_blank" rel="noreferrer">
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
