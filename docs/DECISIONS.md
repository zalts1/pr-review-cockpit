# Decision log

One entry per decision, newest at the bottom. Each entry has the context, the options that were on the table, the decision, and what it costs us. A decision is changed by adding a new entry that supersedes it, never by editing the old one.

Status values: **accepted**, **superseded by ADR-n**, **deferred**.

---

## ADR-1: Deliver as a Claude Code plugin that runs a local web app

Status: accepted · 2026-09-08

**Context.** The reviewer already works in Claude Code and the terminal. The tool must reduce reading, which needs a richer surface than terminal text.

**Options.**
1. Browser extension over github.com. Zero context switch, but every UI addition fights GitHub's DOM and breaks when GitHub changes markup.
2. Hosted service. Needs auth, hosting and a security review for source code leaving the machine.
3. Claude Code skill that generates a local web app per PR.

**Decision.** Option 3. An extension may become a second renderer later because the review document is renderer-independent.

**Consequences.** The reviewer opens a second window. Nothing leaves the machine except the comments they choose to post.

---

## ADR-2: A versioned JSON review document is the only contract

Status: accepted · 2026-09-08

**Context.** Analyzer, LLM and UI will each change at different speeds. LLM output is unreliable and must not be able to break the UI.

**Options.**
1. The UI computes risk and order itself from raw diff and signals.
2. The analyzer emits HTML directly.
3. A schema-checked document; the UI is a plain renderer of it.

**Decision.** Option 3. Details in `03-review-document-schema.md`.

**Consequences.** Every feature costs a schema change first. In exchange, analyzers and renderers can be swapped, and LLM errors are contained to labels.

---

## ADR-3: Risk is a deterministic floor that the LLM may raise but never lower

Status: accepted · 2026-09-08

**Context.** The failure the user fears most is a false sense of safety: the heatmap says skim over a real bug.

**Options.**
1. LLM decides risk alone. Fluent reasons, unbounded misses.
2. Deterministic signals alone. Predictable, blind to meaning, cannot tell a rename from a rewrite.
3. Deterministic floor, LLM raises only.

**Decision.** Option 3. Weights, thresholds and floor rules in `05-risk-model.md`.

**Consequences.** Some hunks will be marked high that a human would skim. That is the accepted direction of error.

---

## ADR-4: The cockpit is a resident local server, and it posts reviews itself

Status: accepted · 2026-09-08 · supersedes the kickoff's "batch export through the agent"

**Context.** The kickoff proposed marking up in the UI, exporting, and having the Claude session post through `gh`. In discovery the user asked for a live server so the cockpit can be dynamic and post comments straight to the PR at the correct location.

**Options.**
1. Static HTML per PR, batch export, the agent posts.
2. Local server serving a prebuilt UI, with an API. The server posts through `gh api`.
3. A per-PR Vite dev server.

**Decision.** Option 2. The UI is still built once into static files; the server adds live state, server-sent events and write-back.

**Consequences.** One more long-lived process to manage. Comment placement no longer goes through a text round trip, which removes the main way a line could drift.

---

## ADR-5: The LLM judgment pass runs in the resident Claude session

Status: accepted · 2026-09-08

**Context.** Something has to call the model for grouping, ordering and reasons.

**Options.**
1. The resident Claude Code session reads a compact view and writes the judgment file.
2. The CLI calls the Anthropic API directly. Needs a key and separate billing.
3. The CLI spawns `claude -p` headless. Same login, slower start, harder to debug.

**Decision.** Option 1 for v1. The judgment file format makes 2 or 3 a drop-in swap.

**Consequences.** The terminal is busy for about a minute while the cockpit is already open. Non-interactive use is not possible until option 3 is added.

---

## ADR-6: The document loads in three stages

Status: accepted · 2026-09-08

**Context.** The user accepts a startup of a minute or more if the cockpit becomes usable early and says what is still loading. The call graph on the large repository is slow. The LLM pass is slow.

**Options.**
1. Wait for everything, then open.
2. Open after deterministic analysis; stream the rest.

