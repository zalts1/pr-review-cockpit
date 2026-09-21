import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface Props {
  icon: ReactNode;
  title: string;
  warn?: boolean;
  children?: ReactNode;
}

export function CenteredCard({ icon, title, warn, children }: Props) {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-muted p-6">
      <div
        className={cn(
          'flex max-w-[560px] flex-col items-start gap-2 rounded-lg border border-border bg-card px-7 py-6 text-muted-foreground shadow-xs [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_p]:m-0 [&_p]:text-[13px] [&_p]:text-foreground',
          warn && 'text-high',
        )}
      >
        {icon}
        <h1 className="m-0 text-[17px] font-semibold text-foreground">{title}</h1>
        {children}
      </div>
    </div>
  );
}
