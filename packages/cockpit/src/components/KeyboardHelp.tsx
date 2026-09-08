const keys: Array<[string, string]> = [
  ['n / p', 'Next / previous step'],
  ['h', 'Next high-risk hunk'],
  ['v', 'Toggle Viewed on the current file'],
  ['c', 'Comment on the focused line'],
  ['e', 'Expand or collapse the group under the cursor'],
  ['m', 'Switch between the Files and Map tabs'],
  ['?', 'Show this table'],
];

interface Props {
  onClose(): void;
}

export function KeyboardHelp({ onClose }: Props) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="modal" style={{ width: 420 }}>
        <div className="modal-head">
          <span>Keyboard</span>
          <button className="btn-link" onClick={onClose}>
            close
          </button>
        </div>
        <div className="modal-body">
          <table className="keys">
            <tbody>
              {keys.map(([key, action]) => (
                <tr key={key}>
                  <td>
                    {key.split(' / ').map((k, i) => (
                      <span key={k}>
                        {i > 0 && ' / '}
                        <kbd>{k}</kbd>
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
