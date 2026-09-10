import { useState } from 'react';
import type { Draft, PrInfo } from '@review-cockpit/schema';
import { draftTarget } from '../lib/drafts';
import { Markdown } from '../lib/markdown';
import { shortSha } from '../lib/derive';
import { CrossIcon, WarnIcon } from './Icons';

export type Verdict = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';

const verdicts: Array<{ value: Verdict; label: string }> = [
  { value: 'COMMENT', label: 'Comment' },
  { value: 'REQUEST_CHANGES', label: 'Request changes' },
  { value: 'APPROVE', label: 'Approve' },
];

interface Props {
  pr: PrInfo;
  drafts: Draft[];
  unseenHigh: number;
  onCancel(): void;
  onPost(verdict: Verdict, body: string): void;
}

export function SubmitModal({ pr, drafts, unseenHigh, onCancel, onPost }: Props) {
  const [verdict, setVerdict] = useState<Verdict>('COMMENT');
  const [body, setBody] = useState('');

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
                  onChange={() => setVerdict(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>

          <label className="field">
            Review summary (optional)
            <textarea value={body} onChange={(e) => setBody(e.target.value)} />
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

          {verdict === 'APPROVE' && unseenHigh > 0 && (
            <div className="warn">
              <WarnIcon size={13} />
              <span>
                Approve with unseen high-risk hunks: {unseenHigh} remaining. This does not block
                you.
              </span>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onPost(verdict, body)}>
            Post to GitHub
          </button>
        </div>
      </div>
    </div>
  );
}
