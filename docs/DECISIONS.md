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

---

## ADR-35: The plan strip is the whole brief, and openness follows the walk

Status: accepted · 2026-09-10 · extends ADR-34, revises the summary-card and Viewed rules of `04-cockpit-ux.md`

**Context.** ADR-34 put a one-row plan strip under the header with a disclosure for the flow and the
watch-for list. ADR-27 had made the summary six sections — TL;DR, where it fits, flow, example,
review path, watch for — in a card that owned the top of the diff pane. Three of those now have a
better home: the review path is the rail, the TL;DR is the strip's own row, and the counts are the
strip's position line. That leaves "where it fits" and the example with nowhere to go, and the
mockup shows no place for them.

**Options.**
1. Drop them. The strip is short and the brief loses two sections ADR-27 asked for.
2. Put all four in the open disclosure. On the verification PR the watch-for list alone is three
   bullets of two lines each; adding both would take a third of the screen on load.
3. Flow and watch-for open; where-it-fits and the example one click deeper.

**Decision.** Option 3. The disclosure holds the flow and the watch-for bullets, and a nested
disclosure labelled "Where it fits, and one concrete example" holds the other two. Nothing ADR-27
asked for is lost, and the strip is one row plus a line once the walk starts. With no summary yet
the disclosure is closed on load and opens the rendered PR description instead: the raw description
is a fallback, not a brief, and it is not worth the whole strip.

Two smaller calls in the same screen:

- **Viewed stops folding the file.** What is open is decided by the walk and by the reviewer's own
  clicks, so making a checkbox also fold would give one state two owners. Viewed is now purely a
  progress mark: it puts the green check on the rail row and counts towards the submit warning.
- **The cockpit computes its own skippable count.** `summary.counts.skimmable` counts hunks whose
  own risk mode is skim, which does not move when the judgment pass folds 141 hunks into two skim
  groups. The plan strip counts the union of the two sets, so "12 hunks skippable" means what a
  reviewer would take it to mean.

**Consequences.** The summary card and the bottom autopilot bar are deleted, and `reviewPath` in
`lib/derive.ts` goes with the review-path table. The plan's five derived values — review order,
phase progress, skippable count, high-risk ahead, next-step label — are pure functions in
`lib/plan.ts` with tests, so the screen and the document cannot drift apart. The number in the plan
strip and the number in `summary.counts.skimmable` are now allowed to differ, and the backlog says
so.

---

## ADR-36: Map cards are HTML in a transformed scene; only the edges are SVG

Status: accepted · 2026-09-10 · extends ADR-26 and ADR-30

**Context.** M3b drew the map as one SVG: rects and `text` for nodes, polylines for edges. The M4b
mockup asks each package for a card with a name, a meta row, three changed functions with caller
counts and a link — five kinds of text at three sizes, some of them coloured by heat and some
needing an ellipsis. In SVG that is manual line layout, manual truncation and a second copy of the
type scale.

**Options.**
1. Keep SVG and lay the card's text out by hand.
2. `foreignObject` per card.
3. Absolutely positioned HTML cards inside one transformed container, with an SVG behind them
   holding only the edges.

**Decision.** Option 3. One `div` takes `translate(x, y) scale(k)`, and the edge SVG and the cards
are children of it, so pan and zoom stay a single transform and the cards are ordinary CSS: the
page's fonts, the page's heat colours, `text-overflow: ellipsis`, `:hover`, real buttons. The
layout in `lib/mapLayout.ts` stays a pure function and now measures the card — padding, gaps, line
heights, per-row width — instead of guessing a box from the label length. Those constants and the
`.map-card` rules in `styles.css` describe the same card and have to be changed together, which the
comment above them says.

Level 2 keeps the three columns ADR-30 placed — callers, the open package's changed functions,
callees — rather than the mockup inset's two panes, which showed only the left and right of the
same idea. Dropping the callees column would lose the one thing the map says that the diff does
not: what this change now calls. The rows are restyled as the mockup's boxed lists with heat dots,
and the edges are drawn at half opacity, because at a hundred calls the lines read louder than the
names they connect.

**Consequences.** A card whose longest member name exceeds the 420 px cap clips that name with an
ellipsis and keeps the caller count, which is the right half to keep. Zooming scales the text
rather than reflowing it, so a card reads the same at every zoom. Pointer handling gains one rule:
a pointer that travelled more than 4 px was panning, and its release does not open a card.

---

