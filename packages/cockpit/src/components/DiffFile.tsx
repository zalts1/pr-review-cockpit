import type { Hunk as HunkModel, ReviewFile, RiskLevel } from '@review-cockpit/schema';
import type { DiffHandlers } from './Hunk';
import { Hunk } from './Hunk';
import { ChevronDownIcon, ChevronRightIcon } from './Icons';

interface Props {
  file: ReviewFile;
  hunks: HunkModel[];
  open: boolean;
  viewed: boolean;
  current: boolean;
  heat: RiskLevel;
  /** The step this file is reached at, or null when the walk never reaches it. */
  step: number | null;
  handlers: DiffHandlers;
  registerFile(id: string, el: HTMLElement | null): void;
  onToggleOpen(): void;
  onToggleViewed(): void;
}

function Stats({ file }: { file: ReviewFile }) {
  return (
    <>
      <span className="file-adds">+{file.additions}</span>
      <span className="file-dels">−{file.deletions}</span>
    </>
  );
}

export function DiffFile({
  file,
  hunks,
  open,
  viewed,
  current,
  heat,
  step,
  handlers,
  registerFile,
  onToggleOpen,
  onToggleViewed,
}: Props) {
  const path = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;

  if (!open) {
    return (
      <button
        className={`file-row${viewed ? ' is-viewed' : ''}`}
        ref={(el) => registerFile(file.id, el)}
        data-file-id={file.id}
        onClick={onToggleOpen}
        title={`${path} · ${hunks.length} ${hunks.length === 1 ? 'hunk' : 'hunks'}`}
      >
        <ChevronRightIcon size={11} className="file-caret" />
        <span className="file-path">{path}</span>
        <Stats file={file} />
        <span className={`file-where heat-word-${heat}`}>
          {step === null ? heat : `step ${step} · ${heat}`}
        </span>
      </button>
    );
  }

  return (
    <section
      className={`file${current ? ' is-current' : ''}`}
      ref={(el) => registerFile(file.id, el)}
      data-file-id={file.id}
    >
      <div className="file-head">
        <button
          className="file-caret-button"
          onClick={onToggleOpen}
          aria-label={`Collapse ${file.path}`}
        >
          <ChevronDownIcon size={11} />
        </button>
        <span className="file-path">{path}</span>
        <Stats file={file} />
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
      </div>

      {hunks.map((hunk) => (
        <Hunk key={hunk.id} hunk={hunk} file={file} handlers={handlers} />
      ))}
    </section>
  );
}
