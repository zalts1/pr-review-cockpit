import { CrossIcon } from './Icons';

const keys: Array<[string, string]> = [
  ['n / p', 'Next / previous step of the review path'],
  ['h', 'Jump to the next high-risk hunk'],
  ['v', 'Toggle Viewed on the current file'],
  ['c', 'Comment on the line under the cursor'],
  ['e', 'Expand or collapse the group under the cursor'],
  ['a', 'Copy an Ask Claude prompt for this hunk'],
  ['m', 'Switch between the Files and Map tabs'],
  ['?', 'Show this table'],
  ['Esc', 'Close an overlay or the comment editor'],
];

interface Props {
  onClose(): void;
}

export function KeyboardHelp({ onClose }: Props) {
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div className="modal modal-keys" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <span>Keyboard</span>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">
            <CrossIcon size={12} />
          </button>
        </div>
        <div className="modal-body">
          <table className="keys">
            <tbody>
              {keys.map(([key, action]) => (
                <tr key={key}>
                  <td>
                    {key.split(' / ').map((one, at) => (
                      <span key={one}>
                        {at > 0 && <span className="keys-or">/</span>}
                        <kbd>{one}</kbd>
                      </span>
                    ))}
                  </td>
                  <td>{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
