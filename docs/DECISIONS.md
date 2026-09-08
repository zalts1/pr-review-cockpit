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
