# PR Review Cockpit

A local web app that turns one pull request into a guided review: a GitHub-like unified diff
with a risk heatmap, mechanical changes folded into labelled groups, existing bot and human
comments pinned to their lines, a walkthrough that says where to look first, and a
blast-radius map of what the change touches.

The design lives in `docs/`. Start with `docs/01-product-brief.md`, then
`docs/02-architecture.md`.

**This repository is at milestone M5** (`docs/06-milestones.md`): a real pull request
produces a real document. `packages/analyzer` resolves the pull request through `gh`, checks
it out as a worktree on a local clone, parses the diff, measures git history and Go structure
with tree-sitter, scores every hunk, and writes `review.json`; `packages/server` serves that
document to the cockpit and pushes every rewrite of it over server-sent events;
`packages/cli` drives all of it as `cockpit prepare`, `analyze`, `judge-prompt`, `judge-merge`,
`serve` and `clean`.

The judgment pass groups the change, orders the walk and writes the brief, and the merge
clamps whatever it proposes against the deterministic floor. Stage 1 also ingests what the
pull request already knows: review comments pinned to their lines and grouped into threads,
the comments with no line to pin them to, check runs and legacy statuses as the header strip,
and the summary Cursor Bugbot writes into the pull request body as a pill with the overview
behind it. The map reads the graph at two levels, packages first and one package's functions
on click, and every body the cockpit shows is rendered as sanitised markdown.

What is not here yet: write-back, so Submit posts nothing and the drafts, submit and ask
routes answer 501 (M6), and the `review <pr>` skill that runs the whole thing from one command
(M7).

## Run it

Node 24 (see `.nvmrc`).

```sh
npm install

# dev mode, http://localhost:5173/?fixture=pr-fake-1
npm run dev --workspace @review-cockpit/cockpit
```

The fixture is chosen by the `fixture` query parameter and defaults to `pr-fake-1`:

- <http://localhost:5173/?fixture=pr-fake-1> — every stage ready
- <http://localhost:5173/?fixture=pr-fake-1.stage1> — stage 2 and 3 pending, a judgment pass running
- <http://localhost:5173/?fixture=pr-fake-1.notattached> — stage 2 and 3 pending with nothing attached
- <http://localhost:5173/?fixture=pr-fake-1.graphfail> — the call graph failed
- <http://localhost:5173/?fixture=pr-fake-1.stage2fail> — the judgment pass failed
- <http://localhost:5173/?fixture=pr-fake-empty> — a merge-only PR with no textual changes

## Build and serve the single file

```sh
npm run build --workspace @review-cockpit/cockpit
```

The build writes one self-contained `packages/cockpit/dist/index.html` with all JavaScript and
CSS inlined, plus `dist/fixtures/*.json` beside it. The page fetches
`./fixtures/<name>.json` at runtime, so it needs a static server rather than a `file://` open:

```sh
npx serve packages/cockpit/dist        # or: python3 -m http.server -d packages/cockpit/dist 8080
open http://localhost:8080/?fixture=pr-fake-1
```

Without a `?fixture` query the page asks the local server for `/api/document` instead, which
is how `cockpit serve` uses the same `index.html`. Fixture mode needs no server beyond a
static one.

## Review a pull request

```sh
npm install
npm run build                      # schema, analyzer, server, cli, cockpit

# 123, owner/repo#123 or a pull request URL; a bare number needs a GitHub clone as cwd
npx cockpit analyze 456 --expect-judgment
npx cockpit serve   456 --open

# the judgment pass: print the prompt, follow it, write judgment.json, merge it
npx cockpit judge-prompt 456
npx cockpit judge-merge  456
```

