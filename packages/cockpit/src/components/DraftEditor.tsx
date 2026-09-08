import { useEffect, useRef, useState } from 'react';
import type { EditorTarget } from '../lib/interaction';

interface Props {
  target: EditorTarget;
  onSave(body: string): void;
  onCancel(): void;
}

export function DraftEditor({ target, onSave, onCancel }: Props) {
  const [body, setBody] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const range =
    target.startLine !== null && target.startLine !== target.line
      ? `${target.startLine}–${target.line}`
      : `${target.line}`;

  return (
    <div className="editor">
      <div className="editor-target">
        {target.path}:{range} ({target.side})
      </div>
      <textarea
        ref={ref}
        value={body}
        placeholder="Leave a comment"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) onSave(body.trim());
        }}
      />
      <div className="editor-actions">
        <button className="btn btn-small" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-small btn-primary"
          disabled={body.trim().length === 0}
          onClick={() => onSave(body.trim())}
        >
          Add comment
        </button>
      </div>
    </div>
  );
}
