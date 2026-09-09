# 06 — Milestones

Status: proposed. Each milestone ends with a demo and a go from the user before the next one starts.

Order matters. M1 tests the thesis before anything expensive is built. M2 turns the fake document into a contract. M3 to M6 fill the contract from the real world, one producer at a time. M7 wires it together behind `review <pr>`.

## M1 — Cockpit on fake data

**Goal.** Find out whether the cockpit feels lighter than a text summary next to the GitHub diff, before any analyzer exists.

**Delivers.**
- `packages/cockpit`: React app built with Vite into a single `dist/index.html`.
- `fixtures/pr-fake-1.json`: a hand-written review document for a realistic PR modelled on the target repositories. About 20 files, roughly 1,800 lines, with a generated protobuf file, a mechanical rename across 9 files, a migration, one high-risk core change with a Bugbot comment, and tests. All stages `ready`.
- `fixtures/pr-fake-1.stage1.json`: the same PR with stage 2 and 3 `pending`, to exercise loading states.
- Every screen in `04-cockpit-ux.md`: file tree with heat dots, summary card, group headers, unified diff with heat bars and reason banners, pinned comments, draft editor with multi-line selection, autopilot bar with progress, Map tab with click-to-hunk, Submit modal with the dry-run list. Submit does not post anywhere in M1.
- A `fixtures` dev mode that serves either fixture from a static file server.

**Verify.** The user opens both fixtures, walks the fake PR with Next, drafts two comments, opens the Map, and checks the loading states. The user answers one question: would I rather review this way than read the GitHub diff with a summary beside it?

**Done when.** The user says yes, or names what would have to change for yes. A no ends the project or sends us back to `04-cockpit-ux.md`.

**Not in M1.** Real data, server, persistence, keyboard shortcuts beyond `n`, `p`, `h`.

## M2 — Schema package and validator

**Goal.** The document becomes a checked contract.

**Delivers.**
- `packages/schema`: JSON Schema for the review document and the judgment file, TypeScript types generated from it, a validator that runs the schema and the referential and merge rules from `03-review-document-schema.md`, and the `merge(document, judgment)` function that applies the clamp, group, path and count rules and logs what it dropped.
- Tests: every merge rule has a passing and a failing case. Both M1 fixtures validate.
- `cockpit validate <file>` as the first CLI subcommand, in `packages/cli`.

**Verify.** Run the validator on the fixtures. Hand-break a fixture in three ways and see three clear errors.

**Done when.** Tests pass and the cockpit refuses to render a document with a wrong major version.

## M3 — Deterministic analyzer on a real PR

**Goal.** A real PR from a target repository produces a stage 1 document the cockpit renders.

**Delivers.**
- `packages/analyzer`: PR resolution through `gh`, worktree or clone checkout, unified diff parsing into files and hunks, generated-file detection, the single-pass git signals, tree-sitter Go parsing for enclosing symbols, complexity and the `git grep` fan-in estimate, hunk-level features, the score, the floor rules, stage 1 groups for import, whitespace and generated hunks.
- `cockpit prepare <pr>` and `cockpit analyze <pr>` subcommands writing `review.json` under the cache directory described in `02-architecture.md`.
- `packages/server`, first version: serves the cockpit and the document, watches the file, pushes changes over server-sent events. `cockpit serve <pr>`.
- Stage 3 in its first form: full call graph for Go on the checked-out repository, written after stage 1, with the per-repository index cache.

**Verify.** Run on a recent merged PR from the main backend repository with 15 or more files, and on one from the frontend repository. Compare the heat against the user's own read of the same PR. Measure time from command to open cockpit, and time to stage 3.

**Done when.** The cockpit opens within about a minute for the backend PR using a local worktree, the heat is defensible to the user hunk by hunk, and stage 3 arrives without blocking anything.

## M4 — Judgment pass

**Goal.** Groups, order, reasons and raises from the LLM, merged safely.

**Delivers.**
- `compact.md` generation in the analyzer.
- `skill/SKILL.md` with the judgment prompt: the schema for the judgment file embedded, the floor rules stated, instructions to read the compact view and open files from the checkout only as needed.
- `cockpit judge-merge <pr>`: validate, merge, write stage 2, with the one-retry loop returning errors to the session.
- Logging of every dropped or clamped proposal.

**Verify.** Run the pass on the two M3 PRs. Inspect the groups for wrong merges, the path for missing hunks, the reasons for vagueness. Break the judgment file by hand and confirm the fallback to deterministic-only with a visible note.

**Done when.** On both PRs the walkthrough order reads as sensible to the user, no skim group contains a change the user would have wanted to read, and the fallback path works.

## M5 — Comment and check ingestion

**Goal.** Existing signals on the PR appear in the cockpit where they belong.

**Delivers.**
- Review comments through `gh api`, mapped to file, line, side and hunk id. Bugbot severity parsed from its comment format when present. Outdated comments listed separately.
- Check runs through `gh api`, rendered as the header strip.
- Both included in stage 1.

**Verify.** A PR with Bugbot comments and a failing check. Every comment lands on the right line. The failing check is red and its link opens.

**Done when.** No comment is misplaced on three tested PRs.

## M6 — Write-back

**Goal.** Drafts become a real GitHub review, on the right lines, or nothing is posted.

**Delivers.**
- Server API for drafts: save with debounce, restore on reload, browser-storage fallback.
- Submit modal wired to `POST /api/submit`: head-SHA check against GitHub, one `gh api` call creating the review with all comments, result link or error text shown.
- Refusal path when the head moved, with drafts kept.
- Re-attach of drafts after a re-run when their file and line still exist.

**Verify.** On a throwaway PR in a scratch repository first: post a comment review, a request-changes review with a multi-line comment, and an approve. Then push a new commit to the PR and confirm submit is refused. Only then try on a real PR of the user's choosing.

**Done when.** Every posted comment appears on GitHub on the exact line shown in the dry-run list, across all three verdicts.

## M7 — The `review <pr>` skill

**Goal.** One command from Claude Code to a fully loaded cockpit, and clean teardown.

**Delivers.**
- `skill/SKILL.md` completed: resolve the PR argument, run prepare and analyze, open the browser, run the judgment pass, run judge-merge, stay resident for questions, run `cockpit clean` on "done".
- Install step: one script that builds the cockpit, links the CLI, and registers the skill.
- `cockpit clean <pr>`: stop the server, remove the worktree or leave the clone, keep the document and drafts.
- Progress output in the terminal matching the stages.
- Failure behaviours from `02-architecture.md`: `gh` not authenticated, invalid judgment twice, graph failure, server restart with a cached document.
- README with install and first-use instructions.

**Verify.** From a fresh terminal in a target repository clone, `review <pr>` on a live PR the user is actually reviewing that day. Time it. Ask questions in the terminal. Post the review. Run "done".

**Done when.** The user reviews one real PR end to end without touching anything but the command and the browser. This starts the two-week evaluation from `01-product-brief.md`.

## After M7

Not planned in detail. Candidates, in the order they were raised: cockpit-to-agent questions through the wake loop, headless judgment through `claude -p`, thread replies, split diff view, TypeScript call graph, calibration command from cached documents, per-vendor parsing of Wiz and CodeQL findings, plugin marketplace listing.

## Working rules for every milestone

- Start by reading the relevant design doc, and update it in the same change when the implementation disagrees with it.
- Add a decision log entry for every choice that was not already in `DECISIONS.md`.
- Commit per logical step. Tests live next to the code they test.
- End with a demo the user can run with one command, and a short written list of what works and what does not.
