import type { Comment } from '@review-cockpit/schema';
import { Markdown } from '../lib/markdown';
import { preview } from '../lib/drafts';

interface Props {
  comment: Comment;
  expanded: boolean;
  onToggle(): void;
}

export function CommentPin({ comment, expanded, onToggle }: Props) {
  const icon = comment.source.kind === 'bot' ? '🤖' : '💬';

  if (!expanded) {
    return (
      <button
        className={`pin${comment.resolved ? ' pin-resolved' : ''}`}
        onClick={onToggle}
        title={`${comment.source.name} · ${comment.path}:${comment.line}`}
      >
        <span aria-hidden="true">{icon}</span>
        <span className="pin-author">{comment.author}</span>
        {comment.severity && (
          <span className={`pin-severity pin-severity-${comment.severity}`}>
            {comment.severity}
          </span>
        )}
        {comment.resolved && <span className="pin-severity">resolved</span>}
        <span className="pin-preview">{preview(comment.body)}</span>
        <span aria-hidden="true">▸</span>
      </button>
    );
  }

  return (
    <div className={`pin-open${comment.resolved ? ' pin-resolved' : ''}`}>
      <div className="pin-open-head">
        <span aria-hidden="true">{icon}</span>
        <span className="pin-author">{comment.author}</span>
        <span className="tree-count">{comment.source.name}</span>
        {comment.severity && (
          <span className={`pin-severity pin-severity-${comment.severity}`}>
            {comment.severity}
          </span>
        )}
        {comment.resolved && <span className="pin-severity">resolved</span>}
        <div className="header-spacer" />
        <button className="btn-link" onClick={onToggle}>
          collapse
        </button>
      </div>
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
