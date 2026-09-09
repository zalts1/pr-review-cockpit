import type { Group, ReviewFile, RiskLevel } from '@review-cockpit/schema';

interface Props {
  files: ReviewFile[];
  totalFiles: number;
  heatByFile: Map<string, RiskLevel>;
  groups: Array<{ group: Group; fileCount: number }>;
  groupsPending: boolean;
  viewed: Set<string>;
  targetFileId: string | null;
  targetGroupId: string | null;
  onFile(fileId: string): void;
  onGroup(groupId: string): void;
}

function dotClass(file: ReviewFile, heat: RiskLevel | undefined): string {
  if (file.generated.is) return 'dot dot-generated';
  return `dot dot-${heat ?? 'low'}`;
}

function heatWord(file: ReviewFile, heat: RiskLevel | undefined): string {
  if (file.generated.is) return 'generated';
  return `${heat ?? 'low'} risk`;
}

export function FileTree({
  files,
  totalFiles,
  heatByFile,
  groups,
  groupsPending,
  viewed,
  targetFileId,
  targetGroupId,
  onFile,
  onGroup,
}: Props) {
  return (
    <nav aria-label="Changed files">
      <div className="sidebar-title">
        {totalFiles} {totalFiles === 1 ? 'file' : 'files'}
      </div>
      <ul className="tree">
        {files.map((file) => {
          const heat = heatByFile.get(file.id);
          const dir = file.path.includes('/')
            ? `${file.path.slice(0, file.path.lastIndexOf('/') + 1)}`
            : '';
          const name = file.path.slice(dir.length);
          return (
            <li key={file.id}>
              <button
                className={[
                  'tree-row',
                  targetFileId === file.id ? 'is-target' : '',
                  viewed.has(file.id) ? 'is-viewed' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onFile(file.id)}
                title={`${file.path} · ${heatWord(file, heat)}`}
              >
                <span className={dotClass(file, heat)} aria-hidden="true" />
                <span className="tree-path">
                  <span className="tree-dir">{dir}</span>
                  {name}
                </span>
                <span className="tree-count">
                  +{file.additions}/−{file.deletions}
                </span>
              </button>
            </li>
          );
        })}
        {files.length === 0 && totalFiles > 0 && (
          <li>
            <div className="file-note">No files outside the groups.</div>
          </li>
        )}
      </ul>

      {(groups.length > 0 || groupsPending) && (
        <div className="sidebar-section">
          <div className="sidebar-title">Groups</div>
          <ul className="tree">
            {groups.map(({ group, fileCount }) => (
              <li key={group.id}>
                <button
                  className={`tree-row${targetGroupId === group.id ? ' is-target' : ''}`}
                  onClick={() => onGroup(group.id)}
                  title={`${group.title} · ${group.mode}`}
                >
                  <span aria-hidden="true">▸</span>
                  <span className="tree-path">{group.title}</span>
                  <span className="tree-count">({fileCount})</span>
                </button>
              </li>
            ))}
          </ul>
          {groupsPending && (
            <div className="file-note">Looking for mechanical changes…</div>
          )}
        </div>
      )}
    </nav>
  );
}
