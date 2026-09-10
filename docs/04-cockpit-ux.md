# 04 — Cockpit UX

Status: as built after M4b. Renders the document in `03-review-document-schema.md`. The approved mockups are `design/m4b/files-screen.html` and `design/m4b/map.html`.

## Principle

The cockpit looks like GitHub's "Files changed" tab and behaves like it wherever GitHub already behaves well: same diff, same Viewed checkbox, same gutter `+` for a comment. Everything we add answers one of two questions — *where do I start* and *what should I be afraid of* — and everything else stays quiet. One primary action on screen, and it names the next step rather than saying "Next".

Light theme only, using GitHub's light palette: white page, `#f6f8fa` panels, green and red diff backgrounds, `#0969da` links, 6 px radii, 1 px `#d0d7de` borders. Every icon is inline SVG that inherits `currentColor`.

## Screen 1: Files

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ tenant-platform  Add tenant record API  #1234    [Files|Map] 2 drafts [⌨] [Submit review]│
│ jdoe · TP-329-tenant-record-api → main · d4e5f6a  ✓4 checks passed  ✗Analyze failed      │
│                                                     [ Next: UpdateRecord error contract →]│
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ TL;DR Adds a tenant record API…   ▁▁▁ models 2/2 ▁▁▁ core 1/4 …  Step 3 of 11 ·          │
│ ▾ Before and after, and what to watch for       2 high-risk ahead · 12 hunks skippable   │
├───────────────┬──────────────────────────────────────────────────────────────────────────┤
│ REVIEW PATH   │ STEP  core · Service.UpdateRecord    [Prev] [Mark reviewed] [Ask Claude] │
│  ✓ types.go   │  3    UpdateRecord now validates the id and returns a gRPC status.       │
│  ✓ 0042.sql   ├──────────────────────────────────────────────────────────────────────────┤
│  ● record.go  │ api/service/tenant/record.go  +64 −12                        ☐ Viewed    │
│  ○ validate.go│ ┃ ▲ HIGH  Changes the error contract.       23 callers · 5 fix commits   │
│  ● tenant.go  │ ┃ @@ -88,14 +91,31 @@ func (s *Service) UpdateRecord(…)                  │
│    router.go  │ ┃  88  91   if req.GetId() == "" {                                       │
│    sync.go    │ ┃  89       -    return nil, ErrMissingID                                │
│               │ ┃      92   +    return nil, status.Error(codes.InvalidArgument…          │
│ SKIPPABLE     │ ┃           [🤖 Bugbot medium status.Error drops the wrapped cause…]      │
│  › Rename  9  ├──────────────────────────────────────────────────────────────────────────┤
│  › Generated 4│ › api/service/tenant/validate.go +12 −9              step 4 · medium     │
│               │ › api/http/tenant.go             +61 −12             step 5 · high       │
└───────────────┴──────────────────────────────────────────────────────────────────────────┘
```

### Header

- **Identity line**: repository, title as a link to the PR, number, and a `draft` pill for a draft PR.
- **Meta line**: author, head branch → base branch, the short head sha the review is bound to (full sha on hover), then the checks.
- **Check pills**, compact and aggregated: one green "N checks passed" pill naming the checks on hover, one red pill per failing check linking to it, one amber "N running" pill, one grey "N skipped" pill for neutral, skipped and cancelled. Every pill is a link: a failing check goes to its own run, a pill standing for one check goes to that check, and a pill standing for several goes to the PR's checks tab. Before `checks` is ready the pill says "Loading checks"; with no checks at all it says "No checks reported"; when the fetch failed it says "Checks unavailable" with the `gh` error on hover, rather than claiming there are none. The old one-chip-per-check strip cost a whole header row on a repository with fifteen checks, and one pill per pending check would cost the same row again on a repository mid-build.
- **Bot summary pill**, one per entry of `botSummaries`: "Bugbot: medium risk", coloured by the level, linking to the PR, with a hover card holding the rendered overview. The block it came from is dropped from the rendered PR description, so the summary is on screen once.
- **Files / Map** toggle, the **draft count**, the keyboard help button, **Submit review** as the secondary action.
- **One primary action**, green: `Next: <note of the next step>`, falling back to that step's enclosing symbol and then to its file name, clipped to 38 characters. At the end of the walk it reads "Walk complete" and is disabled. There is no bottom bar; `Prev` lives on the step card.

### Plan strip

One row under the header, on the panel background, three parts:

- **TL;DR** from `summary.tldr`, on one line with an ellipsis. While `status.summary` is pending it reads "Analyzing…", or "Not analyzed" when the message is `not-attached`; when it failed, "Summary unavailable".
- **Phase progress**: one bar per phase the walk actually uses, in review order — models, core, call sites, tests, config, other — labelled `core 1/4`. The count is the steps *reached*, not the hunks marked reviewed, so the bars and "Step i of N" always agree. The bar of the phase the reviewer is in is bold. Bar width grows with the number of steps in the phase.
- **Position**: `Step 3 of 11 · 2 high-risk ahead · 12 hunks skippable`. "High-risk ahead" counts high-risk hunks the walk has not reached. "Skippable" counts hunks a skim group folded away *plus* hunks the risk model marked skim on their own, which is more than `summary.counts.skimmable` reports on a PR where grouping did the work.

Beneath it a disclosure row, "Before and after, and what to watch for", which opens the brief: the flow as two labelled monospace lines `before:` and `after:`, the "watch for" bullets, and a nested disclosure holding the "where it fits" bullets and the one concrete example. It is open on load when a summary is ready, collapses to its one line on the first Next, and after a manual toggle stays wherever the reviewer put it. With no summary yet the row is closed on load and opens the rendered PR description instead, because the raw description is not worth the whole strip.

### Rail: the walk, not the alphabet

`REVIEW PATH`, one row per file in `path` order. A file the walk visits at several steps appears once, at its first, and the row is current whenever the walk is anywhere inside that file. Each row carries:

- a **heat dot**: filled red for high, hollow amber for medium, nothing for low, with the level named in its `title`;
- a **green check** once the walk has passed it or the file is marked Viewed, in place of the dot;
- the path, shortened from the left to `…/v1/tenant.proto` so the file name always survives;
- a **tooltip** with the full path, the step number and the step note.

The current row takes the blue left border and the `#ddf4ff` wash. Clicking a row goes to that step.

Below a divider, `SKIPPABLE` lists the skim groups and the generated group with their file counts. Clicking one expands it in the diff pane and scrolls to it without moving the walk. A group the judgment pass marked `scrutinize` is not skippable and stays in the review path as its own row.

`Outdated comments` sits below that when `comments` holds any with `hunkId: null`, each with its `path:line`, its author, the first line of the body and a link to GitHub. Under it, `Conversation` is a closed disclosure over `conversation` — the comments with no line to pin them to — each with its source name, the file for a file-level comment, and the first line of the body. It is closed because a busy pull request collects a dozen bot notices there, and none of them is about a line the reviewer is reading.

While `path` is pending the rail says "Recommended order: analyzing…" (or "not analyzed") and walks the files in order, riskiest hunk of each first. Nobody waits for the judgment pass to start reading.

### Step card

Above the diff, and not scrolling away with it: the step number and the total, the phase, the enclosing symbol, the step note, then **Prev**, **Mark reviewed** and **Ask Claude about this hunk**. Mark reviewed marks the step's file Viewed and moves on. A step with no note says so rather than showing an empty line.

### The diff

Only the current step's file is open. Every other file is one row: chevron, path, `+`/`−`, and `step 4 · medium` on the right, red and bold when the file is high. Clicking a row opens it in place; a file the reviewer opened by hand stays open as the walk moves on, while the file the walk opened closes behind it. The pane lists files in the same review order as the rail, with anything the walk never reaches after them and the skippable groups last.

An open file has a sticky header with path, additions and deletions, the `generated`, `renamed` and `test` tags, and the **Viewed** checkbox. Viewed is a progress mark, not a fold: what is open is decided by the walk and by the reviewer's own clicks.

Skim groups render as one-line rows too — title, kind, file count, line count, and where the walk reaches them — and expand in place to their files and hunks.

Unified diff only; split view is not in v1.

### Heat encoding

Risk is shown per hunk, because the risk model works per hunk. Loud only where it has to be:

| Level | Gutter | Extra |
|---|---|---|
| high | 4 px bar in `#cf222e`, faint red wash on the line numbers | A banner above the hunk: `▲ HIGH`, the reason sentence, and the `risk.factors` right-aligned. |
| medium | 4 px bar in `#bf8700` | Nothing, unless the judgment pass wrote a reason, and then the same banner in amber. |
| low | Nothing | Nothing. |

The medium wash over the line numbers is gone: on a high-churn repository most non-test hunks come out medium, and a wash on most of the diff carries no information. Colour is never the only carrier — the bar is a real element with the level and the factors in its `title`, and the banner says the level in words. When `adjustedBy` is set the banner says "raised from medium", with the judgment pass's reason on hover, so the reviewer knows the LLM raised it and not the code signals.

### Pinned comments

An existing review thread renders as a one-line chip on the line its first comment sits on, indented under the code: source icon (a robot for a bot, a speech bubble for a person), the source name, the severity in its colour, a reply count when the thread has replies, and the first 60 characters of the body with the markdown markers stripped. Clicking expands it in place with the full rendered body, then each reply with its author and time, and a link to GitHub. A resolved thread is dimmed and carries a `resolved` marker.

A thread is one chip rather than one chip per comment: on a real pull request the argument that matters is three comments long, and three stacked chips push the code that is being argued about off the screen.

### Drafting comments

Unchanged from M1, and deliberately identical to GitHub: hovering a line shows a `+` in the gutter, clicking it opens an inline editor under the line, dragging from one `+` to another makes a range comment. Drafts render as a yellow-bordered block on their line and count in the header. `Cmd`/`Ctrl` `Enter` saves, `Esc` cancels.

Every draft, the verdict and the review body go to browser storage as they are typed and to
`PUT /api/drafts` 300 ms later, so a burst of typing is one request. On load the cockpit reads
the server's file and its own copy and keeps the one written later; when the server has none,
its own copy stands and is sent. A draft whose line the analyzer moved is re-placed under the
hunk that now holds that line, so a re-analysis does not make a draft disappear from the diff.

**Drafts that did not re-attach.** After new commits, an amber banner over the header says
"N drafts could not be re-attached after new commits" with a link to the list, which sits in
the rail under `Outdated comments` as `Drafts that did not re-attach`: each one with its
`path:line (side)` and the first line of its body, so the text can be copied onto a line the
current diff has. They are not posted and not counted as drafts.

The `+` never appears on a line outside the diff, because GitHub would reject the comment.

### Ask Claude about this hunk

On the step card and on `a`. It copies to the clipboard a prompt holding the PR identity and URL, the checkout path from `checkout.path`, the file path, the enclosing symbols, the hunk range in `@@` form with its new line span, the risk level and reason, the hunk itself in a `diff` fence, and one line of instruction: "Explain what this change does and what could break. The repository is checked out at &lt;path&gt;." A toast says "Copied", or that the browser blocked the clipboard. It is the cheap first version of the cockpit-to-agent channel reserved in ADR-14: the reviewer pastes it into a terminal session that can read the checkout.

### Keyboard

| Key | Action |
|---|---|
| `n` / `p` | Next / previous step of the review path |
| `h` | Jump to the next high-risk hunk |
| `v` | Toggle Viewed on the current file |
| `c` | Comment on the line under the cursor |
| `e` | Expand or collapse the group under the cursor |
| `a` | Copy an Ask Claude prompt for this hunk |
| `m` | Switch between the Files and Map tabs |
| `?` | Show this table |
| `Esc` | Close an overlay or the comment editor |

## Screen 2: Map

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ All packages · 6 packages touched, 3 with no changed function   ▢high ▢medium ⌐┘ ━ [Fit] │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌ api/http ─────────┐                ┏ api/service/tenant ━━━━━━━━━┓                    │
│  │ 2 changed  1 high │══════════▶     ┃ 4 changed functions  2 high ┃                    │
│  │ Handler.Patch   3 │                ┃ Service.UpdateRecord     23 ┃═════▶ ┌ db/gen ──┐ │
│  └───────────────────┘                ┃ Service.GetRecord        11 ┃       │ 2 changed│ │
│  ┌ backoffice/client ┐ (dashed)       ┃ validate                  2 ┃       └──────────┘ │
│  │ calls in · 3      │──────▶         ┃ and 1 more                  ┃                    │
│  └───────────────────┘                ┃ Open package →              ┃                    │
│                                       ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛                    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Level 1, the default: packages as cards.** One card per package the change touches or that calls into it. A card names the package (last three path segments, full path on hover), then how much changed — `N changed functions`, or `N changed hunks` for a package the analyzer tracked no function in, such as regenerated protobuf — then the highest heat, as `N high` when any function is high. Under that, the three most-called changed functions with their caller counts, each in its own heat colour, and "and N more" for the rest, then `Open package →`. A changed card takes a 2 px border in its heat colour; the open one gets a red halo. A package with no changed function of its own is a muted dashed card counting the calls it makes into the change, and it does not open.

One edge per pair of packages, its width the number of resolved calls on a log scale with a cap, with an arrowhead in the call direction. dagre lays the cards out left to right, and the card sizes come from `lib/mapLayout.ts`, which measures the same padding, gaps and line heights that `styles.css` draws. The toolbar carries the breadcrumb, the counts, the legend and **Fit**. Hovering a card shows what it stands for and what a click will do.

**Level 2, on click: inside one package.** Callers on the left, grouped in a box per calling package; the open package's changed functions in the middle, each with its heat dot; its callees on the right in the same boxed form. Clicking a changed function switches to Files and scrolls to its first hunk. `Back` and the breadcrumb return to level 1.

Two caps keep the level readable, each stated in the toolbar with a summary node that is not clickable:

- at most 40 neighbours, which the analyzer has usually applied already, with "and N more callers" for `count.foldedNeighbours`;
- at most 40 changed functions of the open package, tests and least-called last, with "and N more changed functions" for the rest.

On the verification PR that reads "level 2 · 40 of 110 changed, 40 callers and callees shown, 128 folded". The columns are placed directly rather than by dagre, because a layered layout gave every long edge a slot of its own and turned 110 changed functions into a strip 5,200 px tall. Level 2 draws one edge per call, so at a hundred of them the edges are drawn at half opacity: the function names have to read louder than the lines between them.

**Navigation.** Wheel zooms around the cursor, drag pans, double-click fits, `Fit` fits. A graph shorter than the canvas anchors near the top instead of floating in the middle of it. Each level fits once when it opens and is left alone after that, so a document update does not undo the reviewer's zoom. A pointer that travelled more than 4 px was panning, and its release does not open a card.

**Analyzer side.** The document carries function nodes for every changed function and package nodes for every package in play. Unchanged neighbours beyond the cap are folded into their package node with a `count`, not dropped, so level 1 is always complete even when level 2 is truncated.

### Markdown rendering

Every body the cockpit shows a person is rendered as markdown, not raw text: the PR description, the summary sections, existing comments, drafts on their line and the dry-run list in the submit modal. `marked` parses and `DOMPurify` sanitises, both bundled into the single file. Headings, lists, emphasis, inline code, fenced code, tables and blockquotes are styled in GitHub's light palette; links open in a new tab with `rel="noopener noreferrer"`; HTML comments are dropped, a few inline tags GitHub bodies rely on (`sup`, `sub`, `kbd`, `br`, `details`, `summary`) pass through the sanitiser, GitHub alert blockquotes such as `[!NOTE]` render with a bold label, and any other raw HTML is escaped and shown as the text it was written as. Fenced code is not syntax highlighted. One-line previews — a comment chip, an outdated comment, the disclosure hint — strip the markers instead of rendering them, because a chip showing `**bold**` reads as a bug.

## Screen 3: Submit review

A modal over either tab.

```
┌ Submit review ───────────────────────────────────────────────────┐
│ ( ) Comment   (•) Request changes   ( ) Approve                  │
│                                                                  │
│ Review summary (optional)                                        │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ 3 comments will be posted on commit d4e5f6a                      │
│  api/service/tenant/record.go:92 (RIGHT)   "status.Error dro…"   │
│  db/migrations/0042.sql:4 (RIGHT)          "Needs a default …"   │
│                                                                  │
│ ⚠ Approve with unseen high-risk hunks: 1 remaining               │
│                                                                  │
│                                  [ Cancel ]  [ Post to GitHub ]  │
└──────────────────────────────────────────────────────────────────┘
```

- The list is the dry run. Every comment shows exactly the path, line and side it will be posted with, and the server posts the file it served rather than anything the modal sends, so the two cannot disagree.
- The verdict and the summary are part of the drafts file, so closing the modal or reloading the page keeps both.
- Choosing **Approve** while high-risk hunks remain unseen shows a warning line. It does not block. The reviewer decides.
- **Post to GitHub** disables the button, shows a spinner, then a green line with the number of comments posted and a link to the review on GitHub. The drafts are cleared, because they are comments now; the server refetches the pull request's comments straight after the post, so they come back as pinned threads a second later, and nothing is faked in the meantime.
- A **comment** review with no drafts and an empty summary is refused before it is sent: the button is disabled and a line says a comment review needs a summary or at least one comment.
- If the server finds that the PR head moved, the modal shows: "The PR has new commits since this review started (d4e5f6a → 9ab12cd). Your drafts are saved. Run `cockpit run 1234` again to re-attach them." Nothing is posted.
- GitHub refusing an approval or a change request on the reviewer's own pull request shows as one plain sentence. Any other `gh` failure shows the error `gh` printed, verbatim, under the button.

## Loading and status states

Every section of the document has a state. The UI shows it in place, never as a global spinner. Before the document itself arrives, a centred card with a spinning ring says which fixture or which server URL it is waiting for; a load failure and an unsupported schema version use the same card in red.

| Section pending | What the reviewer sees |
|---|---|
| `summary` | Plan strip TL;DR reads "Analyzing…", or "Not analyzed" when `status.summary.message` is `not-attached`; the disclosure holds the rendered PR description. |
| `groups` | Only the deterministic groups (generated, imports, whitespace) appear in SKIPPABLE. |
| `path` | The rail says "Recommended order: analyzing…", or "not analyzed", and walks file order with the riskiest hunk of each file first. |
| `graph` | Map tab shows a centred message: "Building the call graph. This can take up to a minute on a large repository." |

| Section failed | What the reviewer sees |
|---|---|
| any stage 2 section | A yellow line above the diff: "Analysis did not complete: &lt;message&gt;. Risk shown is from code signals only." The cockpit keeps working. |
| `graph` | The Map tab shows the message and "Re-run from the terminal with `cockpit run 1234`." |

**Connection lost.** If the server-sent events stream drops, a red banner at the top says "Disconnected from the local server. Drafts are saved locally." Every change keeps going to browser storage while it is down, and when the stream comes back the cockpit re-reads the server's drafts and sends its own copy if the server's is older.

## Empty states

Each is a styled card, not a bare sentence.

- **No high-risk hunks.** The plan strip's position line simply omits the high-risk clause.
- **No existing comments.** Nothing is shown. No empty box.
- **Only generated changes.** A card: "Everything here is generated — every change in this PR matched a generated-code pattern. Expand the group below to read it anyway."
- **Zero-line PR** such as a merge-only PR. A card: "No textual changes — this pull request changes no file content, so there is nothing to read here. The summary above says what it does." The rail says "No files changed." and the primary action reads "Walk complete".

## Performance rules

- A file the walk is not on renders as one row, so its hunks never mount. Groups render their hunks only when expanded.
- Files above 1,500 diff lines should render with a virtualised list. Not built; in the backlog.
- The document is loaded once and re-read on each server-sent event. The UI never polls.
- The map lays out one level at a time, so it never places the whole graph. Both layouts are pure functions in `lib/mapLayout.ts`, which is also how they are measured outside a browser.
- The plan, the rail order, the phase progress, the skippable count and the Ask Claude prompt are pure functions in `lib/plan.ts`, derived from `path` so that the screen and the document cannot disagree.

## Not in v1

- Split diff view.
- Dark theme.
- Focus mode, one step at a time and nothing else on screen. Mocked up as direction A in M4b and may come back as a toggle.
- Editing a file or suggesting a change through GitHub's suggestion syntax.
- Replying to an existing comment thread. Only new comments are drafted. Replies need a different API shape.
- Multiple reviewers or presence.
- A chat panel. Questions go to the terminal, with "Ask Claude about this hunk" to carry the context there.