**Decision.** Option 2. Stage 1 is diff plus deterministic risk. Stage 2 is LLM output. Stage 3 is the call graph. Each section carries a pending, ready or failed status.

**Consequences.** The UI needs a placeholder for every late section and the autopilot needs a fallback order. Worth it.

---

## ADR-7: Checkout uses a worktree when a local clone exists, else a temp clone with full history

Status: accepted · 2026-09-08

**Context.** The team's clones live under one workspace root. Churn and blame signals need history. A shallow clone would make those signals lie.

**Decision.** Search the current directory's repository, then configured workspace roots. Add a worktree at the PR head. Fall back to a full clone into the cache, kept for the next review of the same repository.

**Consequences.** Worktrees appear inside the user's clones under the cache directory, not inside the clone's tree. The first review of a repository without a local clone is slow.

---

## ADR-8: Zero configuration by default

Status: accepted · 2026-09-08

**Context.** The user wants plug and play for teammates.

**Decision.** `review 123` inside a clone needs nothing. Generated-code and sensitive-path patterns are built in. A global config holds only workspace roots. A per-repository file can add patterns but never remove built-in ones.

**Consequences.** Some folded files will be wrong for some repository until an override is added. Overrides are additive by design so a sensitive path cannot be silently unmarked.

---

## ADR-9: Bugbot and human comments are pinned; other checks are a status strip

Status: accepted · 2026-09-08

**Context.** On the target repositories Cursor Bugbot is the only bot posting inline comments. Wiz, Socket and CodeQL report pass or fail with an external URL.

**Options.**
1. Pin everything, parsing each vendor's output.
2. Pin inline review comments only; show checks as chips.

**Decision.** Option 2. Per-vendor parsing is v2 work if a finding on the heatmap ever proves worth it.

---

## ADR-10: Go gets full static analysis; TypeScript gets import edges; Python is out

Status: accepted · 2026-09-08

**Context.** Go dominates the target repositories. TypeScript lives in the frontend repositories. Python is a handful of tools.

**Decision.** Tree-sitter call graph and complexity for Go. Import-level fan-in and fan-out for TypeScript. Everything else reports unknown signals, which never lower risk.

---

## ADR-11: The cockpit copies GitHub's Files changed view

Status: accepted · 2026-09-08

**Context.** The user asked for a review experience that feels like GitHub, enhanced.

**Decision.** Unified diff, file tree, Viewed checkboxes and inline comment flow as on GitHub. Heat, groups, autopilot and the map are additions. Light theme. Details in `04-cockpit-ux.md`.

**Consequences.** Split view, dark theme and thread replies are out of v1.

---

## ADR-12: Milestone 1 is a go/no-go gate on fake data

Status: accepted · 2026-09-08

**Context.** The thesis is that a spatial, guided view beats a text summary next to the raw diff. The user's current habit, asking Claude for a summary, is the baseline.

**Decision.** Build the cockpit against a realistic hand-made review document before any analyzer exists. If it does not feel lighter, stop and rethink.

---

## ADR-13: Comments are stored in GitHub API terms from the first keystroke

Status: accepted · 2026-09-08

**Context.** A comment on the wrong line is the fastest way to lose trust.

**Decision.** Drafts carry path, line, side and the head commit from creation. Submit shows a dry-run list and is refused if the PR head has moved.

---

## ADR-14: Cockpit-to-agent questions are v2, with the mechanism reserved

Status: deferred · 2026-09-08

**Context.** A web server cannot push to a Claude Code session. A background process that exits when a question arrives can wake it.

**Decision.** Reserve `POST /api/ask` and a queue file. Do not build the wake loop in v1. Questions go to the terminal.

---

## ADR-15: Distribution to teammates

Status: deferred · 2026-09-08

**Context.** The user does not consider this crucial now.

**Decision.** Clone the repository and run one install step. Decide on a plugin marketplace listing after v1 is used by more than one person.

---

## ADR-16: One repository, npm workspaces, TypeScript throughout

Status: accepted · 2026-09-08

**Context.** The analyzer language was open. Options were TypeScript with web-tree-sitter wasm grammars, Python, or Go with cgo tree-sitter bindings.

