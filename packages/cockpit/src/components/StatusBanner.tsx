import type { ReviewDocument, SectionName } from '@review-cockpit/schema';
import { TriangleAlert } from 'lucide-react';
import { Callout } from './ui/callout';

const stage2: SectionName[] = ['groups', 'path', 'summary'];

interface Props {
  doc: ReviewDocument;
}

export function StatusBanner({ doc }: Props) {
  const failed = stage2
    .map((section) => doc.status[section])
    .filter((status) => status.state === 'failed');

  if (failed.length === 0) return null;

  const messages = [...new Set(failed.map((status) => status.message ?? 'no message given'))];

  return (
    <Callout className="flex-none" role="status">
      <TriangleAlert />
      <span>
        Analysis did not complete: {messages.join(' · ')}. Risk shown is from code signals only.
      </span>
    </Callout>
  );
}