## ADR-37: Comments with no line live in their own list, not in `comments`

Status: accepted · 2026-09-10

**Context.** M5 ingests three kinds of comment: a review comment on a line, a review comment
GitHub attaches to a whole file, and a top-level comment on the pull request conversation. The
schema's `Comment` requires a `path`, a `line` and a `side`, because the cockpit pins it and the
validator checks the line against the hunk. The last two kinds have no line.

**Options.**
1. Drop what does not fit. The description of a migration written as a conversation comment is
   often the most useful thing on the pull request; dropping it is a silent loss.
2. Relax `Comment` so `path`, `line` and `side` may be null. Every reader then has to test three
   fields before using any of them, and "outdated" — a line comment we could not place — stops
   being distinguishable from "never had a line".
3. A second list, `conversation`, whose entries have `line`, `side` and `hunkId` null and a
   `path` only when GitHub gave one.

**Decision.** Option 3. `Comment` keeps its guarantees, so the pinning code and the validator's
line rules are unchanged, and `hunkId: null` inside `comments` keeps its one meaning: a comment
that had a line and no longer has one. The two lists share every other field, so the cockpit
renders both with the same parts.

**Consequences.** Comment ids have to be unique across the two lists, which the validator now
checks; the analyzer prefixes a review comment with `c` and an issue comment with `ic`, because
the two id spaces are GitHub's and can collide. The cockpit shows `conversation` in a closed
disclosure at the foot of the rail: on the three verification pull requests it held seven
entries each, nearly all of them bot notices about scans and pipelines.

---

## ADR-38: A comment GitHub cannot place, we do not place either

Status: accepted · 2026-09-10

**Context.** A review comment carries `line` and `original_line`. `line` is where the comment
sits in the current head; it is null once the line it was written against is gone.
`original_line` is the line number in the commit the comment was written against, and it is
always present.

**Options.**
1. Fall back to `original_line` for the hunk lookup, as the M5 brief first described. It places
   more comments.
2. Place only by `line`, and treat every comment GitHub reports without one — and every comment
   on a thread GitHub marks `isOutdated` — as outdated.

**Decision.** Option 2. A number from another commit points at whatever code holds that number
now, so option 1 does not place a comment, it moves it. On the app verification pull request six
of eleven comments had no current line, and four of the six numbers do exist in the new diff:
option 1 would have pinned four comments to code they were never about. The comment keeps its
`original_line` as its `line` so the outdated list can still say `path:line`, but `hunkId` stays
null.

**Consequences.** The outdated list is longer than it would otherwise be — 2 of 7 on one
verification pull request, 6 of 11 on another — and that is the honest count. Spot-checking six
placed comments against GitHub's own `diff_hunk` on three pull requests, every one landed on the
line GitHub shows it on.

---

## ADR-39: Threads are joined by GitHub's thread id and rendered as one chip

Status: accepted · 2026-09-10

**Context.** A reply is a comment of its own with the same path and line as the comment it
answers, and resolution is a property of the thread, not of any comment in it. The REST comment
payload carries neither the thread id nor its resolved state; only the GraphQL
`pullRequest.reviewThreads` connection does.

**Options.**
1. Rebuild threads from `in_reply_to_id` and leave `resolved` always false. One REST call, no
   resolution, and "resolved" is exactly what tells a reviewer they can skip a chip.
2. Nest replies inside their parent comment in the document.
3. One GraphQL query for the threads, joined to the comments by comment id, with `threadId` on
   each comment and the thread's resolved state copied to every comment in it.

**Decision.** Option 3, with option 1 as the fallback when the query fails. `threadId` is a flat
field, so the document stays a list of comments and the cockpit does the grouping — three
comments of one thread become one chip with a reply count. Nesting would have made every reader
walk two levels to find a body, and would have put the same body in two shapes depending on
whether it was first.

**Consequences.** One more `gh` call per analysis, about 300 ms of the 2.8 seconds the whole
fetch takes. A thread with more than 100 comments would lose the resolution of the rest; nothing
reads a hundred replies. The validator warns when one thread holds comments on two paths, which
GitHub should never produce and which would put two files under one chip.

---

## ADR-40: A bot's body summary becomes a document field, and leaves the description

Status: accepted · 2026-09-10

**Context.** Cursor Bugbot writes its review summary into the pull request body between
`<!-- CURSOR_SUMMARY -->` markers: a `[!NOTE]` alert with a `Medium Risk` line and an overview
of the change. Rendered as part of the description it is a wall of text in the plan strip's
disclosure, and its risk level — the one thing a reviewer wants at a glance — is buried in it.