**Decision.** TypeScript for schema, analyzer, server, CLI and cockpit, so one toolchain and no native build. Packages: `schema`, `analyzer`, `server`, `cockpit`, `cli`, plus a `skill/` folder.

**Consequences.** Wasm parsing is slower than native. The per-repository symbol index cache in ADR-6's stage 3 exists to absorb that.

---

## ADR-17: The blast-radius map is laid out with dagre in the main thread

Status: accepted · 2026-09-08 · revised by ADR-26 and ADR-30: level 1 is still dagre, level 2 is
placed directly, both from `packages/cockpit/src/lib/mapLayout.ts`, and the 300-node cap is gone

**Context.** `04-cockpit-ux.md` asks for a layered left-to-right layout with package boxes, and says the layout should run in a web worker. M1 needs a layout library chosen before the Map tab can be built.

**Options.**
1. `@dagrejs/dagre`. Small, layered Sugiyama layout, compound graphs give the package boxes for free. Unmaintained upstream but stable.
2. `elkjs`. Richer layouts and real hierarchical containers, but a 1.5 MB wasm-free bundle that would dominate the single-file build, and its API is asynchronous.
3. Hand-rolled layering from the call direction.

**Decision.** Option 1, and the layout runs synchronously in a `useMemo` rather than in a worker.

**Consequences.** The graph is capped at 300 nodes by the schema, and 34 nodes lay out in under a millisecond, so the worker buys nothing yet. If a real repository produces a graph that blocks the Files tab, the layout call moves into a worker without touching the rest of the Map code. Option 2 stays open because only `computeLayout` in `MapView.tsx` knows about dagre.

---

## ADR-18: M1 gate result — continue, with polish deferred to real data

Status: accepted · 2026-09-09

**Context.** ADR-12 made M1 a go/no-go gate. The user walked the fake PR in the built cockpit on 2026-09-08 and 2026-09-09.

**Verdict.** "Overall it does look great and a great direction." Not yet preferred over GitHub in its current state; a lot of UI polish and untested functionality remain. The direction is confirmed, the thesis is not yet proven.

**Decision.** Continue to M2. UI polish is collected in `docs/BACKLOG.md` as it surfaces and gets a dedicated pass once the cockpit runs on a real PR (after M3), because polishing against fake data optimises for the fixture. The M1 build is preserved as the tag `m1-demo` and runs with `npm run demo`.

**Consequences.** The real answer to the gate question moves to the end of M4, when the user can compare the cockpit on a real PR against their current habit.

---

## ADR-19: The four schema ambiguities are closed in favour of one explicit field each

Status: accepted · 2026-09-09

**Context.** M2 turns `03-review-document-schema.md` into code. Four questions in it had two defensible readings, and the M1 cockpit had already guessed at all four. A validator cannot be written against a document that contradicts itself, so each had to be decided before the rules could be enforced.

**Decisions.**

1. **Walk coverage.** `path` covers every hunk that is not in a group of kind `generated`, exactly once, either directly or through its group. A generated group is folded and may be left out of `path` entirely. The validator enforces the coverage; the merge appends whatever the judgment forgot under phase `other`. The alternative, walking generated hunks, would make the walk longer than the review.

2. **`signals.fanSource`.** The type is `"grep" | "graph" | null`, and it is `null` exactly when both `fanIn` and `fanOut` are `null`. Naming a source for counts that do not exist is the kind of half-truth that makes a signal untrustworthy, so the validator rejects it. Four fixture files claimed `grep` with no counts and were corrected.

3. **Drafts get a schema.** `Draft` is `{ id, path, line, side, startLine, startSide, body, commitId, createdAt, updatedAt }`, stored in `drafts.json` as `{ schemaVersion, pr, verdict, summaryBody, drafts }`, with `validateDrafts` beside the other two validators. The cockpit's `localStorage` shape is migrated to it and keeps its own two render-time ids as extra fields, which the schema allows as warnings. Deciding this now rather than in M6 means the server and the cockpit cannot disagree about what a draft is.

