import type { Comment } from '@review-cockpit/schema';
import { Markdown } from '../lib/markdown';
import { preview } from '../lib/drafts';
import { BotIcon, ChevronDownIcon, CommentIcon } from './Icons';

interface Props {
  comment: Comment;
  expanded: boolean;
  onToggle(): void;
}

function SourceIcon({ kind }: { kind: Comment['source']['kind'] }) {
  return kind === 'bot' ? <BotIcon size={13} /> : <CommentIcon size={13} />;
}

export function CommentPin({ comment, expanded, onToggle }: Props) {
  const severity = comment.severity && (
    <span className={`pin-severity pin-severity-${comment.severity}`}>{comment.severity}</span>
  );

  if (!expanded) {
    return (
      <button
        className={`pin${comment.resolved ? ' pin-resolved' : ''}`}
        onClick={onToggle}
        title={`${comment.source.name} · ${comment.path}:${comment.line}`}
      >
        <SourceIcon kind={comment.source.kind} />
        <span className="pin-author">{comment.source.name}</span>
        {severity}
        {comment.resolved && <span className="pin-severity">resolved</span>}
        <span className="pin-preview">{preview(comment.body)}</span>
      </button>
    );
  }

  return (
    <div className={`pin-open${comment.resolved ? ' pin-resolved' : ''}`}>
      <button className="pin-open-head" onClick={onToggle}>
        <SourceIcon kind={comment.source.kind} />
        <span className="pin-author">{comment.source.name}</span>
        <span className="pin-by">{comment.author}</span>
        {severity}
        {comment.resolved && <span className="pin-severity">resolved</span>}
        <div className="header-spacer" />
        <ChevronDownIcon size={11} />
      </button>
      <Markdown text={comment.body} className="pin-body" />
      <div className="pin-foot">
        <a href={comment.url} target="_blank" rel="noreferrer">
          View on GitHub
        </a>
        <span>{new Date(comment.createdAt).toLocaleString()}</span>
      </div>
    </div>
  );
}