**Options.**
1. Leave it in the body. Nothing to build, and the level stays invisible.
2. Strip it in the analyzer and store the body without it. The document would then not report
   the pull request as it is, and `compact.md` would hide from the judgment pass that another
   reviewer has already been over the change.
3. Parse it into `botSummaries` and leave `pr.body` untouched; the cockpit drops the block when
   it renders the description.

**Decision.** Option 3. Stage 1 stays a faithful report of the pull request, and the duplicate
is a rendering concern, solved where the rendering happens. The pill says "Bugbot: medium risk"
in the level's colour and holds the overview in a hover card.

**Consequences.** The marker pattern exists twice, in the analyzer's parser and in the cockpit's
`lib/prBody.ts`, and a second vendor's markers would have to be added to both. The strip is
keyed on `<!-- X_SUMMARY -->` with a matching close marker, so a block whose close marker is
missing is left in the description rather than swallowing the rest of it. `botSummaries` has no
entry in `status`: it is parsed from a field stage 1 already holds, so there is no fetch to
fail and nothing to report as pending.

---

## ADR-41: Re-analysing an unchanged head keeps stage 2, through the merge

Status: accepted · 2026-09-10

**Context.** `cockpit analyze` rewrites `review.json` from scratch. Running it again on a pull
request whose judgment pass has already run — to pick up new comments, a finished check, or a
newer build of the tool — threw away the groups, the walk, the reasons and the brief, and the
reviewer had to pay for another judgment pass to get them back.

**Options.**
1. Copy the stage 2 sections across when the head sha matches. Fast, and wrong the moment the
   merge base has moved under an unchanged head: the hunk ids shift, and a walk that names ids
   that no longer exist is a broken document.
2. Read stage 2 back out of the cached document as a judgment file and re-merge it onto the
   fresh stage 1.

**Decision.** Option 2, guarded by the head sha. The merge already knows how to drop unknown
hunk ids, re-clamp a raise against a floor that moved, renumber the walk and append what the
walk no longer covers, and it logs every one of those. After the merge the document is
validated, and a stage 2 that no longer fits is dropped with the first error as the reason. A
stage 2 group carries no id in a judgment file, so a walk step for one names a hunk inside it,
exactly as the judgment pass writes it.

**Consequences.** `analyze` reads the cached document before it writes, and says on stderr
whether stage 2 was kept and why not when it was not. The graph stage, which rescores after
stage 1, now has to keep a carried raise: it holds the level at the higher of the raise and the
new floor, and clears `adjustedBy` when the floor has caught up with the raise, so the raise the
reviewer sees is always one the code signals did not already make.

---

## ADR-42: The drafts file on disk is the source of truth, and the later write wins

Status: accepted · 2026-09-10

**Context.** The reviewer types drafts into a browser tab. Two copies of them exist: the one in
browser storage, which survives a server that is not running, and `drafts.json` beside the
document, which survives the tab being closed and is the only copy the submit step and the
re-attach can read. Something has to decide which of the two is right when they disagree.

**Options.**
1. Browser storage is the truth and the file is a backup written on submit. The re-attach after
   new commits would then have nothing to work on, and a closed tab would lose the drafts.
2. The file is the truth and browser storage is dropped. A server that is down, or restarting,
   would lose every keystroke since it went away, and the connection-lost banner would be a
   promise the tool does not keep.
3. The file is the truth, browser storage is the fallback, and the two are ordered by one clock.

**Decision.** Option 3. Every change is written to browser storage at once and sent to
`PUT /api/drafts` after 300 ms, so a burst of typing is one request. The server validates the
file, writes it by rename, and answers with what it stored stamped with its own clock; the
cockpit adopts that stamp. On load, and again whenever the event stream reconnects, the cockpit
compares its `updatedAt` against the served one: the later copy wins, and a local copy that is
later is sent. A served file with no `updatedAt` has never been written and loses to a local
copy that has.

**Consequences.** One clock orders the two copies, so a browser clock that is off does not
decide which drafts survive. The rule is "the later write wins", not a merge: a draft typed in
a second tab while the first tab was down is lost when the first tab saves. Two tabs on one
pull request are not a case the tool supports, and `cockpit serve` refuses to start a second
server for a pull request that already has one. The debounce and the comparison are pure
functions in `packages/cockpit/src/lib/draftsSync.ts`, tested without a browser.