4. **`collapsedByDefault` alone controls expansion.** `mode` says how closely to read a group, `collapsedByDefault` says whether it starts open, and a renderer expands a group when, and only when, `collapsedByDefault` is `false`. A `scrutinize` group with `collapsedByDefault: true` is a contradiction: the validator reports it as an error and the merge expands it. The cockpit's `mode === 'scrutinize' || !collapsedByDefault` rule is gone.

**Consequences.** Two of the four decisions made existing data invalid, which is the point of having a validator: the fixtures were wrong and were fixed. The judgment file gained one rule that the doc could not express, because a proposed group has no id yet: a `path` step for a new group names one of its hunks and the merge rewrites the step to the group. Every rule above has a failing test.

---

## ADR-20: tree-sitter through prebuilt wasm grammars, never a native build

Status: accepted · 2026-09-09

**Context.** M3 needs a Go parser inside a Node CLI that a reviewer installs once and forgets. Three ways to get one.

**Options.**

1. `tree-sitter` plus `tree-sitter-go`, the native bindings. Fastest, and a node-gyp build on install: a C toolchain on every machine, a rebuild on every Node major, and an install that fails in exactly the situation where the tool is meant to help.
2. `web-tree-sitter` plus the grammar wasm from `tree-sitter-wasms`. Prebuilt for every language the project might add, no compiler, one asynchronous `init`.
3. Ship our own compiled grammar wasm in the repository. No dependency on a third party's build, and a wasm binary in a public repository that nobody can review.

**Decision.** Option 2. `goWasmPath()` resolves `tree-sitter-wasms/out/tree-sitter-go.wasm` through `createRequire`, and one lazy `Parser.init()` serves the whole process.

**Consequences.** Parsing 839 Go files takes 3.3 seconds, which the index cache then hides (ADR-21). The grammar version is whatever `tree-sitter-wasms` pinned, which is older than the current Go grammar; nothing in the risk model needs a recent one, and moving to option 1 or 3 means changing one function. Adding TypeScript or Python to the structure signals is a second wasm from the same package.

---

## ADR-21: the symbol index is keyed by path and blob sha, stored per commit

Status: accepted · 2026-09-09

**Context.** Stage 3 parses every Go file in the checkout. On the backend repository that is 839 files and 3.3 seconds, paid again on every pull request of that repository, most of which touch a few dozen files.

**Options.**

1. Key the cache by commit sha alone. A hit is free and a miss reparses everything, so every new head is a full miss.
2. Key each entry by file path and blob sha, and store the entries in a file named after the commit. A new head reuses every file whose content did not change.
3. Content-addressed store: one file per blob sha. Perfect sharing, thousands of small files, and a garbage-collection problem.

**Decision.** Option 2. `index/<commitSha>.json` holds `{ path: { blob, package, imports, functions } }`. A run loads the entry file for its own commit if it exists, otherwise the most recently written one, and reparses only the paths whose blob sha differs. The three most recent index files are kept.

**Consequences.** Two pull requests of the same repository shared 794 of 852 files: 3.3 seconds became 1.4 for the second, and re-running the same pull request became 0.13. The index is a cache with no invalidation problem, because a blob sha cannot mean two contents. It is per repository, not per pull request, so it lives beside `repo/` rather than under `pr-<n>/`. Keeping three files bounds the directory at roughly a few megabytes per repository.

---

## ADR-22: stage 3 may raise a floor, never lower it, and always rewrites the score

Status: accepted · 2026-09-09

**Context.** `05-risk-model.md` says the deterministic layer "is refined in stage 3"; `03-review-document-schema.md` says `risk.floor` is "set in stage 1, never changes". Stage 1 estimates fan-in with a name grep that over-counts, and stage 3 resolves it, so the refined number is usually lower. Both statements cannot hold.

**Options.**

1. Update the signals and leave the risk alone. The document then shows 158 callers on the file and "669 callers" in the factor that set the heat.
2. Rescore freely. A floor the reviewer already saw as high can fall to medium while they are reading, and the promise that a floor is a floor is gone.
3. Rescore, but keep the floor at the maximum of the two, and say so where the two disagree.

