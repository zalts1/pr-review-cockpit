import type { HTMLAttributes } from 'react';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const calloutVariants = cva(
  'flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-[13px] [&_svg]:relative [&_svg]:top-px [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:self-start',
  {
    variants: {
      tone: {
        warn: 'border-draft-border bg-draft',
        ok: 'border-ok bg-ok-wash',
        high: 'border-high bg-high-wash text-high',
      },
    },
    defaultVariants: { tone: 'warn' },
  },
);

export function Callout({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof calloutVariants>) {
  return <div className={cn(calloutVariants({ tone }), className)} {...props} />;
}