---

## ADR-43: Submit reads the drafts from disk, not from the request

Status: accepted · 2026-09-10

**Context.** The submit modal shows a dry-run list: every comment with the path, line and side
it will be posted with. `POST /api/submit` could carry those comments, which is the obvious
shape for an API where the browser holds the state.

**Options.**
1. The request carries the drafts. One round trip, and the posted review is exactly what the
   modal had in memory.
2. The request carries only the verdict and the review body, and the server posts the file it
   served.

**Decision.** Option 2. The dry-run list is the promise the tool makes about what will be
posted, and the only way to keep it is for the preview and the post to read one artefact. A
request that carried its own comments would also let a stale tab post drafts the reviewer had
deleted, and would make the drafts file a cache rather than the record.

**Consequences.** The debounced save has to land before the request, or a draft typed in the
last 300 ms would not be in the file the server reads. Post therefore cancels the debounce and
awaits the `PUT` before it sends the `POST`. The response says how many comments were posted,
so a mismatch with the dry-run list is visible rather than silent. On success the server moves
the file to `submitted-<timestamp>.json` and leaves an empty one, so what was posted is kept as
a record and cannot be posted twice.

---

## ADR-44: A draft re-attaches by its line's text, and is set aside rather than moved blindly

Status: accepted · 2026-09-10

**Context.** New commits on the pull request move the lines under the drafts. Re-analysing
writes a new diff with new hunk ids and new line numbers, and every draft is bound to the old
head through `commitId`. Posting a comment against a line that has moved puts the comment on
whatever code now occupies that number, which is worse than not posting it.

**Options.**
1. Keep every draft and let GitHub decide. A comment on a line outside the new diff is a 422
   that fails the whole review, and one on a line that still exists but changed meaning is a
   comment on the wrong code.
2. Drop every draft whenever the head moves. Honest, and throws away work the reviewer did.
3. Match each draft's line by its text in the new diff, keep the ones that survive, and set the
   rest aside where the reviewer can see them.

**Decision.** Option 3. The cached document holds the text the draft was written against, at
that path, side and line. A line whose text is unchanged at the same number stays where it is;
a line the new commits moved is followed to the nearest position in the same file and side
holding that exact text; anything else is an orphan. A multi-line draft moves as a block — its
start line has to survive the same shift as its end line — because GitHub takes a range or
nothing. Without a cached document to read the text from, only the position can be trusted, and
a draft whose position is gone is an orphan. Kept drafts have their `commitId` set to the new
head.

**Consequences.** The rule is text equality, so a draft on a line the new commits reformatted is
an orphan even though the code means the same thing. A draft on a line whose text is trivial and
repeated — a bare `}` — can follow the wrong one of several identical lines; the nearest
position wins, which is the closest thing to the reviewer's intent that the text alone supports.
Orphans go to `drafts.orphaned.json`, are served with the drafts, and are shown as an amber
banner over a list in the rail; they are carried into the next re-attach, so a line that comes
back re-attaches its draft. A submit does not clear them: nothing in that file was posted.

---

## ADR-45: The skill installs as a symlink into `~/.claude/skills`, under the name `cockpit`

Status: accepted · 2026-09-10

**Context.** M7 has to get two things onto a teammate's machine: the `cockpit` binary and the
skill Claude Code loads. Claude Code reads user-level skills from `~/.claude/skills/<name>/`,
where each directory holds a `SKILL.md` with `name` and `description` in its frontmatter. The
repository is a checkout the user keeps, not a published package.

**Options.**
1. Copy `skill/cockpit` into `~/.claude/skills/cockpit`. Simple, and every edit to the skill
   needs a reinstall to take effect. A copy also drifts silently from the checkout it came
   from.
2. Ship the skill as a Claude Code plugin with `skills/cockpit/`. The right answer once the
   tool is distributed, and it needs a marketplace entry and a release process that v1 does
   not have.
3. Symlink `skill/cockpit` to `~/.claude/skills/cockpit`, and put the binary on PATH with
   `npm link`, falling back to a symlink in `~/.local/bin`.

**Decision.** Option 3, in `scripts/install.sh`. The script refuses to overwrite anything at
`~/.claude/skills/cockpit` that is not a symlink, and prints the `mv` command to run instead.
`scripts/uninstall.sh` removes only links that point into this checkout. `cockpit doctor`
reports what is linked and where, so a broken install is one command to diagnose rather than a
skill that silently never triggers.