**Decision.** Option 3. The score and the factors always follow the resolved counts, so hover text and signals agree. The floor is `max(stage1, stage3)`. When the kept floor is above the recomputed level, the first factor reads "kept at high from the stage 1 estimate of 669 callers".

**Consequences.** On the 24-file backend pull request, 6 hunks were raised and 66 floors were kept above their recomputed level, which is the honest shape of a grep estimate. The reviewer can see which heat came from an estimate and which from the graph. `applyGraphFan` is the only place that writes risk after stage 1.

---

## ADR-23: one grep for every symbol, and no fan-in for generated files

Status: accepted · 2026-09-09

**Context.** The doc specifies `git grep -w -c <symbol>` per changed symbol. On the backend repository, 127 symbols took 11.1 seconds, two thirds of the whole stage 1 budget. Separately, the estimate for a protobuf file came out at 21,991 callers.

**Decision.** One `git grep -w -E` with all the symbols in a single alternation, in batches of 400, and the matches attributed per symbol afterwards by tokenising each matched line. Identical output, 1.4 seconds. Generated files are skipped entirely: `fanIn`, `fanOut` and `fanSource` are `null` for them.

**Consequences.** Stage 1 on a 24-file pull request went from 16.7 seconds to 5.1. The generated skip loses nothing, because a generated hunk is floored low whatever its file signals say, and it removes a number that was measuring the code generator. A file whose changed lines are all outside a function (a struct or a const block) also reports `null` rather than 0: nothing was counted, and `fanSource` says `null` with it, which the validator requires.

---

## ADR-24: two corrections to the score, both found by running it on real pull requests

Status: accepted · 2026-09-09

**Context.** The first three real pull requests produced heat that was defensible at the top and mush in the middle: on a 24-file change, 39 of 46 non-test code hunks and 71 of 131 test hunks came out medium.

**Decisions.**

1. **Each contribution is rounded to two decimals before the score sums them.** The doc's worked example adds its own rounded column to 0.65 while full precision gives 0.66. The three factors on hover have to add up to the number behind the heat, so the rounded column is the definition and the worked example is a test.
2. **Nothing in a test file counts as public surface.** A Go test function is capitalised because the test runner requires it, so `touchesPublicSurface` was true for every hunk of every test file, adding 0.05 and pushing routine test edits over the medium threshold.

**Consequences.** Test hunks at medium fell from 71 to 60 on the same pull request. The remaining spread is a weights problem, not a bug: in a repository where every touched file has 20 to 50 commits in 90 days, churn, author history and the error path alone clear 0.28. That is a calibration item with real data behind it, now in `BACKLOG.md`, and `cockpit calibrate` is the command that should settle it rather than another guess.

---

## ADR-25: the analyzer never prunes worktrees it did not create

Status: accepted · 2026-09-09

**Context.** `checkout` and `clean` called `git worktree prune` to clear stale registrations before adding and after removing. During the M3 verification runs that pruned two registrations belonging to another tool, whose directories had already been deleted. Nothing was lost, and it was still the analyzer reaching into state it does not own.

**Decision.** No `git worktree prune` on the normal path. `git worktree remove --force` handles our own worktree, and prune runs only in the recovery case where our own path is registered with no directory behind it and `worktree add` has already failed.

**Consequences.** After the fix, `git worktree list` in the user's clone is byte-identical before and after a full analyze-and-clean cycle. A stale registration from an earlier crash of this tool is cleared on the next run of the same pull request, at the cost of also pruning other dead registrations at that moment; that is the one case where there is no narrower call.

---

## ADR-26: The blast-radius map is package-level by default, with drill-down

Status: accepted · 2026-09-09 · revises the Map section of `04-cockpit-ux.md`

**Context.** On the first real PR (24 files, one store method with 158 callers) the function-level map hit the 300-node cap and dagre produced a strip several screens tall. The user's verdict: "awful", "HUGE", and zoom and pan were poor.

