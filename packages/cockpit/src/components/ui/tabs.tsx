import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * A segmented control with the tab roles, without a tab panel: the panel is
 * whatever the page renders for the selected value, so the state stays with
 * the caller.
 */
export function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn('inline-flex gap-0.5 rounded-md bg-muted p-[3px]', className)}
      {...props}
    />
  );
}

interface TriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected: boolean;
}

export function TabsTrigger({ className, selected, ...props }: TriggerProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cn(
        'inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-3',
        selected && 'bg-card text-foreground shadow-xs',
        className,
      )}
      {...props}
    />
  );
}
