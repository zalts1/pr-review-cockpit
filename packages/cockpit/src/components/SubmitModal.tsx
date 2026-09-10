import type { Draft, PrInfo } from '@review-cockpit/schema';
import { draftTarget } from '../lib/drafts';
import { Markdown } from '../lib/markdown';
import { shortSha } from '../lib/derive';
import type { SubmitResult, Verdict } from '../lib/submit';
import { CheckIcon, CrossIcon, SpinnerIcon, WarnIcon } from './Icons';

export type { Verdict } from '../lib/submit';

const verdicts: Array<{ value: Verdict; label: string }> = [
  { value: 'COMMENT', label: 'Comment' },
  { value: 'REQUEST_CHANGES', label: 'Request changes' },
  { value: 'APPROVE', label: 'Approve' },
];

interface Props {
  pr: PrInfo;
  drafts: Draft[];
  unseenHigh: number;
  verdict: Verdict;
  body: string;
  posting: boolean;
  result: SubmitResult | null;
  onVerdict(verdict: Verdict): void;
  onBody(body: string): void;
  onCancel(): void;
  onPost(): void;
}

export function SubmitModal({
  pr,
  drafts,
  unseenHigh,
  verdict,
  body,
  posting,
  result,
  onVerdict,
  onBody,
  onCancel,
  onPost,
}: Props) {
  // GitHub takes a comment review with neither a body nor a comment as nothing
  // at all, so the button says so rather than posting an empty review.
  const empty = drafts.length === 0 && verdict === 'COMMENT' && body.trim().length === 0;
  const posted = result?.kind === 'posted';

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Submit review">
      <div className="modal">
        <div className="modal-head">
          <span>Submit review</span>
          <button className="btn btn-icon" onClick={onCancel} aria-label="Close">
            <CrossIcon size={12} />
          </button>
        </div>

        <div className="modal-body">
          <div className="verdicts">
            {verdicts.map((option) => (
              <label className="verdict" key={option.value}>
                <input
                  type="radio"
                  name="verdict"
                  checked={verdict === option.value}
                  disabled={posting || posted}
                  onChange={() => onVerdict(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>

          <label className="field">
            Review summary (optional)
            <textarea
              value={body}
              disabled={posting || posted}
              onChange={(e) => onBody(e.target.value)}
            />
          </label>

          <div className="dry-run">
            <div className="dry-run-head">
              {drafts.length} {drafts.length === 1 ? 'comment' : 'comments'} will be posted on
              commit <code>{shortSha(pr.head.sha)}</code>
            </div>
            {drafts.length === 0 ? (
              <div className="dry-run-note">
                No draft comments. Only the verdict will be posted.
              </div>
            ) : (
              <ul>
                {drafts.map((draft) => (
                  <li key={draft.id}>
                    <span className="dry-run-target">{draftTarget(draft)}</span>
                    <Markdown text={draft.body} className="dry-run-preview" />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {verdict === 'APPROVE' && unseenHigh > 0 && !posted && (
            <div className="warn">
              <WarnIcon size={13} />
              <span>
                Approve with unseen high-risk hunks: {unseenHigh} remaining. This does not block
                you.
              </span>
            </div>
          )}

          {result?.kind === 'posted' && (
            <div className="submit-result" role="status">
              <CheckIcon size={13} />
              <span>
                Posted {result.comments} {result.comments === 1 ? 'comment' : 'comments'}.{' '}
                <a href={result.url} target="_blank" rel="noreferrer">
                  Open the review on GitHub
                </a>
              </span>
            </div>
          )}

          {result?.kind === 'head_moved' && (
            <div className="warn" role="alert">
              <WarnIcon size={13} />
              <span>
                The PR has new commits since this review started ({shortSha(result.expected)} →{' '}
                {shortSha(result.actual)}). Your drafts are saved. Run{' '}
                <code>review {pr.number}</code> again to re-attach them.
              </span>
            </div>
          )}

          {result?.kind === 'refused' && (
            <div className="warn" role="alert">
              <WarnIcon size={13} />
              <span className="submit-error">{result.message}</span>
            </div>
          )}

          {empty && !posted && (
            <div className="dry-run-note">
              Nothing to post: a comment review needs a summary or at least one comment.
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onCancel}>
            {posted ? 'Close' : 'Cancel'}
          </button>
          <button
            className="btn btn-primary"
            disabled={posting || posted || empty}
            onClick={onPost}
          >
            {posting && <SpinnerIcon size={12} />}
            {posting ? 'Posting…' : 'Post to GitHub'}
          </button>
        </div>
      </div>
    </div>
  );
}