**Options.**
1. Keep function level, raise the cap, better layout engine. Still hundreds of nodes for any hot method.
2. Package level by default; click a changed package to see its changed functions and one-hop neighbours, capped per package.
3. Drop the map from v1.

**Decision.** Option 2. The analyzer folds neighbours beyond 40 per changed package into a count on the package node instead of truncating the graph. Wheel zoom around the cursor, drag pan, fit, back.

**Consequences.** Level 1 is always complete and small. Level 2 can be truncated per package, and says so. A schema addition: `count` on package nodes.

---

## ADR-27: The stage 2 summary follows the team's `pr-summary` brief

Status: accepted · 2026-09-09 · revises the `summary` section of `03-review-document-schema.md`

**Context.** The one-liner plus focus bullets looked thin on a real PR, and the PR body rendered as raw markdown. The user asked for a rendered, human-readable summary and pointed at the `pr-summary` skill, which already defines a brief the team trusts: TL;DR, where it fits, before and after flow, one concrete example, review path, watch for.

**Decision.** Adopt that shape as the `summary` schema. The review path is derived from `path` in the cockpit, not stored twice. The M4 prompt instructs the session to gather the context the skill gathers: PR body, commits, surrounding code. Every body shown to a person renders as sanitised markdown.

**Consequences.** M4's judgment pass produces more text per PR and needs more reading of the checkout, which is what makes the summary worth reading. The cockpit gains a markdown renderer dependency.

---

## ADR-28: A pending stage 2 section says whether anything is running

Status: accepted · 2026-09-09

**Context.** Before the judgment pass exists, the cockpit showed "Analyzing summary…" over a
document nothing was analyzing. On the first real pull request that read as a promise the tool
was not keeping. The state is genuinely `pending` — no judgment has been merged — but pending
means two different things: a pass is running, or none is attached.

**Options.**
1. A fourth `state`, `not-analyzed`. Every rule and every fixture written against three states
   has to be revisited, and `pending` loses its meaning as "not ready".
2. A convention on the existing `message`: `"not-attached"` on a pending section.
3. A flag on the document, outside `status`.

**Decision.** Option 2. `cockpit analyze` writes `pending` with `message: "not-attached"` unless
`--expect-judgment` says a pass will follow. The cockpit reads that one string and writes "Not
analyzed" instead of "Analyzing…", in the summary card, the group list and the autopilot bar.

**Consequences.** M2's validator rules stay intact: `message` is still required only when the
state is `failed`, and free otherwise. The convention is documented in `03-review-document-schema.md`
and shared as `NOT_ATTACHED` from the schema package, so the CLI and the cockpit cannot spell it
differently. Nothing enforces it: a producer that writes another pending message gets "Analyzing…",
which is the safe reading.

---

## ADR-29: Markdown is rendered with marked and DOMPurify

Status: accepted · 2026-09-09

**Context.** Every body the cockpit shows a person is markdown: the PR description, comments,
drafts, and the summary the judgment pass will write. M1 rendered a hand-written subset, bold
and inline code, and the first real PR body came out as a wall of `###` and fences.

**Options.**
1. Keep hand-rolling. Tables, fences, nested lists and links each cost more code and each is a
   place to get escaping wrong.
2. `marked` for parsing plus `DOMPurify` for sanitising.
3. `markdown-it` with HTML disabled, no sanitiser.

**Decision.** Option 2. `marked` parses, a renderer override escapes raw HTML to the text it was
written as, and DOMPurify sanitises the result against a tag whitelist with a hook that gives
every link `target="_blank" rel="noopener noreferrer"`. `class` is not an allowed attribute, so a
body cannot borrow the cockpit's styles.

**Consequences.** Two dependencies, both bundled into the single file, which grew by about 10 kB
gzipped. Two layers rather than one: the parser is configured not to emit raw HTML and the
sanitiser would remove it anyway. No syntax highlighting; a highlighter is a third dependency and
a much larger bundle, and is in the backlog.

---

## ADR-30: Level 2 of the map is placed in columns, and caps its changed functions

Status: accepted · 2026-09-09 · extends ADR-26