The skill is named `cockpit`, not `review`. A skill named `review` collides with the
review-shaped skills people already have — code review, PR summaries, review UIs — and would
fire on a bare "review this PR", which is not what this tool is for. The user has to name the
cockpit, and the description says so.

**Consequences.** The skill the session runs is the file in the checkout, so an edit is live in
the next session with no reinstall. Deleting or moving the checkout breaks the link, which
`cockpit doctor` reports as a warning naming both paths. The binary link is whatever worked:
`npm link` needs a writable global prefix, which a Homebrew or system node often does not have,
and `~/.local/bin` needs to be on PATH, which the script checks and says. A plugin can be added
later without changing the skill's content, because the skill is a directory either way.

---

## ADR-46: `cockpit run` is the one command, and it opens the browser after stage 1

Status: accepted · 2026-09-10

**Context.** Until M7 the skill ran `prepare`, `analyze`, `serve` and `open` itself. `analyze`
builds the call graph in the same process, after stage 1 is written (ADR-6, step 6), so a skill
that waited for `analyze` to exit before serving would hold the browser back by the length of
the graph stage. On a large repository that is seconds; the graph is also the stage most likely
to fail, and a failure there must not cost the reviewer the cockpit.

**Options.**
1. Leave the orchestration in the skill: `analyze --skip-graph`, then `serve`, then a second
   `analyze` for the graph. Three processes, two analyses of the same diff, and a step order the
   skill can get wrong.
2. Keep one `analyze` and serve after it. One process, and the cockpit opens late for no
   reason.
3. One `cockpit run` subcommand, with the analyzer calling back once stage 1 is on disk. The
   callback starts the server and opens the browser; the graph runs after it.

**Decision.** Option 3. `analyze` gained an `onStage1` hand-off that fires after the document
and the compact view are written and before the graph starts. `run` serves and opens from
there, then lets the graph finish and rewrite the document, which the open cockpit picks up
over server-sent events. The server is a detached `cockpit serve` rather than an HTTP server in
`run`'s own process, because the resident session needs its terminal back while the server keeps
running; `run` waits for that server's `/api/health` before it reports the URL. The last line of
stdout is one line of JSON, `{url, prDir, compact, judgmentOut, headSha}`, so the skill reads
values instead of parsing prose.

**Consequences.** The cockpit opens on stage 1 on every pull request, and a graph failure is a
message in the Map tab of a cockpit that is already useful. `run` on a cached document at the
same head skips the analysis entirely and serves what is on disk, which makes it safe to run
twice; a checkout that was cleaned away is made again, because the resident session answers
questions from it. Two servers for one pull request are impossible: an alive server is reused,
and `--reuse-server` also leaves its browser tab alone, which is what a re-analysis wants.
Progress lines and the JSON go to different streams, so a wrapper reads one and a person reads
the other.

---

## ADR-47: The server refetches comments and checks straight after a post

Status: accepted · 2026-09-10

**Context.** Submitting a review clears the drafts: they are comments on GitHub now. Until M7
the cockpit then showed neither — the drafts were gone and the posted comments were not in the
document, which is only refreshed by a re-analysis. The reviewer had just published five
comments and could see none of them.

**Options.**
1. Show the drafts as pinned comments locally after a successful post. No fetch, and the cockpit
   would be showing its own guess of what GitHub stored, including ids and threads it invented.
2. Re-run `cockpit analyze`. Correct, and it re-parses the diff, re-measures git history and
   rebuilds the graph to pick up five comments.
3. Have the server call the analyzer's comment and check ingestion for the document's head and
   rewrite the document.

**Decision.** Option 3, before the submit response is sent, and again on demand through
`POST /api/refresh` behind a "Refresh from GitHub" button next to the check pills. The fetch
replaces `comments`, `conversation` and `checks` and touches nothing else, so the diff, the risk
and the judgment stay as the analysis wrote them. The document is validated and written by
rename like any other write, so the open cockpit reloads it over server-sent events. A fetch
that fails sets `status.comments` or `status.checks` to `failed` with the `gh` message, which is
exactly what stage 1 does with the same failure.

**Consequences.** `packages/server` now depends on `packages/analyzer` for the ingestion and the
document writer. The dependency runs one way — the analyzer knows nothing about the server — and
the ingestion function is injected, so the tests exercise every path without a network. The
submit response waits for one extra `gh` round trip, about a second, in exchange for the
guarantee that the page the reviewer looks at after posting includes what they posted. The
refetch uses the head the document was analysed at, which submit has just checked has not moved;
a refresh long after the head moved re-reads that same head's checks, and picking up new commits
is a re-analysis, not a refresh.

