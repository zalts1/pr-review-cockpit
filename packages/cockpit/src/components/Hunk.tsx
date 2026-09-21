import { Fragment, useMemo } from 'react';
import type { Hunk as HunkModel, ReviewFile } from '@review-cockpit/schema';
import { Plus } from 'lucide-react';
import type { CommentThread } from '../lib/derive';
import type { CockpitDraft } from '../lib/drafts';
import { grammarFor, highlightHunkCached } from '../lib/highlight';
import { Markdown } from '../lib/markdown';
import type { DragRange, EditorTarget, LineTarget } from '../lib/interaction';
import { lineTarget, rangeOf } from '../lib/interaction';
import { cn } from '../lib/utils';
import { CommentPin, inlineBlock } from './CommentPin';
import { DraftEditor } from './DraftEditor';
import { HeatBar, ReasonBanner } from './HeatBar';
import { Button } from './ui/button';

export interface DiffHandlers {
  threadsByHunk: Map<string, CommentThread[]>;
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

interface Props {
  hunk: HunkModel;
  file: ReviewFile;
  handlers: DiffHandlers;
}

export function Hunk({ hunk, file, handlers }: Props) {
  const grammar = grammarFor(file);
  const code = useMemo(() => highlightHunkCached(hunk, grammar), [hunk, grammar]);
  const threads = handlers.threadsByHunk.get(hunk.id) ?? [];
  const drafts = handlers.drafts.filter((d) => d.hunkId === hunk.id);
  const selection =
    handlers.drag && handlers.drag.start.hunkId === hunk.id
      ? { side: handlers.drag.start.side, ...rangeOf(handlers.drag) }
      : null;

  return (
    <div
      className={cn(
        'relative pl-1 [&+&]:mt-2 [&+&]:border-t [&+&]:border-border',
        `heat-${hunk.risk.level}`,
        handlers.flashedHunkId === hunk.id && 'hunk-target',
      )}
      ref={(el) => handlers.registerHunk(hunk.id, el)}
      data-hunk-id={hunk.id}
    >
      <HeatBar hunk={hunk} />
      <ReasonBanner hunk={hunk} />
      <table className="diff">
        <colgroup>
          <col className="w-[22px]" />
          <col className="w-11" />
          <col className="w-11" />
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
            const html = code[i] ?? null;
            const selected =
              selection !== null &&
              target !== null &&
              target.side === selection.side &&
              target.line >= selection.from &&
              target.line <= selection.to;

            const rowThreads = threads.filter(
              (thread) =>
                target !== null &&
                thread.root.side === target.side &&
                thread.root.line === target.line,
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
                  className={cn(`row-${line.type}`, selected && 'row-selected')}
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
                        type="button"
                        className="plus"
                        title="Add a comment on this line. Drag to another line for a range."
                        aria-label={`Comment on ${file.path} line ${target.line}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handlers.startDrag(target);
                        }}
                      >
                        <Plus className="size-[11px]" strokeWidth={2.5} />
                      </button>
                    )}
                  </td>
                  <td className="num">{line.oldNo ?? ''}</td>
                  <td className="num">{line.newNo ?? ''}</td>
                  <td className="code">
                    {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                    {html === null ? (
                      line.text
                    ) : (
                      <span dangerouslySetInnerHTML={{ __html: html }} />
                    )}
                  </td>
                </tr>

                {(rowThreads.length > 0 || rowDrafts.length > 0 || editor) && (
                  <tr>
                    <td />
                    <td className="pr-3" colSpan={3}>
                      {rowThreads.map((thread) => (
                        <CommentPin
                          key={thread.id}
                          thread={thread}
                          expanded={handlers.expandedComments.has(thread.id)}
                          onToggle={() => handlers.toggleComment(thread.id)}
                        />
                      ))}
                      {rowDrafts.map((draft) => (
                        <div
                          className={cn(
                            inlineBlock,
                            'rounded-md border border-l-4 border-draft-border bg-draft px-2.5 py-1.5 text-[13px]',
                          )}
                          key={draft.id}
                        >
                          <div className="mb-1 flex items-baseline gap-2 text-xs text-muted-foreground">
                            <strong className="text-foreground">Draft</strong>
                            <span>
                              {draft.startLine !== null && draft.startLine !== draft.line
                                ? `lines ${draft.startLine}–${draft.line}`
                                : `line ${draft.line}`}{' '}
                              ({draft.side})
                            </span>
                            <Button
                              variant="link"
                              className="ml-auto text-xs"
                              onClick={() => handlers.removeDraft(draft.id)}
                            >
                              delete
                            </Button>
                          </div>
                          <Markdown text={draft.body} />
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
