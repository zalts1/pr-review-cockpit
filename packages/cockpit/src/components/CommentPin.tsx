import type { Comment } from '@review-cockpit/schema';
import type { CommentThread } from '../lib/derive';
import { Markdown } from '../lib/markdown';
import { preview } from '../lib/drafts';
import { BotIcon, ChevronDownIcon, CommentIcon } from './Icons';

interface Props {
  thread: CommentThread;
  expanded: boolean;
  onToggle(): void;
}

function SourceIcon({ kind }: { kind: Comment['source']['kind'] }) {
  return kind === 'bot' ? <BotIcon size={13} /> : <CommentIcon size={13} />;
}

function Severity({ comment }: { comment: Comment }) {
  if (!comment.severity) return null;
  return <span className={`pin-severity pin-severity-${comment.severity}`}>{comment.severity}</span>;
}

function Body({ comment, first }: { comment: Comment; first: boolean }) {
  return (
    <div className={first ? 'pin-message' : 'pin-message pin-reply'}>
      {!first && (
        <div className="pin-message-head">
          <SourceIcon kind={comment.source.kind} />
          <span className="pin-author">{comment.source.name}</span>
          <span className="pin-by">{new Date(comment.createdAt).toLocaleString()}</span>
        </div>
      )}
      <Markdown text={comment.body} className="pin-body" />
    </div>
  );
}

export function CommentPin({ thread, expanded, onToggle }: Props) {
  const { root, replies } = thread;
  const replyCount = replies.length > 0 && (
    <span className="pin-replies">
      {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
    </span>
  );
  const resolved = thread.resolved && <span className="pin-severity">resolved</span>;

  if (!expanded) {
    return (
      <button
        className={`pin${thread.resolved ? ' pin-resolved' : ''}`}
        onClick={onToggle}
        title={`${root.source.name} · ${root.path}:${root.line}`}
      >
        <SourceIcon kind={root.source.kind} />
        <span className="pin-author">{root.source.name}</span>
        <Severity comment={root} />
        {resolved}
        {replyCount}
        <span className="pin-preview">{preview(root.body)}</span>
      </button>
    );
  }

  return (
    <div className={`pin-open${thread.resolved ? ' pin-resolved' : ''}`}>
      <button className="pin-open-head" onClick={onToggle}>
        <SourceIcon kind={root.source.kind} />
        <span className="pin-author">{root.source.name}</span>
        <span className="pin-by">{root.author}</span>
        <Severity comment={root} />
        {resolved}
        {replyCount}
        <div className="header-spacer" />
        <ChevronDownIcon size={11} />
      </button>
      <Body comment={root} first />
      {replies.map((reply) => (
        <Body key={reply.id} comment={reply} first={false} />
      ))}
      <div className="pin-foot">
        <a href={root.url} target="_blank" rel="noreferrer">
          View on GitHub
        </a>
        <span>{new Date(root.createdAt).toLocaleString()}</span>
      </div>
    </div>
  );
}
