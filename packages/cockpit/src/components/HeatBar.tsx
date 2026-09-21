import type { Hunk } from '@review-cockpit/schema';
import { TriangleAlert } from 'lucide-react';
import { factorText } from '../lib/derive';
import { cn } from '../lib/utils';

interface Props {
  hunk: Hunk;
}

/**
 * The 4 px gutter bar. It is an element rather than a border on the hunk so
 * that the level and its factors are reachable as a tooltip, and colour is
 * never the only thing carrying the risk.
 */
export function HeatBar({ hunk }: Props) {
  const { level, adjustedBy } = hunk.risk;
  if (level === 'low') return null;

  const factors = factorText(hunk);
  const raised = adjustedBy === null ? '' : ` · raised from ${adjustedBy.from} by analysis`;

  return (
    <div
      className={cn(
        'absolute top-0 bottom-0 left-0 z-[2] w-1 cursor-help',
        level === 'high' ? 'bg-high' : 'bg-medium',
      )}
      title={`${level.toUpperCase()} risk${raised}${factors ? ` · ${factors}` : ''}`}
      aria-label={`${level} risk`}
    />
  );
}

/**
 * The one loud element on the screen, and only for high: the level, the reason
 * in words, and the deterministic factors it was scored on. Medium keeps its
 * 4 px bar and says nothing unless the judgment pass wrote a reason.
 */
export function ReasonBanner({ hunk }: Props) {
  const { level, reason, factors, adjustedBy } = hunk.risk;
  if (level === 'low') return null;
  if (level === 'medium' && reason === null) return null;

  const detail = factorText(hunk);
  const high = level === 'high';

  return (
    <div
      className={cn(
        'flex items-baseline gap-2.5 border-b px-3 py-1.5 text-xs',
        high ? 'border-high-num bg-high-wash' : 'border-medium/30 bg-medium-wash',
      )}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1 font-semibold whitespace-nowrap',
          high ? 'text-high' : 'text-medium',
        )}
      >
        <TriangleAlert className="size-[11px]" />
        {level.toUpperCase()}
      </span>
      <span className="min-w-0">{reason ?? `${factors.length} code signals raised this.`}</span>
      <span
        className="ml-auto max-w-[46%] cursor-help truncate whitespace-nowrap text-muted-foreground"
        title={detail}
      >
        {adjustedBy !== null && (
          <span className="text-medium" title={adjustedBy.why}>
            raised from {adjustedBy.from} ·{' '}
          </span>
        )}
        {detail}
      </span>
    </div>
  );
}