`analyze` prints progress and timings per step to stderr and the path of `review.json` to
stdout, including how many comments it placed, how many it could not, and the checks by
status. Running it again on a pull request whose head has not moved keeps the judgment pass's
work: stage 2 is re-merged onto the fresh stage 1, and the line above the timings says so. `serve` prints the URL, serves the built cockpit at `/` and the document at
`/api/document`, and pushes `{"type":"document"}` over `/api/events` every time the document
is rewritten, so the page picks up the graph stage without a reload. When you are done:

```sh
npx cockpit clean 456              # stop the server, remove the worktree and the ref
```

`clean` keeps `review.json`. Nothing is ever written into your own clone but the objects a
fetch brings in, one ref under `refs/review-cockpit/`, and the worktree registration, and
`clean` removes both of those.

| Command | What it does |
|---|---|
| `cockpit prepare <pr> [--cwd <dir>]` | Resolve and check out only. Prints the checkout as JSON. |
| `cockpit analyze <pr> [--expect-judgment] [--no-fold-generated] [--skip-graph] [--cwd <dir>]` | Stage 1 and stage 3 into `review.json`, and `compact.md` beside it. |
| `cockpit compact <pr> [--cwd <dir>]` | Rewrite `compact.md` from the document on its own. |
| `cockpit judge-prompt <pr> [--cwd <dir>]` | Print the whole judgment prompt to stdout. |
| `cockpit judge-merge <pr> [--judgment <file>] [--cwd <dir>]` | Validate `judgment.json`, merge it, write the document and the log. |
| `cockpit serve <pr> [--port <n>] [--open] [--cwd <dir>]` | Serve the cockpit and the document on 127.0.0.1. |
| `cockpit clean <pr> [--cwd <dir>]` | Stop the server, remove the worktree and the ref, keep the document. |
| `cockpit validate <file> [--as document\|judgment\|drafts]` | Schema and referential rules. |
| `cockpit merge <document> <judgment> [--out <file>]` | Apply a judgment file to a document. |

`--no-fold-generated` leaves generated files unfolded and scored, and still records the rule
that matched them, so you can see what the fold was hiding. `--skip-graph` leaves stage 3
`pending`. `--expect-judgment` says a judgment pass will follow: without it the stage 2
sections are marked `not-attached` and the cockpit shows "Not analyzed" instead of
"Analyzing…".

Everything lives under `~/.cache/review-cockpit/<owner>/<repo>/`: `pr-<n>/review.json`,
`pr-<n>/compact.md`, `pr-<n>/judgment.json`, `pr-<n>/log.txt`, `pr-<n>/worktree`,
`pr-<n>/server.json`, and an `index/` of parsed Go symbols shared by every pull request of
that repository. `docs/02-architecture.md` has the layout.

## The judgment pass

`analyze` writes `compact.md` next to the document: the pull request as one text file, with
the file list, the deterministic groups, and one block per hunk carrying its id, path,
symbols, kind, risk floor and change text. A hunk under 40 changed lines is shown in full, a
larger one shows its first 15 changed lines and counts the rest.

`judge-prompt` prints the prompt that turns that file into a judgment: the instructions, the
judgment JSON Schema, the floor rules, the merge rules, the shape of the summary, and the
compact view at the end. The prompt itself lives in `skill/review/judgment-prompt.md` with
`{{placeholders}}` the CLI fills, so it is reviewable as text. It names one output path,
`judgment.json` beside the document, and one next command.

`judge-merge` validates that file, merges it, and writes the document atomically, so a
cockpit that is already open picks it up over server-sent events. It prints every proposal it
dropped or clamped and appends the same lines to `log.txt`. A rejected judgment is kept as
`judgment.rejected.json`, the first five errors are printed in plain words, nothing is
written, and the exit code is non-zero. `skill/review/SKILL.md` is the procedure the resident
Claude session follows, including the one retry.

### Configuration

`~/.config/review-cockpit/config.json`, optional, one field:

```json
{ "workspaceRoots": ["/Users/me/workspace"] }
```

Each root is searched one level deep for a clone whose origin matches the pull request's
repository. Without a match, the repository is cloned into the cache with full history.