**Context.** ADR-26 folded neighbours beyond 40 per changed package and left level 2 to dagre. On
the verification pull request one package held 110 changed functions, most of them tests, and
dagre laid them out 5,242 px tall: a layered layout gives every long edge a slot of its own, so
80 nodes and 180 edges cost the height of 110. That is the strip ADR-26 was written to kill, one
level down.

**Options.**
1. Keep dagre and zoom out. At the fitted scale the labels are 4 px tall.
2. Place level 2 directly: callers, the open package, callees as three columns of boxed lists.
3. Cap the changed functions as well, and keep dagre.

**Decision.** Options 2 and 3 together. Level 2 is placed by a small pure function: one column per
side, one box per package, one row per function, edges routed as three-segment lines. It draws at
most 40 changed functions of the open package, tests and least-called last, and adds an "and N
more changed functions" node for the rest, next to the "and N more callers" node for what the
analyzer folded. The same package now lays out at 780 × 1,478. Level 1 stays on dagre, where a
dozen package nodes and their aggregated edges are what it is good at.

**Consequences.** Two layout paths to keep, both pure functions in `lib/mapLayout.ts` and both
measurable outside a browser. Level 2 no longer shows every changed function of a large package;
the Files tab and the walkthrough remain the complete list, and the map is a comprehension aid,
which is the trade ADR-26 already made for neighbours. The ordering rule means a changed test can
be summarised while a rarely-called production function is drawn; fan-in decides, and tests sort
last.

**Amended 2026-09-09.** HTML comments render to nothing, and `sup`, `sub`, `kbd`, `br`, `details`, `summary` pass through to the sanitiser. The first real PR body carried a bot summary wrapped in `<!-- … -->` markers and `<sup>` attribution, both shown as literal text under the original rule. GitHub `[!NOTE]`-style alerts render as a blockquote with a bold label.

---

## ADR-31: The judgment pass reads one compact markdown file, not the document

Status: accepted · 2026-09-09

**Context.** The judgment pass needs the whole pull request in one readable input: the change,
the risk floors, the groups the analyzer already made, and enough structure that every hunk can
be judged on its own. The review document has all of it and is 776 kB of JSON on a 24-file pull
request, most of it diff lines, and none of it comfortable to read.

**Options.**
1. Hand the session `review.json` and let it navigate. Every field is there, and so is every
   field it does not need; a model reading JSON spends its attention on punctuation.
2. Hand it `gh pr diff` plus a table of floors. Two inputs to keep in step, and the join is the
   model's problem.
3. A compact markdown view written next to the document, one block per hunk, with the floor and
   its factors attached to each block.

**Decision.** Option 3. `compact.md`, written by `cockpit analyze` and regenerable with
`cockpit compact <pr>`. Fixed order: legend, pull request with its body verbatim, file list with
the rule that folded each generated file, stage 1 groups, one block per hunk outside a generated
group, then the stage 1 comments. A hunk under 40 changed lines carries its change text in full;
a larger one carries its first 15 changed lines and a count of the rest. Each block names the
fields the merge rules act on, so a session that reads only this file can still produce a
judgment the CLI accepts.

**Consequences.** It is not a compressed diff, and the earlier claim in `02-architecture.md`
that a large pull request "compacts to roughly a fifth of its size" was wrong. Measured on the
verification pull request: 164 kB, against 131 kB of `gh pr diff` and 776 kB of `review.json`.
The change text inside it is 88 kB — two thirds of the raw diff, which is what the caps and the
generated fold buy — and the other 76 kB is per-hunk metadata, about 300 bytes a hunk. The trade
is deliberate: the file replaces the document as the model's input, not the diff as the
reviewer's. Two consequences of the format itself: the change text is fenced with a fence that
grows past three backticks when the text holds backticks, so a markdown file in the diff cannot
break the block; and the diff header is printed only where tree-sitter parsed no symbol, since
elsewhere it repeats the symbol line and cost 12 kB on that pull request.

---

## ADR-32: The judgment prompt is a text template the CLI renders

Status: accepted · 2026-09-09

