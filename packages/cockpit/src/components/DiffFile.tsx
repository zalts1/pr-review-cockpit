import type { Hunk as HunkModel, ReviewFile } from '../types';
import type { DiffHandlers } from './Hunk';
import { Hunk } from './Hunk';

interface Props {
  file: ReviewFile;
  hunks: HunkModel[];
  collapsed: boolean;
  viewed: boolean;
  handlers: DiffHandlers;
  registerFile(id: string, el: HTMLElement | null): void;
  onToggleCollapsed(): void;
  onToggleViewed(): void;
  onOverflow(): void;
}

export function DiffFile({
  file,
  hunks,
  collapsed,
  viewed,
  handlers,
  registerFile,
  onToggleCollapsed,
  onToggleViewed,
  onOverflow,
}: Props) {
  const lines = hunks.reduce((n, h) => n + h.lines.length, 0);

  return (
    <section
      className={`file${collapsed ? ' file-collapsed' : ''}`}
      ref={(el) => registerFile(file.id, el)}
      data-file-id={file.id}
    >
      <div className="file-head">
        <button
          className="file-caret"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? `Expand ${file.path}` : `Collapse ${file.path}`}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="file-path">
          {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
        </span>
        <span className="file-stats">
          <span className="file-adds">+{file.additions}</span>{' '}
          <span className="file-dels">−{file.deletions}</span>
        </span>
        {file.generated.is && (
          <span className="file-tag" title={`matched ${file.generated.rule}`}>
            generated
          </span>
        )}
        {file.status !== 'modified' && <span className="file-tag">{file.status}</span>}
        {file.signals.testFile && <span className="file-tag">test</span>}
        <div className="header-spacer" />
        <label className="file-viewed">
          <input type="checkbox" checked={viewed} onChange={onToggleViewed} />
          Viewed
        </label>
        <button className="file-overflow" onClick={onOverflow} aria-label="File actions">
          ⋯
        </button>
      </div>

      {collapsed ? (
        <div className="file-note">
          {viewed ? 'Marked viewed. ' : ''}
          {hunks.length} {hunks.length === 1 ? 'hunk' : 'hunks'}, {lines} diff lines. Expand to
          read.
        </div>
      ) : (
        hunks.map((hunk) => (
          <Hunk key={hunk.id} hunk={hunk} file={file} handlers={handlers} />
        ))
      )}
    </section>
  );
}
