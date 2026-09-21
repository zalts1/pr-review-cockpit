import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface Props {
  label: string;
  open: boolean;
  onClose(): void;
  className?: string;
  children: ReactNode;
}

/**
 * A panel that slides in from the left over a scrim. Rendered in place, like
 * the dialog, so the page's key handling and the static render in tests see
 * it; below the dialogs at z-50, above the header at z-40.
 */
export function Sheet({ label, open, onClose, className, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[45] flex" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-scrim" onClick={onClose} />
      <div
        className={cn(
          'relative flex h-full w-[320px] max-w-[calc(100vw-48px)] flex-col overflow-auto border-r border-border bg-background shadow-panel',
          className,
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-2.5 right-2.5 z-[1]"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-3.5" />
        </Button>
        {children}
      </div>
    </div>
  );
}
