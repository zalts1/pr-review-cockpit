import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

function svg(size: number, className: string | undefined, children: ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function CheckIcon({ size = 14, className }: IconProps) {
  return svg(size, className, <path d="M3 8.5l3 3 7-7" />);
}

export function CrossIcon({ size = 14, className }: IconProps) {
  return svg(size, className, <path d="M4 4l8 8M12 4l-8 8" />);
}

export function ClockIcon({ size = 14, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5l2.5 1.5" />
    </>,
  );
}

export function DashIcon({ size = 14, className }: IconProps) {
  return svg(size, className, <path d="M4 8h8" />);
}

export function PlusIcon({ size = 12, className }: IconProps) {
  return svg(size, className, <path d="M8 3.5v9M3.5 8h9" />);
}

export function ChevronRightIcon({ size = 12, className }: IconProps) {
  return svg(size, className, <path d="M6 3l5 5-5 5" />);
}

export function ChevronDownIcon({ size = 12, className }: IconProps) {
  return svg(size, className, <path d="M3 6l5 5 5-5" />);
}

export function ChevronLeftIcon({ size = 12, className }: IconProps) {
  return svg(size, className, <path d="M10 3L5 8l5 5" />);
}

export function ArrowRightIcon({ size = 12, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M2.5 8h11" />
      <path d="M9.5 4l4 4-4 4" />
    </>,
  );
}

export function AlertIcon({ size = 12, className }: IconProps) {
  return svg(size, className, <path d="M8 2l6 11H2z" />);
}

export function WarnIcon({ size = 14, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M8 1.8l6.2 11.4H1.8z" />
      <path d="M8 6v3.2M8 11.4v.2" />
    </>,
  );
}

export function BotIcon({ size = 14, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <rect x="2" y="3.5" width="12" height="8.5" rx="2" strokeWidth={1.5} />
      <path d="M6 12l-2 2v-2" strokeWidth={1.5} />
      <path d="M6 7.5v1M10 7.5v1" strokeWidth={1.5} />
    </>,
  );
}

export function CommentIcon({ size = 14, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M2 4a2 2 0 012-2h8a2 2 0 012 2v5a2 2 0 01-2 2H6l-3 3v-3H4a2 2 0 01-2-2z" strokeWidth={1.5} />
    </>,
  );
}

export function SparkIcon({ size = 14, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M6 2l1.1 2.9L10 6 7.1 7.1 6 10 4.9 7.1 2 6l2.9-1.1z" strokeWidth={1.4} />
      <path d="M11.5 9.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" strokeWidth={1.4} />
    </>,
  );
}

export function KeyboardIcon({ size = 14, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" strokeWidth={1.5} />
      <path d="M4.5 7h0M7 7h0M9.5 7h0M12 7h0M5 9.5h6" strokeWidth={1.5} />
    </>,
  );
}

export function MapIcon({ size = 14, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <rect x="1.5" y="5.5" width="5" height="5" rx="1" strokeWidth={1.5} />
      <rect x="9.5" y="2" width="5" height="5" rx="1" strokeWidth={1.5} />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" strokeWidth={1.5} />
      <path d="M6.5 8h3M6.5 8.5v3.5h3" strokeWidth={1.5} />
    </>,
  );
}

export function FilesIcon({ size = 14, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M3.5 2.5h5L11.5 5.5v8h-8z" strokeWidth={1.5} />
      <path d="M8 2.5v3.2h3.4" strokeWidth={1.5} />
    </>,
  );
}

export function SpinnerIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={`spinner${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path
        d="M8 1.5A6.5 6.5 0 0114.5 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
