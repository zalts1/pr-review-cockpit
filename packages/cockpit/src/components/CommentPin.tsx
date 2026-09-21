import type { Comment } from '@review-cockpit/schema';
import { Bot, ChevronDown, MessageSquare } from 'lucide-react';
import type { CommentThread } from '../lib/derive';
import { preview } from '../lib/drafts';
import { Markdown } from '../lib/markdown';
import { cn } from '../lib/utils';

interface Props {
  thread: CommentThread;
  expanded: boolean;
  onToggle(): void;
}

/** Indented under the code, past the gutter and the two number columns. */
export const inlineBlock = 'my-1 mr-3 ml-[100px] font-sans';

function SourceIcon({ kind }: { kind: Comment['source']['kind'] }) {
  const Icon = kind === 'bot' ? Bot : MessageSquare;
  return <Icon className="size-[13px] flex-none text-muted-foreground" />;
}

function Severity({ comment }: { comment: Comment }) {
  if (!comment.severity) return null;
  return (
    <span
      className={cn(
        'flex-none font-semibold text-muted-foreground',
        comment.severity === 'high' && 'text-high',
        comment.severity === 'medium' && 'text-medium',
      )}
    >
      {comment.severity}
    </span>
  );
}

function Body({ comment, first }: { comment: Comment; first: boolean }) {
  return (
    <div className={cn(!first && 'border-t border-border')}>
      {!first && (
        <div className="flex items-center gap-2 px-2.5 pt-1.5 text-xs text-muted-foreground">
          <SourceIcon kind={comment.source.kind} />
          <span className="font-semibold text-foreground">{comment.source.name}</span>
          <span>{new Date(comment.createdAt).toLocaleString()}</span>
        </div>
      )}
      <Markdown text={comment.body} className="px-2.5 py-2 text-[13px]" />
    </div>
  );
}

export function CommentPin({ thread, expanded, onToggle }: Props) {
  const { root, replies } = thread;
  const replyCount = replies.length > 0 && (
    <span className="flex-none rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
      {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
    </span>
  );
  const resolved = thread.resolved && (
    <span className="flex-none font-semibold text-muted-foreground">resolved</span>
  );

  if (!expanded) {
    return (
      <button
        type="button"
        className={cn(
          inlineBlock,
          'flex max-w-[calc(100%-112px)] w-fit cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-left text-xs text-muted-foreground shadow-xs hover:border-subtle',
          thread.resolved && 'opacity-60',
        )}
        onClick={onToggle}
        title={`${root.source.name} · ${root.path}:${root.line}`}
      >
        <SourceIcon kind={root.source.kind} />
        <span className="flex-none font-semibold text-foreground">{root.source.name}</span>
        <Severity comment={root} />
        {resolved}
        {replyCount}
        <span className="min-w-0 truncate">{preview(root.body)}</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        inlineBlock,
        'rounded-md border border-border bg-card text-[13px]',
        thread.resolved && 'opacity-60',
      )}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 rounded-t-md border-b border-border bg-muted px-2.5 py-1.5 text-left text-xs text-muted-foreground"
        onClick={onToggle}
      >
        <SourceIcon kind={root.source.kind} />
        <span className="font-semibold text-foreground">{root.source.name}</span>
        <span>{root.author}</span>
        <Severity comment={root} />
        {resolved}
        {replyCount}
        <ChevronDown className="ml-auto size-3" />
      </button>
      <Body comment={root} first />
      {replies.map((reply) => (
        <Body key={reply.id} comment={reply} first={false} />
      ))}
      <div className="flex items-center gap-2.5 px-2.5 pb-2 text-xs text-muted-foreground">
        <a href={root.url} target="_blank" rel="noreferrer">
          View on GitHub
        </a>
        <span>{new Date(root.createdAt).toLocaleString()}</span>
      </div>
    </div>
  );
}
