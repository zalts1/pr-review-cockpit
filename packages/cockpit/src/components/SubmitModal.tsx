import type { Draft, PrInfo } from '@review-cockpit/schema';
import { Check, Loader2, TriangleAlert } from 'lucide-react';
import { shortSha } from '../lib/derive';
import { draftTarget } from '../lib/drafts';
import { Markdown } from '../lib/markdown';
import type { SubmitResult, Verdict } from '../lib/submit';
import { Button } from './ui/button';
import { Callout } from './ui/callout';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './ui/dialog';

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

const noteClass = 'px-2.5 py-2 text-xs text-muted-foreground';

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
  const locked = posting || posted;

  return (
    <Dialog label="Submit review">
      <DialogHeader onClose={onCancel}>Submit review</DialogHeader>

      <DialogBody>
        <div className="flex flex-wrap gap-4">
          {verdicts.map((option) => (
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[13px]" key={option.value}>
              <input
                type="radio"
                name="verdict"
                className="accent-primary"
                checked={verdict === option.value}
                disabled={locked}
                onChange={() => onVerdict(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          Review summary (optional)
          <textarea
            className="min-h-[90px] resize-y rounded-md border border-input bg-background px-2 py-1.5 text-[13px] leading-normal font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60"
            value={body}
            disabled={locked}
            onChange={(e) => onBody(e.target.value)}
          />
        </label>

        <div className="rounded-md border border-border">
          <div className="border-b border-border bg-muted px-2.5 py-1.5 text-[13px]">
            {drafts.length} {drafts.length === 1 ? 'comment' : 'comments'} will be posted on
            commit <code>{shortSha(pr.head.sha)}</code>
          </div>
          {drafts.length === 0 ? (
            <div className={noteClass}>No draft comments. Only the verdict will be posted.</div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 px-2.5 py-1.5">
              {drafts.map((draft) => (
                <li key={draft.id} className="flex gap-2.5 font-mono text-xs">
                  <span className="whitespace-nowrap">{draftTarget(draft)}</span>
                  <Markdown text={draft.body} className="min-w-0 text-muted-foreground" />
                </li>
              ))}
            </ul>
          )}
        </div>

        {verdict === 'APPROVE' && unseenHigh > 0 && !posted && (
          <Callout>
            <TriangleAlert />
            <span>
              Approve with unseen high-risk hunks: {unseenHigh} remaining. This does not block
              you.
            </span>
          </Callout>
        )}

        {result?.kind === 'posted' && (
          <Callout tone="ok" role="status">
            <Check />
            <span>
              Posted {result.comments} {result.comments === 1 ? 'comment' : 'comments'}.{' '}
              <a href={result.url} target="_blank" rel="noreferrer">
                Open the review on GitHub
              </a>
            </span>
          </Callout>
        )}

        {result?.kind === 'head_moved' && (
          <Callout role="alert">
            <TriangleAlert />
            <span>
              The PR has new commits since this review started ({shortSha(result.expected)} →{' '}
              {shortSha(result.actual)}). Your drafts are saved. Run{' '}
              <code>cockpit run {pr.number}</code> again to re-attach them.
            </span>
          </Callout>
        )}

        {result?.kind === 'refused' && (
          <Callout role="alert">
            <TriangleAlert />
            <span className="font-mono text-xs whitespace-pre-wrap">{result.message}</span>
          </Callout>
        )}

        {empty && !posted && (
          <div className={noteClass}>
            Nothing to post: a comment review needs a summary or at least one comment.
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <Button onClick={onCancel}>{posted ? 'Close' : 'Cancel'}</Button>
        <Button variant="default" disabled={locked || empty} onClick={onPost}>
          {posting && <Loader2 className="size-3 spinner" />}
          {posting ? 'Posting…' : 'Post to GitHub'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
