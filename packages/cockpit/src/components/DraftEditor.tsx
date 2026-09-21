import { useEffect, useRef, useState } from 'react';
import type { EditorTarget } from '../lib/interaction';
import { cn } from '../lib/utils';
import { inlineBlock } from './CommentPin';
import { Button } from './ui/button';

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
    <div className={cn(inlineBlock, 'rounded-md border border-border bg-card p-2 shadow-xs')}>
      <div className="mb-1.5 font-mono text-xs text-muted-foreground">
        {target.path}:{range} ({target.side})
      </div>
      <textarea
        ref={ref}
        className="min-h-[72px] w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-[13px] leading-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        value={body}
        placeholder="Leave a comment"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) onSave(body.trim());
        }}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="default"
          disabled={body.trim().length === 0}
          onClick={() => onSave(body.trim())}
        >
          Add comment
        </Button>
      </div>
    </div>
  );
}
