import type { HTMLAttributes, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface DialogProps {
  label: string;
  className?: string;
  /** A click on the scrim, when the dialog lets one close it. */
  onDismiss?: () => void;
  children: ReactNode;
}

/**
 * Rendered in place rather than through a portal, so the page's own Escape
 * handling and the static render in tests see it. Sits above the brief's
 * backdrop and the header, which stop at z-40.
 */
export function Dialog({ label, className, onDismiss, children }: DialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim pt-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onDismiss}
    >
      <div
        className={cn(
          'flex max-h-[84vh] w-[640px] max-w-[calc(100vw-32px)] flex-col overflow-auto rounded-lg border border-border bg-card shadow-modal',
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose(): void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-sm font-semibold">
      <span>{children}</span>
      <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-3 px-4 py-3', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex justify-end gap-2 border-t border-border px-4 py-3', className)}
      {...props}
    />
  );
}
