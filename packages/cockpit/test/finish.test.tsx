// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PrInfo } from '@review-cockpit/schema';
import { FinishModal, ReviewFinished } from '../src/components/FinishModal';
import type { Connection } from '../src/lib/connection';
import {
  connectionBanner,
  initialConnection,
  isFinished,
  nextConnection,
  shutdownReasonOf,
} from '../src/lib/connection';

const pr = {
  owner: 'owner',
  repo: 'repo',
  number: 123,
  title: 'Add a thing',
  url: 'https://github.com/owner/repo/pull/123',
  author: 'jdoe',
  draft: false,
  head: { ref: 'topic', sha: 'd4e5f6a7b8c9' },
  base: { ref: 'main', sha: 'a1b2c3d4e5f6' },
} as unknown as PrInfo;

interface ModalState {
  unsentDrafts?: number;
  purge?: boolean;
  confirmDrafts?: boolean;
}

function render(state: ModalState = {}): string {
  return renderToStaticMarkup(
    <FinishModal
      unsentDrafts={state.unsentDrafts ?? 0}
      purge={state.purge ?? false}
      confirmDrafts={state.confirmDrafts ?? false}
      finishing={false}
      error={null}
      onPurge={() => undefined}
      onConfirmDrafts={() => undefined}
      onCancel={() => undefined}
      onFinish={() => undefined}
    />,
  );
}

/** The Finish button is the last one in the modal, and disabled means a second confirm is due. */
function finishIsDisabled(html: string): boolean {
  const button = html.slice(html.lastIndexOf('<button'));
  return button.includes('disabled');
}

describe('the finish modal', () => {
  it('offers the purge and nothing more when there are no drafts', () => {
    const html = render();

    expect(html).toContain('Finish this review?');
    expect(html).toContain('Stops the local server and removes the checkout.');
    expect(html).toContain('The analysis and your drafts stay on disk until you clean them.');
    expect(html).toContain('Also delete the analysis and drafts for this pull request');
    expect(html).not.toContain('unsent');
    expect(finishIsDisabled(html)).toBe(false);
  });

  it('warns about unsent drafts and leaves the purge unchecked', () => {
    const html = render({ unsentDrafts: 3 });

    expect(html).toContain('You have 3 unsent drafts');
    expect(html).not.toContain('Delete 3 drafts too');
    expect(html).not.toContain('checked');
    expect(finishIsDisabled(html)).toBe(false);
  });

  it('asks a second time before it deletes drafts, and only then allows Finish', () => {
    const asked = render({ unsentDrafts: 3, purge: true });
    expect(asked).toContain('Delete 3 drafts too');
    expect(finishIsDisabled(asked)).toBe(true);

    const confirmed = render({ unsentDrafts: 3, purge: true, confirmDrafts: true });
    expect(finishIsDisabled(confirmed)).toBe(false);
  });

  it('needs no second confirmation when the purge would delete no draft', () => {
    expect(finishIsDisabled(render({ unsentDrafts: 0, purge: true }))).toBe(false);
  });

  it('says one draft in the singular', () => {
    const html = render({ unsentDrafts: 1, purge: true });
    expect(html).toContain('You have 1 unsent draft');
    expect(html).toContain('Delete 1 draft too');
  });
});

describe('the end state', () => {
  const finished = nextConnection(initialConnection, { kind: 'shutdown', reason: 'finished' });

  it('is what a finished shutdown event means', () => {
    expect(shutdownReasonOf('{"type":"shutdown","reason":"finished"}')).toBe('finished');
    expect(finished).toEqual({ state: 'stopped', reason: 'finished' });
    expect(isFinished(finished)).toBe(true);
  });

  it('is shown instead of the disconnected banner', () => {
    expect(connectionBanner(finished, 'owner/repo#123')).toBeNull();
    const dropped = nextConnection(initialConnection, { kind: 'failed' });
    expect(connectionBanner(dropped, 'owner/repo#123')).not.toBeNull();
  });

  it('leaves an idle or stopped server on the banner it had', () => {
    for (const reason of ['idle', 'stopped'] as const) {
      const connection: Connection = nextConnection(initialConnection, { kind: 'shutdown', reason });
      expect(isFinished(connection)).toBe(false);
      expect(connectionBanner(connection, 'owner/repo#123')).not.toBeNull();
    }
  });

  it('says how to reopen the review when the files are still there', () => {
    const html = renderToStaticMarkup(<ReviewFinished pr={pr} purged={false} />);
    expect(html).toContain('Review finished. You can close this tab.');
    expect(html).toContain('cockpit run 123');
  });

  it('promises nothing to reopen after a purge', () => {
    const html = renderToStaticMarkup(<ReviewFinished pr={pr} purged />);
    expect(html).toContain('Review finished. You can close this tab.');
    expect(html).not.toContain('cockpit run');
  });
});
