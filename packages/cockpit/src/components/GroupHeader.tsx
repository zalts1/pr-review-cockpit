import type { Group, Hunk as HunkModel, ReviewFile } from '@review-cockpit/schema';
import { groupLineCount } from '../lib/derive';
import type { DiffHandlers } from './Hunk';
import { Hunk } from './Hunk';
import { ChevronDownIcon, ChevronRightIcon } from './Icons';

interface Props {
  group: Group;
  entries: Array<{ file: ReviewFile; hunks: HunkModel[] }>;
  expanded: boolean;
  isTarget: boolean;
  flashed: boolean;
  /** The step this group is reached at, or null when the walk never reaches it. */
  step: number | null;
  handlers: DiffHandlers;
  registerGroup(id: string, el: HTMLElement | null): void;
  onToggle(): void;
  onHover(id: string | null): void;
}

export function GroupHeader({
  group,
  entries,
  expanded,
  isTarget,
  flashed,
  step,
  handlers,
  registerGroup,
  onToggle,
  onHover,
}: Props) {
  const fileCount = entries.length;
  const lines = groupLineCount(entries);
  const where = step === null ? group.mode : `step ${step} · ${group.mode}`;

  return (
    <section
      className={[
        'group',
        expanded ? 'is-open' : '',
        isTarget ? 'is-current' : '',
        flashed ? 'hunk-target' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      ref={(el) => registerGroup(group.id, el)}
      data-group-id={group.id}
      onMouseEnter={() => onHover(group.id)}
      onMouseLeave={() => onHover(null)}
    >
      <button
        className="group-row"
        onClick={onToggle}
        aria-expanded={expanded}
        title={group.description || group.title}
      >
        {expanded ? (
          <ChevronDownIcon size={11} className="file-caret" />
        ) : (
          <ChevronRightIcon size={11} className="file-caret" />
        )}
        <span className="group-title">{group.title}</span>
        <span className="group-meta">
          {group.kind} · {fileCount} {fileCount === 1 ? 'file' : 'files'} · {lines} lines
        </span>
        <span className="file-where">{where}</span>
      </button>

      {expanded && (
        <div className="group-body">
          {group.description && <p className="group-desc">{group.description}</p>}
          {entries.map(({ file, hunks }) => (
            <div key={file.id}>
              <div className="group-file">
                <span className="file-path">{file.path}</span>
                <span className="file-adds">+{file.additions}</span>
                <span className="file-dels">−{file.deletions}</span>
              </div>
              {hunks.map((hunk) => (
                <Hunk key={hunk.id} hunk={hunk} file={file} handlers={handlers} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
