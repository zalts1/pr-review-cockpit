import { Fragment } from 'react';
import type { Comment, DiffLine, Hunk as HunkModel, ReviewFile } from '@review-cockpit/schema';
import type { CockpitDraft } from '../lib/drafts';
import { Markdown } from '../lib/markdown';
import type { DragRange, EditorTarget, LineTarget } from '../lib/interaction';
import { rangeOf } from '../lib/interaction';
import { CommentPin } from './CommentPin';
import { DraftEditor } from './DraftEditor';
import { HeatBar, ReasonBanner } from './HeatBar';

export interface DiffHandlers {
  commentsByHunk: Map<string, Comment[]>;
  drafts: CockpitDraft[];
  expandedComments: Set<string>;
  toggleComment(id: string): void;
  editor: EditorTarget | null;
  openEditor(target: EditorTarget): void;
  closeEditor(): void;
  addDraft(target: EditorTarget, body: string): void;
  removeDraft(id: string): void;
  drag: DragRange | null;
  startDrag(target: LineTarget): void;
  extendDrag(target: LineTarget): void;
  hoverLine(target: LineTarget | null): void;
  registerHunk(id: string, el: HTMLElement | null): void;
  flashedHunkId: string | null;
}

function lineTarget(file: ReviewFile, hunk: HunkModel, line: DiffLine): LineTarget | null {
  if (line.newNo !== null) {
    return {
      fileId: file.id,
      hunkId: hunk.id,
      path: file.path,
      side: 'RIGHT',
      line: line.newNo,
    };
  }
  if (line.oldNo !== null) {
    return { fileId: file.id, hunkId: hunk.id, path: file.path, side: 'LEFT', line: line.oldNo };
  }
  return null;
}

interface Props {
  hunk: HunkModel;
  file: ReviewFile;
  handlers: DiffHandlers;
}

export function Hunk({ hunk, file, handlers }: Props) {
  const comments = handlers.commentsByHunk.get(hunk.id) ?? [];
  const drafts = handlers.drafts.filter((d) => d.hunkId === hunk.id);
  const selection = handlers.drag && handlers.drag.start.hunkId === hunk.id
    ? { side: handlers.drag.start.side, ...rangeOf(handlers.drag) }
    : null;

  return (
    <div
      className={[
        'hunk',
        `heat-${hunk.risk.level}`,
        handlers.flashedHunkId === hunk.id ? 'hunk-target' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      ref={(el) => handlers.registerHunk(hunk.id, el)}
      data-hunk-id={hunk.id}
    >
      <HeatBar hunk={hunk} />
      <ReasonBanner hunk={hunk} />
      <table className="diff">
        <colgroup>
          <col className="col-plus" />
          <col className="col-num" />
          <col className="col-num" />
          <col />
        </colgroup>
        <tbody>
          <tr className="diff-hunk-header">
            <td colSpan={4}>
              @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@{' '}
              <span className="diff-hunk-context">{hunk.header}</span>
            </td>
          </tr>

          {hunk.lines.map((line, i) => {
            const target = lineTarget(file, hunk, line);
            const selected =
              selection !== null &&
              target !== null &&
              target.side === selection.side &&
              target.line >= selection.from &&
              target.line <= selection.to;

            const rowComments = comments.filter(
              (c) => target !== null && c.side === target.side && c.line === target.line,
            );
            const rowDrafts = drafts.filter(
              (d) => target !== null && d.side === target.side && d.line === target.line,
            );
            const editor =
              handlers.editor &&
              target &&
              handlers.editor.hunkId === hunk.id &&
              handlers.editor.side === target.side &&
              handlers.editor.line === target.line
                ? handlers.editor
                : null;

            return (
              <Fragment key={`${hunk.id}-${i}`}>
                <tr
                  className={[
                    `row-${line.type}`,
                    selected ? 'row-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() => {
                    if (!target) return;
                    handlers.hoverLine(target);
                    if (handlers.drag) handlers.extendDrag(target);
                  }}
                  onMouseLeave={() => handlers.hoverLine(null)}
                >
                  <td className="plus-cell">
                    {target && (
                      <button
                        className="plus"
                        title="Add a comment on this line. Drag to another line for a range."
                        aria-label={`Comment on ${file.path} line ${target.line}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handlers.startDrag(target);
                        }}
                      >
                        +
                      </button>
                    )}
                  </td>
                  <td className="num">{line.oldNo ?? ''}</td>
                  <td className="num">{line.newNo ?? ''}</td>
                  <td className="code">
                    {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                    {line.text}
                  </td>
                </tr>

                {(rowComments.length > 0 || rowDrafts.length > 0 || editor) && (
                  <tr>
                    <td />
                    <td className="thread-cell" colSpan={3}>
                      {rowComments.map((comment) => (
                        <CommentPin
                          key={comment.id}
                          comment={comment}
                          expanded={handlers.expandedComments.has(comment.id)}
                          onToggle={() => handlers.toggleComment(comment.id)}
                        />
                      ))}
                      {rowDrafts.map((draft) => (
                        <div className="draft" key={draft.id}>
                          <div className="draft-head">
                            <strong>Draft</strong>
                            <span>
                              {draft.startLine !== null && draft.startLine !== draft.line
                                ? `lines ${draft.startLine}–${draft.line}`
                                : `line ${draft.line}`}{' '}
                              ({draft.side})
                            </span>
                            <div className="header-spacer" />
                            <button
                              className="btn-link"
                              onClick={() => handlers.removeDraft(draft.id)}
                            >
                              delete
                            </button>
                          </div>
                          <Markdown text={draft.body} className="draft-body" />
                        </div>
                      ))}
                      {editor && (
                        <DraftEditor
                          target={editor}
                          onSave={(body) => handlers.addDraft(editor, body)}
                          onCancel={handlers.closeEditor}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
