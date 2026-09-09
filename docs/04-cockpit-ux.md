# 04 — Cockpit UX

Status: draft for review. Renders the document in `03-review-document-schema.md`.

## Principle

The cockpit looks like GitHub's "Files changed" tab and behaves like it wherever GitHub already behaves well. Everything we add sits on top of that: a heat tint in the gutter, a collapsed header for mechanical groups, a "Next" button, pinned bot comments, and a second tab for the blast-radius map. A reviewer who has used GitHub should need no explanation for the first screen.

Light theme only, using GitHub's light palette: white page, `#f6f8fa` panels, green and red diff backgrounds, `#0969da` links.

## Screen 1: Files

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ tenant-platform #1234  Add tenant record API                    [ Files ] [ Map ]    │
│ jdoe wants to merge TP-329-tenant-record-api into main · d4e5f6              │
│ ✓ lint-and-test  ✓ Wiz  ✓ Socket  ✗ Analyze  ● app-client          3 drafts     │
│                                                              [ Submit review ]  │
├──────────────┬──────────────────────────────────────────────────────────────────┤
│ 19 files     │ ▾ Summary                                                        │
│              │ Adds a tenant record API with validation, renames TenantRecord   │
│ ● api/…/     │ to TenantProfile across the service.                             │
│   record.go  │ Focus: UpdateRecord error contract · migration 0042 NOT NULL     │
│ ● db/mig/    ├──────────────────────────────────────────────────────────────────┤
│   0042.sql   │ ▸ Generated · 4 files · 1,180 lines · skim            [Expand]   │
│ ○ types.go   │ ▸ Rename TenantRecord → TenantProfile · 9 files · skim [Expand]  │
│ ○ handler.go ├──────────────────────────────────────────────────────────────────┤
│ ▸ Generated  │ api/service/tenant/record.go                     ☐ Viewed  ⋯    │
│   (4)        │ ┃ ▲ HIGH  Changes the error contract of UpdateRecord. Callers    │
│ ▸ Rename (9) │ ┃         matching on ErrMissingID will silently stop matching.  │
│              │ ┃ @@ -88,14 +91,31 @@ func (s *Service) UpdateRecord(...)         │
│              │ ┃  88  91   if req.GetId() == "" {                               │
│              │ ┃  89       -    return nil, ErrMissingID                        │
│              │ ┃      92   +    return nil, status.Error(codes.InvalidArgument…  │
│              │ ┃           💬 Bugbot · medium · "status.Error drops the…" ▸     │
│              │ ┃  90  93   }                                                    │
│              │                                                                  │
│              │   @@ -140,6 +150,9 @@ func (s *Service) validate(...)             │
│              │   140 150   ...                                                  │
├──────────────┴──────────────────────────────────────────────────────────────────┤
│ Autopilot   ◀ Prev   Next ▶    core 2/4 · 1 high-risk remaining   Step 2 of 11  │
│ "UpdateRecord now validates id and returns a gRPC status."                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Header

- PR identity, branch, and the head commit the review is bound to.
- **Check strip.** One chip per check from `checks`. Green, red, grey or a spinner. Clicking opens the check's URL in a new tab. Never more than this in v1.
- **Draft count** and the **Submit review** button.

### Left sidebar: file tree

Same as GitHub's tree, with two additions:

- A **heat dot** before each file: the highest risk level among its hunks. Filled red for high, amber for medium, hollow for low. Generated files show a grey dot.
- **Groups** appear as collapsible entries at the bottom, with their file count, so the tree stays short when a rename touches many files.

Clicking a file scrolls to it. The current walkthrough step is highlighted in the tree.

### Summary card

Rendered from `summary`, in the shape of a short reviewer brief: a one-sentence TL;DR, two to four "where it fits" bullets, the flow as two labelled lines `before:` and `after:` in monospace, one concrete example rendered as markdown, the review path as a compact table derived from `path` (#, file, why here from the step note, what it does from the hunk's first symbol or its header), capped at eight rows with a last row "and N more steps: <phases>", "watch for" bullets when there are any, then the counts. Collapsed to the TL;DR after the reviewer has read it once, which in practice means after the first Next or the first scroll. While stage 2 is pending it shows the rendered PR description with an "Analyzing…" label. When no judgment pass is attached to the session it says "Not analyzed" instead, so a placeholder never claims work that is not happening.

### Group headers

A collapsed group renders as one row: kind, title, file count, line count, and mode. `Expand` opens all of its hunks in place, each still carrying its own heat tint. A group is never hidden, only folded. A `scrutinize` group is expanded by default and only groups hunks for the walkthrough.

### The diff

Unified diff, as GitHub renders it by default. Split view is not in v1.

Each file has a sticky header with path, additions and deletions, a **Viewed** checkbox, and an overflow menu. Checking Viewed collapses the file, exactly as on GitHub. The walkthrough treats a Viewed file as done.

### Heat encoding

Risk is shown per hunk, not per line, because the risk model works per hunk.

| Level | Gutter | Extra |
|---|---|---|
| high | 4 px solid bar in `#cf222e`, faint red wash over the hunk's line numbers | A one-line **why** banner above the hunk: `▲ HIGH` and the reason sentence. Hover shows the factors. |
| medium | 4 px bar in `#bf8700`, faint amber wash | Reason banner only when a reason exists. |
| low | No bar | Nothing. |

Colour is never the only carrier. The level is written as text in the banner and as a tooltip on the bar. Hovering the bar shows the deterministic factors from `risk.factors`, for example "sensitive path `**/auth/**` · 23 callers · 5 fix commits in 90 days".

When `adjustedBy` is set, the banner says "raised from medium by analysis" so the reviewer knows the LLM raised it, not the code signals.

### Pinned comments

Existing PR comments render as a chip on the exact line: source icon, author, severity if any, and the first 60 characters of the body. Clicking expands it inline with the full markdown body and a link to GitHub. Resolved comments render dimmed and collapsed. Bot and human comments look the same apart from the icon.

Comments with `hunkId: null` are listed under an "Outdated comments" section at the bottom of the file list, with their original path and line.

### Drafting comments

Identical to GitHub: hovering a line shows a `+` in the gutter, clicking it opens an inline editor under the line. Dragging from one `+` to another selects a range and creates a multi-line comment. The editor has a markdown textarea, **Add comment** and **Cancel**. Drafts render as a yellow-bordered block on their line and count in the header. Drafts save to the server on a 300 ms debounce and are restored on reload.

The `+` never appears on lines outside the diff, because GitHub would reject the comment.

### Autopilot bar

Fixed to the bottom of the diff pane.

- **Prev** and **Next** move through `path`. Next scrolls the target hunk to the top third of the viewport, highlights it for a second, and marks the step as seen. When the target is a group, Next scrolls to the group header and does not expand it.
- **Progress line.** Left part is the current phase and position within it, right part is the count of high-risk hunks not yet seen: `core 2/4 · 1 high-risk remaining`. When all high-risk hunks are seen, it turns green and reads `all high-risk hunks seen`.
- **Step note**, from `path[].note`, under the buttons.
- **Skip to next high-risk** as a secondary action.

Before stage 2 is ready, the bar reads "Recommended order: analyzing…" and Next walks the files in GitHub's order, high-risk hunks first within each file. Nobody waits for the LLM to start reading.

### Keyboard

| Key | Action |
|---|---|
| `n` / `p` | Next / previous step |
| `h` | Next high-risk hunk |
| `v` | Toggle Viewed on the current file |
| `c` | Comment on the focused line |
| `e` | Expand or collapse the group under the cursor |
| `m` | Switch to the Map tab |
| `?` | Show this table |

## Screen 2: Map

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ... same header ...                                       [ Files ] [ Map ]     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│      ┌ api/http ───────────┐          ┌ api/service/tenant ─────────────┐       │
│      │  Handler.PatchTenant│ ───────▶ │ ■ Service.UpdateRecord          │       │
│      │  Handler.GetTenant  │ ───────▶ │ ■ Service.GetRecord             │       │
│      └─────────────────────┘          │ ■ validate                      │       │
│                                       └────────────┬────────────────────┘       │
│      ┌ cmd/worker ─────────┐                       ▼                            │
│      │  syncTenants        │ ───────▶ ┌ cases/db ──────────────────────┐        │
│      └─────────────────────┘          │   Repo.Update                  │        │
│                                       └────────────────────────────────┘        │
│                                                                                 │
│  ■ has a changed function   □ caller or callee only   ━▶ more calls             │
│  All packages · 12 packages · 23 changed functions · click a changed package     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Revised after the first real PR

The function-level map above failed on real data. One changed store method had 158 callers, the document hit the 300-node cap, and the layered layout produced a strip several screens tall that nothing could read. The map is now two levels.

**Level 1, the default: packages.** One node per package that the change touches or that calls into it. A package holding a changed function is filled; a package with changed hunks but no changed function of its own, such as a regenerated proto package, is outlined and does not open. Every changed package carries a border in the highest heat among its changed hunks, and unchanged packages are muted. Node size grows with `count.changedFunctions`, between a minimum and a maximum so the label stays readable. One edge per pair of packages, its width the number of resolved calls on a log scale with a cap. The label is the last two segments of the package path, with the full path on hover, next to "N changed functions · M callers folded". dagre lays it out left to right. On the 24-file backend pull request this is 4 nodes in a box of 984 × 134.

**Level 2, on click: inside one package.** Clicking a changed package replaces the view with its changed functions and their one-hop neighbours, in three columns of boxes: callers on the left, the open package in the middle, callees on the right, one box per package with its path as the box label. Hovering a function shows its fan-in, fan-out and hunk ids. Clicking a changed function switches to Files and scrolls to its first hunk, as before.

Two caps keep the level readable, each with a summary node that is not clickable:

- at most 40 neighbours, which the analyzer has usually applied already, with "and N more callers" for `count.foldedNeighbours`;
- at most 40 changed functions of the open package, tests and least-called last, with "and N more changed functions" for the rest.

The columns are placed directly rather than by dagre: a layered layout gives every long edge a slot of its own, which turned one package's 110 changed functions into a strip 5,200 px tall. Boxed lists in columns put the same package in 780 × 1,478.

**Navigation.** Wheel zooms around the cursor, drag pans, double-click fits, and a Fit button and a Back button sit in the toolbar next to the breadcrumb "All packages › pkg/path". It is one SVG `transform` on a group with pointer events, no pan-and-zoom library. Each level fits once when it opens and is left alone after that, so a document update does not undo the reviewer's zoom.

**Analyzer side.** The document still carries function nodes for every changed function and package nodes for every package in play. Unchanged neighbours beyond the cap are folded into their package node with a `count`, not dropped, so the level 1 view is always complete even when level 2 is truncated. This is a schema change and is listed in `03-review-document-schema.md`.

### Markdown rendering

Every body the cockpit shows a person is rendered as markdown, not raw text: the PR description, the summary sections, existing comments, drafts on their line and the dry-run list in the submit modal. `marked` parses and `DOMPurify` sanitises, both bundled into the single file. Headings, lists, emphasis, inline code, fenced code, tables and blockquotes are styled in GitHub's light palette; links open in a new tab with `rel="noopener noreferrer"`; raw HTML in a body is escaped and shown as the text it was written as, never parsed. Fenced code is not syntax highlighted. Raw markdown was shown at M1 and read as unfinished on a real PR.

## Screen 3: Submit review

A modal over either tab.

```
┌ Submit review ───────────────────────────────────────────────────┐
│ ( ) Comment   (•) Request changes   ( ) Approve                  │
│                                                                  │
│ Review summary (optional)                                        │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │                                                              │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ 3 comments will be posted on commit d4e5f6                       │
│  api/service/tenant/record.go:92 (RIGHT)   "status.Error dro…"   │
│  db/migrations/0042.sql:4 (RIGHT)          "Needs a default …"   │
│  api/http/tenant.go:118–121 (RIGHT)        "Same check as ab…"   │
│                                                                  │
│ ⚠ Approve with unseen high-risk hunks: 1 remaining               │
│                                                                  │
│                                  [ Cancel ]  [ Post to GitHub ]  │
└──────────────────────────────────────────────────────────────────┘
```

- The list is the dry run. Every comment shows exactly the path, line and side it will be posted with.
- Choosing **Approve** while high-risk hunks remain unseen shows a warning line. It does not block. The reviewer decides.
- **Post to GitHub** disables the button, shows a spinner, then either a link to the posted review or the error text from `gh`.
- If the server finds that the PR head moved, the modal shows: "The PR has new commits since this review started. Your drafts are saved. Run `review 1234` again to re-attach them." Nothing is posted.

## Loading and status states

Every section of the document has a state. The UI shows it in place, never as a global spinner.

| Section pending | What the reviewer sees |
|---|---|
| `summary` | The PR description with an "Analyzing…" label, or "Not analyzed" when `status.summary.message` is `not-attached`. |
| `groups` | Only the deterministic groups (generated, imports, whitespace). A "Mechanical changes: analyzing…" line under the group list, or "not analyzed". |
| `path` | Autopilot bar reads "Recommended order: analyzing…", or "not analyzed", and walks file order, high-risk first. |
| `graph` | Map tab shows a centred message: "Building call graph… this can take up to a minute on large repositories." |

| Section failed | What the reviewer sees |
|---|---|
| any stage 2 section | A yellow line at the top: "Analysis did not complete: <message>. Risk shown is from code signals only." The cockpit keeps working. |
| `graph` | The Map tab shows the message and "Re-run from the terminal with `review 1234 --graph`." |

**Connection lost.** If the server-sent events stream drops, a red banner at the top says "Disconnected from the local server. Drafts are saved locally." Drafts are also kept in browser storage as a fallback and replayed to the server on reconnect.

## Empty states

- **No high-risk hunks.** The autopilot bar reads `no high-risk hunks · 11 steps`. If stage 2 failed, it adds "based on code signals only".
- **No existing comments.** Nothing is shown. No empty box.
- **Only generated changes.** One group header, expanded, with a note: "Every change in this PR matched a generated-code pattern."
- **Zero-line PR** such as a merge-only PR. A single message: "This PR has no textual changes."

## Performance rules

- Collapsed files and collapsed groups render as headers only. Hunks mount when the file opens, when the reviewer scrolls near it, or when Autopilot targets it.
- Files above 1,500 diff lines render with a virtualised list so scrolling stays smooth.
- The document is loaded once and updated by patch over server-sent events. The UI never polls.
- The map lays out one level at a time, so it never places the whole graph. The layout is a pure function outside the component, which is also how it is measured in tests; if a real repository makes it block the Files tab it moves to a web worker.

## Not in v1

- Split diff view.
- Dark theme.
- Editing a file or suggesting a change through GitHub's suggestion syntax.
- Replying to an existing comment thread. Only new comments are drafted. Replies are a v2 item, since they need a different API shape.
- Multiple reviewers or presence.
- A chat panel. Questions go to the terminal.