`.review-cockpit.json` at the root of the repository under review, all fields optional, adds
to the built-in lists:

```json
{
  "sensitivePaths": ["internal/tenancy/**"],
  "generatedPatterns": ["api/gen/**"],
  "hazardPatterns": { "go": ["unsafeQuery"] }
}
```

## Validate and merge

```sh
npm run build                                    # schema, cli, cockpit
npx cockpit validate fixtures/pr-fake-1.json
npx cockpit validate fixtures/judgment/pr-fake-1.json
npx cockpit merge fixtures/pr-fake-1.stage1.json fixtures/judgment/pr-fake-1.json --out /tmp/review.json
npm test                                         # every validator and merge rule
```

`validate` runs the JSON Schema and then the referential rules from
`docs/03-review-document-schema.md`, names the JSON path of anything wrong and exits non-zero
on an error. Unknown fields are warnings, so a document from a newer minor version still
passes. `merge` clamps risk to the deterministic floor, assigns group ids, renumbers the walk,
appends what the judgment left out, caps the reasons and recomputes the counts, printing one
log line for everything it dropped or changed.

## Fixtures

`fixtures/pr-fake-1.json` is a review document for a 20-file, 1,752-line Go PR in a service
that manages tenant records: a protobuf change with its generated `*.pb.go`, an sqlc query
change with its generated code, a `NOT NULL` migration, the core `UpdateRecord` change with a
pinned Cursor Bugbot comment, a mechanical rename over nine files, an import-only and a
whitespace-only hunk, tests, and a 43-node call graph. Its comments cover what the ingestion
produces: a two-comment thread, a resolved thread with its answer, an outdated comment on a
line the diff no longer holds, two comments with no line to pin them to, a Bugbot summary
inside the body, and checks in six states.

| File | What it exercises |
|---|---|
| `pr-fake-1.json` | Everything ready |
| `pr-fake-1.stage1.json` | `groups`, `path`, `summary`, `graph` pending: levels at their floor, no reasons |
| `pr-fake-1.graphfail.json` | `status.graph` failed with a message |
| `pr-fake-1.stage2fail.json` | Stage 2 failed; deterministic risk only |
| `pr-fake-empty.json` | Zero-line PR |
| `judgment/pr-fake-1.json` | The judgment file that turns the stage 1 fixture into `pr-fake-1.json` |

The JSON is generated from authored diff bodies so that every line number follows from the
line arrays:

```sh
npm run fixtures:build     # rewrite the fixtures from fixtures/generate.ts
npm run fixtures:check     # assert line numbers, id references, group and path rules
```

`fixtures/check.ts` is a wrapper around `validateDocument`, so the fixtures and the tool are
checked by the same rules. `docs/03-review-document-schema.md` lists them.

## Keyboard

| Key | Action |
|---|---|
| `n` / `p` | Next / previous step of the walkthrough |
| `h` | Next high-risk hunk |
| `v` | Toggle Viewed on the current file |
| `c` | Comment on the line under the cursor |
| `e` | Expand or collapse the group under the cursor |
| `m` | Switch between the Files and Map tabs |
| `?` | Show the shortcut table |
| `Esc` | Close a modal or the comment editor |

## Layout

```
packages/schema/      the contract: JSON Schema, generated types, validator, judgment merge
packages/analyzer/    diff, git history, tree-sitter, risk, the Go call graph, review.json
packages/server/      node:http on 127.0.0.1: the cockpit, the document, its change events
packages/cli/         the cockpit command: prepare, analyze, serve, clean, validate, merge
packages/cockpit/     the React app: renders the review document and nothing else
fixtures/             hand-authored review documents, their generator and their checker
docs/                 the design: brief, architecture, schema, UX, risk model, milestones
```

The cockpit never computes risk, order or grouping. It reads them from the document and
derives only display values: the highest heat per file, counts, and which hunks have been
seen.
