import type { HTMLAttributes } from 'react';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-transparent px-2 text-[11px] font-medium [&_svg]:size-2.5',
  {
    variants: {
      variant: {
        outline: 'border-border text-muted-foreground',
        ok: 'bg-ok-wash text-ok',
        high: 'bg-high-wash text-high',
        medium: 'bg-medium-wash text-medium',
        muted: 'bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'outline' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** A badge that is a link: a check pill goes to its run on GitHub. */
export function BadgeLink({
  className,
  variant,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & VariantProps<typeof badgeVariants>) {
  return (
    <a
      className={cn(badgeVariants({ variant }), 'hover:brightness-95 hover:no-underline', className)}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  );
}
