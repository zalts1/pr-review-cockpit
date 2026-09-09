# PR Review Cockpit

A local web app that turns one pull request into a guided review: a GitHub-like unified diff
with a risk heatmap, mechanical changes folded into labelled groups, existing bot and human
comments pinned to their lines, a walkthrough that says where to look first, and a
blast-radius map of what the change touches.

The design lives in `docs/`. Start with `docs/01-product-brief.md`, then
`docs/02-architecture.md`.

**This repository is at milestone M2** (`docs/06-milestones.md`): the review document is a
checked contract. `packages/schema` holds the JSON Schema, the types generated from it, the
validator and the merge that folds a judgment file into a document; `packages/cli` exposes
both as `cockpit validate` and `cockpit merge`. The cockpit still renders hand-authored
documents: there is no analyzer, no server and no GitHub write-back yet, and Submit shows a
toast and posts nothing.

## Run it

Node 24 (see `.nvmrc`).

```sh
npm install

# dev mode, http://localhost:5173/?fixture=pr-fake-1
npm run dev --workspace @review-cockpit/cockpit
```

The fixture is chosen by the `fixture` query parameter and defaults to `pr-fake-1`:

- <http://localhost:5173/?fixture=pr-fake-1> — every stage ready
- <http://localhost:5173/?fixture=pr-fake-1.stage1> — stage 2 and 3 pending
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

In M1 the fixtures ship next to the page. From M3 the local server serves the same
`index.html` and the real `review.json` in place of them.

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
whitespace-only hunk, tests, and a 34-node call graph.

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
packages/cli/         the cockpit command: validate, merge
packages/cockpit/     the React app: renders the review document and nothing else
fixtures/             hand-authored review documents, their generator and their checker
docs/                 the design: brief, architecture, schema, UX, risk model, milestones
```

The cockpit never computes risk, order or grouping. It reads them from the document and
derives only display values: the highest heat per file, counts, and which hunks have been
seen.
