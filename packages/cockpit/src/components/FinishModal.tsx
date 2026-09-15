import type { PrInfo } from '@review-cockpit/schema';
import { CheckIcon, CrossIcon, SpinnerIcon, WarnIcon } from './Icons';

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

function drafts(count: number): string {
  return `${count} ${count === 1 ? 'draft' : 'drafts'}`;
}

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

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Finish this review?">
      <div className="modal modal-finish">
        <div className="modal-head">
          <span>Finish this review?</span>
          <button className="btn btn-icon" onClick={onCancel} aria-label="Close">
            <CrossIcon size={12} />
          </button>
        </div>

        <div className="modal-body">
          <p className="finish-line">Stops the local server and removes the checkout.</p>
          <p className="finish-line">
            The analysis and your drafts stay on disk until you clean them.
          </p>

          <label className="check-row">
            <input
              type="checkbox"
              checked={purge}
              disabled={finishing}
              onChange={(e) => onPurge(e.target.checked)}
            />
            Also delete the analysis and drafts for this pull request
          </label>

          {unsentDrafts > 0 && (
            <div className="warn">
              <WarnIcon size={13} />
              <span>
                You have {unsentDrafts} unsent {unsentDrafts === 1 ? 'draft' : 'drafts'}
              </span>
            </div>
          )}

          {losingDrafts && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={confirmDrafts}
                disabled={finishing}
                onChange={(e) => onConfirmDrafts(e.target.checked)}
              />
              Delete {drafts(unsentDrafts)} too
            </label>
          )}

          {error !== null && (
            <div className="warn" role="alert">
              <WarnIcon size={13} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={blocked || finishing}
            onClick={onFinish}
          >
            {finishing && <SpinnerIcon size={12} />}
            {finishing ? 'Finishing…' : 'Finish'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * What is left after the server has gone. `purged` is null when this page did not ask for the
 * finish, and then nothing is promised about what is still on disk.
 */
export function ReviewFinished({ pr, purged }: { pr: PrInfo; purged: boolean | null }) {
  return (
    <div className="centered">
      <div className="centered-card">
        <CheckIcon size={22} />
        <h1>Review finished. You can close this tab.</h1>
        {purged === false && (
          <p>
            Run <code>cockpit run {pr.number}</code> to reopen it.
          </p>
        )}
      </div>
    </div>
  );
}