---

## ADR-48: The diff is highlighted by highlight.js, per hunk and per side

Status: accepted · 2026-09-10

**Context.** The cockpit's whole claim is that it reduces reading, and until now it asked the
reviewer to read a 4,500-line diff in one colour. GitHub's own Files tab is highlighted, so the
"same layout and feel" promise in docs/01 was broken in the one place a reviewer spends most of
their time. ADR-29 left highlighting out because a highlighter was a third dependency and a much
larger bundle; that trade needed re-pricing now that the bundle is 368 kB and the reading is the
product.

**Options.**
1. Prism or Shiki. Shiki is a real TextMate grammar engine and the honest choice for fidelity,
   and it is megabytes of grammars and a WASM regex engine, which the single-file build cannot
   hold. Prism is small but highlights a string at a time with no way to resume, so a block
   comment spanning a hunk would restart on every line.
2. `highlight.js` with the `common` build. One import, and 36 grammars — 298 kB of source
   against the 110 kB the twelve we need come to, so roughly double the bundle cost — for a
   tool that sees Go, TypeScript, protobuf, SQL and YAML.
3. `highlight.js/lib/core` with a hand-picked set registered one by one.

**Decision.** Option 3, twelve grammars: go, typescript, javascript, python, protobuf, sql,
yaml, json, bash, markdown, xml and css. The grammar for a file comes from `file.language`
first and from the extension only where the enum has no name for it — `.sql`, `.sh`, `.tf`,
`.html`, `.css`, `.js` — and everything else renders as a plain text node rather than as markup.

Highlighting is per hunk, and the hunk's two sides are two streams: the deleted lines with their
context in one pass, the added lines with their context in another. A string or a block comment
opened on a deleted line therefore cannot colour the lines that replaced it, which is exactly
the case a per-line highlighter gets wrong and the case that matters, because a diff is mostly
where one version ends and another begins.

Carrying that state across the lines of a stream cannot use highlight.js's continuation
argument: 11.12.0's public `highlight` takes `(code, options)` or the deprecated
`(lang, code, ignoreIllegals)` and forwards neither a fourth argument nor an
`options.continuation` to the private `_highlight` that reads it. `_top` comes back on the
result and there is no supported way to hand it in. So each stream is joined with newlines,
highlighted in one call, and the resulting HTML is cut back into one string per line, closing
the spans open at each line break and reopening them on the next line. One parse per stream is a
stronger guarantee than a continuation chain, and it uses no deprecated API. The split refuses to
return a line count other than the one it was given, because a shifted line would colour the
wrong text and look like a bug in the diff, not in the highlighter.

The output is sanitised by the same DOMPurify instance the markdown bodies go through, down to
`span` and one `hljs-` class per span: an `afterSanitizeAttributes` hook drops every class that
is not `^hljs-[a-z-]+$`, which also drops highlight.js's tiered second class (`function_`,
`class_`) and its `language-*` sub-language wrappers while keeping their text. A hunk is
highlighted once per grammar and held against the hunk object in a `WeakMap`, so a re-render, a
collapse and a reopen cost nothing and a replaced document is collected with its cache.

**Consequences.** The single file grew by 74 kB, 24 kB gzipped, to 442 kB. Highlighting all
4,500 lines of the largest pull request we have measured takes 220 ms outside a browser, and the
reviewer never pays it at once: a collapsed file has no mounted hunks, so it is not highlighted
until it is opened. Four fifths of that time is DOMPurify rather than highlight.js — 219 ms
against 15 ms over 2,000 lines — which is the price of never handing `dangerouslySetInnerHTML` a
string the sanitiser has not seen, and is paid on the lines highlight.js actually coloured, since
a line with no span at all is handed back as null and rendered as text.

Colour is decoration and never the only carrier: heat stays in the gutter bar and the banner,
and the palette keeps every token at least as dark as the comment grey so it reads on the add and
del washes. `.tf` files are highlighted by the bash grammar, which is a guess that gets comments,
strings and `${…}` interpolation right and HCL's block syntax wrong; a real HCL grammar is not in
the core distribution. Fenced code inside a comment body is still unhighlighted, but the reason
is now only that nothing wired it up — the highlighter is already in the bundle.
