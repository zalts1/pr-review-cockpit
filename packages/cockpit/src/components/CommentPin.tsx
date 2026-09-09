import type { ReactNode } from 'react';
import type { Comment } from '@review-cockpit/schema';
import { preview } from '../lib/drafts';

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      nodes.push(<code key={`${keyPrefix}-c${i}`}>{match[2]}</code>);
    }
    last = match.index + match[0].length;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Markdown({ body }: { body: string }) {
  return (
    <p className="pin-body">
      {body.split('\n').map((line, i) => (
        <span key={i}>
          {inline(line, `l${i}`)}
          {'\n'}
        </span>
      ))}
    </p>
  );
}

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
      <Markdown body={comment.body} />
      <div className="pin-foot">
        <a href={comment.url} target="_blank" rel="noreferrer">
          View on GitHub
        </a>
        <span>{new Date(comment.createdAt).toLocaleString()}</span>
      </div>
    </div>
  );
}
