# Facelift design reference

Three directions for a visual rebuild of the cockpit on shadcn/ui, mocked up on the
`pr-fake-1` fixture at step 5 of 12 (record.go, the high-risk `UpdateRecord` hunk, with the
Bugbot chip, the danat thread and one draft). Open `index.html` in a browser to switch between
them and between the light and dark theme. Each file is also a self-contained 1440×900 frame.

None of the three removes anything the cockpit does today. The header actions, the review
path, the skippable groups, outdated comments, the conversation, the plan strip's numbers, the
step card's three actions, the Viewed checkbox, pinned threads, drafts and the inline `+`
gutter are in every direction; they only move.

| | 1 · Ledger | 2 · Instrument panel | 3 · Reading room |
|---|---|---|---|
| Layout | Today's: rail, plan strip, step card, diff | Rail, diff, right inspector, status bar | One centred column, stepper on top, floating action bar |
| Where "why is this risky" lives | Banner above the hunk, as now | Inspector, with a bar per factor | Banner above the hunk |
| Where the brief lives | Plan strip disclosure | Inspector section | Card at the top of the column |
| Where the file list lives | Rail, always open | Rail, always open | Sheet behind the Files button |
| Palette | shadcn zinc, blue for the walk | Cool graphite, indigo for the walk, dark first | Warm stone, teal for the walk |
| Type | Inter + JetBrains Mono | Geist + Geist Mono | IBM Plex Sans + IBM Plex Mono |
| Risk to muscle memory | None | Step actions move right | Rail becomes a sheet |

All three share the same shadcn parts: Button, Badge, Tabs, Tooltip, Dialog, Sheet,
Collapsible, Checkbox, Progress, ScrollArea and Lucide icons, on the `--radius` and colour
tokens shown at the top of each file.
