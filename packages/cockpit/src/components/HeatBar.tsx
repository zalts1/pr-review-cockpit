import type { Hunk } from '@review-cockpit/schema';
import { factorText } from '../lib/derive';
import { AlertIcon } from './Icons';

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
      className="heatbar"
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

  return (
    <div className={`reason reason-${level}`}>
      <span className="reason-level">
        <AlertIcon size={11} />
        {level.toUpperCase()}
      </span>
      <span className="reason-text">{reason ?? `${factors.length} code signals raised this.`}</span>
      <span className="reason-factors" title={detail}>
        {adjustedBy !== null && (
          <span className="reason-adjusted" title={adjustedBy.why}>
            raised from {adjustedBy.from} ·{' '}
          </span>
        )}
        {detail}
      </span>
    </div>
  );
}
