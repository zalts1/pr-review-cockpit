import type { Hunk } from '../types';
import { factorText } from '../lib/derive';

interface Props {
  hunk: Hunk;
}

export function HeatBar({ hunk }: Props) {
  const { level, adjustedBy } = hunk.risk;
  if (level === 'low') return null;

  const factors = factorText(hunk);
  const raised = adjustedBy ? ` · raised from ${adjustedBy.from} by analysis` : '';

  return (
    <div
      className="heatbar"
      title={`${level.toUpperCase()} risk${raised}${factors ? ` · ${factors}` : ''}`}
      aria-label={`${level} risk`}
    />
  );
}

export function ReasonBanner({ hunk }: Props) {
  const { level, reason, adjustedBy } = hunk.risk;
  if (level === 'low') return null;
  if (level === 'medium' && !reason) return null;

  return (
    <div className="reason">
      <span className="reason-level">
        {level === 'high' ? '▲ HIGH' : '▲ MEDIUM'}
      </span>
      <span>{reason ?? `${level} risk from code signals.`}</span>
      {adjustedBy && (
        <span className="reason-adjusted" title={adjustedBy.why}>
          raised from {adjustedBy.from} by analysis
        </span>
      )}
    </div>
  );
}
