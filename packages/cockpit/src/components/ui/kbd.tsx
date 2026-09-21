import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'rounded border border-b-2 border-border bg-muted px-1.5 font-mono text-[11px] leading-[18px] text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