**Context.** The prompt is the whole judgment layer: the schema, the floor rules, the merge
rules, the shape of the summary, and the compact view. It has to be reviewable like any other
artefact, and it has to be exactly what the session receives, not a paraphrase of it.

**Options.**
1. Write it into `SKILL.md` and let the session assemble the schema and the compact view itself.
   The session then decides what the schema says, which is the one thing that must not drift.
2. Build it in TypeScript as a template literal. Reviewable only as code, and a diff of it reads
   as a diff of a string.
3. Keep it as markdown with `{{placeholders}}` the CLI fills, and print the filled prompt from a
   subcommand.

**Decision.** Option 3. `skill/review/judgment-prompt.md` holds the text; `cockpit judge-prompt
<pr>` fills it and prints it to stdout. The CLI supplies the pull request, the checkout path,
the output path, the next command, the schema version, the reason cap, the hunks that must carry
a reason, the stage 1 group ids, the walkable hunk count, the judgment JSON Schema read from
`packages/schema/schemas/judgment.schema.json`, and the compact view. A placeholder the CLI
cannot fill is an error, not an empty string, so the template and the code cannot drift apart
quietly.

**Consequences.** The schema in the prompt is the schema the validator runs, by construction.
The prompt is a file a person can read and comment on in a pull request. Placeholder values are
inserted in one pass and are never rescanned, so `{{...}}` inside a pull request body or a Go
template in the diff passes through untouched. The skill lives in `skill/review/` rather than at
`skill/SKILL.md` as `06-milestones.md` assumed, so the prompt sits next to the skill that uses
it and a second skill can be added later without moving either.

---

## ADR-33: A rejected judgment fails loudly and the retry lives in the skill

Status: accepted · 2026-09-09 · refines the failure behaviour in ADR-5

**Context.** `03-review-document-schema.md` says an invalid judgment is kept as
`judgment.rejected.json` and the errors are returned to the session for one retry. Something has
to own that loop, and `02-architecture.md` left it ambiguous between the CLI and the skill.

**Options.**
1. The CLI owns the retry: it would have to call the LLM, which ADR-5 put in the resident
   session.
2. The CLI marks stage 2 `failed` on the first rejection. The reviewer then sees a failure for
   something that is about to be retried and probably succeed.
3. The CLI fails loudly and writes nothing; the skill owns the one retry.

**Decision.** Option 3. `cockpit judge-merge` exits non-zero, keeps the file as
`judgment.rejected.json` beside the document, prints the first five errors in plain words and
one line naming where to write the corrected file. It never touches `review.json` on a failure,
so the stage 2 sections stay `pending` and the cockpit keeps saying what it said before.
`skill/review/SKILL.md` holds the loop: fix once, retry once, then stop and report.

**Consequences.** Five errors is a fixable list; forty is not, so the rest are counted rather
than printed. Marking stage 2 `failed` after a second rejection is left to M7, which owns the
skill's progress reporting — until then a second failure is a message in the terminal, not a
label in the cockpit. `--judgment <file>` reads a judgment from elsewhere and still writes the
rejected copy into the pull request's cache directory, so the name the docs promise is always
where the docs say.

---

## ADR-34: The M4b redesign follows direction B, "Calm GitHub", with two pieces from C

Status: accepted · 2026-09-10

**Context.** After M4 the user found the cockpit too dense, unclear about where to start, unfinished-looking, and awkward to navigate. Three directions were mocked up on one axis, how much of the PR is on screen at once: A focus mode (one step at a time), B calm GitHub (full diff, current file open, quiet heat), C plan rail (brief and steps in a wide rail beside the plain diff).

**Decision.** B. Engineers trust the diff, not a narrative about it; B keeps the full diff one click away and matches GitHub muscle memory. From C it takes the before/after flow and watch-for shown once in the plan strip, and step notes on rail hover. Adds "Ask Claude about this hunk", which copies a ready prompt, as the cheap first version of the cockpit-to-agent channel. Focus mode may return later as a toggle.

**Consequences.** The bottom autopilot bar is removed; its function moves to the header button and the plan strip. The rail changes from a file tree to a review-order list. Reference mockups in `docs/design/m4b/`.
