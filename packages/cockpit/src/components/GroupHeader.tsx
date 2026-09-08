import type { Group, Hunk as HunkModel, ReviewFile } from '../types';
import type { DiffHandlers } from './Hunk';
import { Hunk } from './Hunk';

interface Props {
  group: Group;
  entries: Array<{ file: ReviewFile; hunks: HunkModel[] }>;
  expanded: boolean;
  isTarget: boolean;
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
  handlers,
  registerGroup,
  onToggle,
  onHover,
}: Props) {
  const fileCount = entries.length;
  const lineCount = entries.reduce(
    (n, entry) => n + entry.hunks.reduce((m, h) => m + h.lines.length, 0),
    0,
  );

  return (
    <section
      className="group"
      ref={(el) => registerGroup(group.id, el)}
      data-group-id={group.id}
      onMouseEnter={() => onHover(group.id)}
      onMouseLeave={() => onHover(null)}
      style={isTarget ? { boxShadow: 'inset 3px 0 0 var(--link)' } : undefined}
    >
      <div className="group-head">
        <button
          className="group-caret"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${group.title}` : `Expand ${group.title}`}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <span className="group-kind">{group.kind}</span>
        <span className="group-title">{group.title}</span>
        <span className="group-meta">
          {fileCount} {fileCount === 1 ? 'file' : 'files'} · {lineCount} lines · {group.mode}
        </span>
        <div className="header-spacer" />
        <button className="btn btn-small" onClick={onToggle}>
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {group.description && <p className="group-desc">{group.description}</p>}

      {expanded && (
        <div className="group-body">
          {entries.map(({ file, hunks }) => (
            <div key={file.id}>
              <div className="group-file">
                {file.path} <span className="tree-count">+{file.additions}/−{file.deletions}</span>
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
