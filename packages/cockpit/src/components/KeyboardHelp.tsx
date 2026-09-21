import { Fragment } from 'react';
import { Dialog, DialogBody, DialogHeader } from './ui/dialog';
import { Kbd } from './ui/kbd';

const keys: Array<[string, string]> = [
  ['n / p', 'Next / previous step of the review path'],
  ['h', 'Jump to the next high-risk hunk'],
  ['v', 'Toggle Viewed on the current file'],
  ['c', 'Comment on the line under the pointer, or on this step’s hunk'],
  ['e', 'Expand or collapse the group under the cursor'],
  ['a', 'Copy an Ask Claude prompt for this hunk'],
  ['m', 'Switch between the Files and Map tabs'],
  ['t', 'Switch between the light and dark theme'],
  ['?', 'Show this table'],
  ['Esc', 'Close an overlay or the comment editor'],
];

interface Props {
  onClose(): void;
}

export function KeyboardHelp({ onClose }: Props) {
  return (
    <Dialog label="Keyboard shortcuts" className="w-[420px]" onDismiss={onClose}>
      <DialogHeader onClose={onClose}>Keyboard</DialogHeader>
      <DialogBody>
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {keys.map(([key, action]) => (
              <tr key={key} className="border-b border-border last:border-0">
                <td className="w-24 px-2 py-1 whitespace-nowrap">
                  {key.split(' / ').map((one, at) => (
                    <Fragment key={one}>
                      {at > 0 && <span className="mx-1 text-subtle">/</span>}
                      <Kbd>{one}</Kbd>
                    </Fragment>
                  ))}
                </td>
                <td className="px-2 py-1">{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogBody>
    </Dialog>
  );
}
