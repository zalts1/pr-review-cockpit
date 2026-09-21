import type { PrInfo } from '@review-cockpit/schema';
import { Check, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from './ui/button';
import { Callout } from './ui/callout';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './ui/dialog';
import { CenteredCard } from './CenteredCard';

interface Props {
  unsentDrafts: number;
  purge: boolean;
  confirmDrafts: boolean;
  finishing: boolean;
  error: string | null;
  onPurge(purge: boolean): void;
  onConfirmDrafts(confirm: boolean): void;
  onCancel(): void;
  onFinish(): void;
}

const checkRow = 'flex cursor-pointer items-center gap-2 text-[13px]';
const checkbox = 'size-[15px] accent-primary';

export function FinishModal({
  unsentDrafts,
  purge,
  confirmDrafts,
  finishing,
  error,
  onPurge,
  onConfirmDrafts,
  onCancel,
  onFinish,
}: Props) {
  const losingDrafts = purge && unsentDrafts > 0;
  const blocked = losingDrafts && !confirmDrafts;
  const noun = unsentDrafts === 1 ? 'draft' : 'drafts';

  return (
    <Dialog label="Finish this review?" className="w-[520px]">
      <DialogHeader onClose={onCancel}>Finish this review?</DialogHeader>

      <DialogBody>
        <p className="m-0 text-[13px]">Stops the local server and removes the checkout.</p>
        <p className="m-0 text-[13px]">
          The analysis and your drafts stay on disk until you clean them.
        </p>

        <label className={checkRow}>
          <input
            type="checkbox"
            className={checkbox}
            checked={purge}
            disabled={finishing}
            onChange={(e) => onPurge(e.target.checked)}
          />
          Also delete the analysis and drafts for this pull request
        </label>

        {unsentDrafts > 0 && (
          <Callout>
            <TriangleAlert />
            <span>
              You have {unsentDrafts} unsent {noun}
            </span>
          </Callout>
        )}

        {losingDrafts && (
          <label className={checkRow}>
            <input
              type="checkbox"
              className={checkbox}
              checked={confirmDrafts}
              disabled={finishing}
              onChange={(e) => onConfirmDrafts(e.target.checked)}
            />
            Delete {unsentDrafts} {noun} too
          </label>
        )}

        {error !== null && (
          <Callout role="alert">
            <TriangleAlert />
            <span>{error}</span>
          </Callout>
        )}
      </DialogBody>

      <DialogFooter>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="default" disabled={blocked || finishing} onClick={onFinish}>
          {finishing && <Loader2 className="size-3 spinner" />}
          {finishing ? 'Finishing…' : 'Finish'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/**
 * What is left after the server has gone. `purged` is null when this page did not ask for the
 * finish, and then nothing is promised about what is still on disk.
 */
export function ReviewFinished({ pr, purged }: { pr: PrInfo; purged: boolean | null }) {
  return (
    <CenteredCard icon={<Check className="size-[22px] text-ok" />} title="Review finished. You can close this tab.">
      {purged === false && (
        <p>
          Run <code>cockpit run {pr.number}</code> to reopen it.
        </p>
      )}
    </CenteredCard>
  );
}
