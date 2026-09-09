# Backlog

Items that are agreed as worth doing but not scheduled in a milestone. Each line says where it came from. When an item is scheduled, move it into `06-milestones.md` and delete it here.

## UI polish (from the M1 walkthrough, to be done after M3 on real data)

- Unchanged-node side drawer in the Map shows a note instead of file content; needs the server to read the checkout. (M1 report)
- Summary card collapses on first Next or on scroll rather than strictly after first view. (M1 report)
- `c` comments on the last hovered line; there is no keyboard line cursor. (M1 report)
- Virtualisation for files over 1,500 diff lines. (M1 report)
- Map layout in a web worker if a real repository's graph blocks the Files tab. (ADR-17)
- User-reported rough edges from the M1 demo: to be listed.

## Schema questions for M2 (from the M1 report)

- Whether generated hunks belong in the walk order. `03-review-document-schema.md` says both "every non-grouped, non-generated hunk" and "grouped hunks appear once, as the group".
- `signals.fanSource` needs a `null` case for files where fan-in cannot be computed.
- Drafts have no schema. The cockpit defines its own shape in GitHub API terms: path, line, side, startLine, commitId.
- `mode` and `collapsedByDefault` on a group can disagree. The cockpit expands when `mode === 'scrutinize' || !collapsedByDefault`.
