# PR Review Cockpit

A local web app that turns one pull request into a guided review: a GitHub-like unified diff
with a risk heatmap, mechanical changes folded into labelled groups, existing bot and human
comments pinned to their lines, a walkthrough that says where to look first, and a
blast-radius map of what the change touches.

You drive it from Claude Code. You type `cockpit 123`, the session opens the cockpit in your
browser, writes the brief and the reading order into it, and then stays in the terminal to
answer questions about the code while you read.

Nothing leaves your machine except the review you choose to post.

## Install as a Claude Code plugin

Two commands in Claude Code:

```
/plugin marketplace add zalts1/pr-review-cockpit
/plugin install cockpit@pr-review-cockpit
```

The first registers this repository as a plugin marketplace, the second installs the one
plugin in it. That plugin is the whole tool: the skill, the `cockpit` command on your PATH,
and the hook that builds them.

You need:

- **Node 24 or newer** (`.nvmrc` pins it).
- **The GitHub CLI**, logged in: `gh auth login`. The tool posts as you and holds no token of
  its own.

### The first session builds it

A plugin install is source, with no `node_modules` and no `dist`, so a `SessionStart` hook
runs `npm ci` and `npm run build` once. That is ten or twenty seconds on a warm npm cache and
under a minute on a cold one, and it ends in one line:

```
cockpit: built v0.1.0
```

Every session after that one starts with the hook finding the build already there and saying
nothing. It builds again only when an update changes the version.

Nothing it does can stop a session from starting. A missing `gh`, a node older than 24 or a
build that failed is one line saying so, and the whole log is at
`~/.claude/plugins/data/<plugin>/bootstrap.log`. `cockpit doctor` names which of them it was.

Update to a newer version with:

```
/plugin marketplace update pr-review-cockpit
```

### Installing it for a team

Commit this to a repository's `.claude/settings.json`, and everyone who trusts that folder
gets the marketplace and the plugin without typing either command:

```json
{
  "extraKnownMarketplaces": {
    "pr-review-cockpit": {
      "source": {
        "source": "github",
        "repo": "zalts1/pr-review-cockpit"
      }
    }
  },
  "enabledPlugins": {
    "cockpit@pr-review-cockpit": true
  }
}
```

## Install from a checkout

This is the path for working on the cockpit itself: it runs the skill and the command straight
out of your clone, so an edit is live in the next session with no reinstall.

You need Node 24, the GitHub CLI logged in, and Claude Code. Then, from this checkout:

```sh
scripts/install.sh
```

It installs the dependencies, builds every package, puts the `cockpit` command on your PATH,
and links the skill into `~/.claude/skills/cockpit`. It says which method it used for each. It
is safe to run again after you pull.

Check it whenever something looks wrong:

```sh
cockpit doctor
```

```
check            status  detail
node             ok      v24.15.0
gh               ok      ✓ Logged in to github.com account you
build            ok      …/packages/cockpit/dist/index.html
skill            ok      ~/.claude/skills/cockpit → …/skills/cockpit
servers          ok      none running. cockpit ps lists them
config           ok      ~/.config/review-cockpit/config.json is absent, which is fine: it is optional
workspace roots  ok      none configured: a repository with no local clone is cloned into the cache
```

It exits non-zero when a row says `fail`, and every failing row names the command that fixes
it.

## First review

In Claude Code, from inside a clone of the repository you want to review:

```
cockpit 123
```

From anywhere, name the repository or paste the URL:

```
cockpit owner/repo#123
cockpit https://github.com/owner/repo/pull/123
```

Here is what happens, and roughly how long each part takes on a medium pull request:

1. **Resolve and check out** — a second for `gh pr view`, then a git worktree on your own clone
   if one is found. If not, the repository is cloned into the tool's cache, which is slow the
   first time and reused after that.
2. **Stage 1** — the diff, git history, Go structure through tree-sitter, a risk floor per
   hunk, and the pull request's existing comments and checks. A few seconds to a minute,
   depending on the repository.
3. **The cockpit opens** in your browser, on stage 1. The diff, the heatmap, the comments and
   the checks are all there. The summary, the groups and the reading order say they are being
   analysed.
4. **The call graph** finishes in the background and the page picks it up. The Map tab fills
   in.
5. **The judgment pass** — the Claude session reads the pull request and writes the brief, the
   groups, the reading order and the reasons. It appears in the page on its own, about a
   minute in.
6. **You review.** `n` walks the recommended order, `c` drafts a comment on the line under the
   cursor, Submit posts one GitHub review with all of it. Your posted comments come back into
   the page as pinned threads a second later.
7. **You say "done"** and the session runs `cockpit clean`: the server stops and the worktree
   goes away. What you wrote stays.

Ask questions in the terminal at any point — "why is this hunk high risk", "who calls this
function", "does this migration need a backfill". The session has the checkout and the
document, so it answers from the code rather than from the diff.

## Where your files live

Everything the tool writes is under one directory, `~/.cache/review-cockpit`:

```
~/.cache/review-cockpit/<owner>/<repo>/
  repo/                       a clone, only when no local clone was found
  index/                      parsed Go symbols, shared by every review of this repository
  pr-123/
    worktree/                 the repository at the pull request's head
    review.json               the review document: the diff, the risk, the groups, the walk
    compact.md                the pull request as one text file, for the judgment pass
    judgment.json             what the Claude session proposed
    drafts.json               your unsent comments, verdict and review body
    drafts.orphaned.json      drafts a re-analysis could not place in the new diff
    submitted-<ts>.json       one file per review you posted, as it was sent
    server.json               the running server: port, pid, url, when it started, a token
                              that proves the process is ours, and the Claude Code session
                              that asked for it
    log.txt
```

`cockpit clean` removes `worktree/` and stops the server. It keeps everything else, so a
review you posted last week is still readable.

Nothing is written into your own clone but the objects a fetch brings in, one ref under
`refs/review-cockpit/`, and the worktree registration. `clean` removes both of those.

## Housekeeping

Nothing here needs you to remember it. A server stops itself after 30 minutes with no cockpit
connected: it removes its own `server.json` and exits, and a browser tab that was left open
says the server stopped and gives you the `cockpit run` line that brings it back — about a
second, because the document and your drafts are already on disk. When a Claude Code session
ends, a `SessionEnd` hook stops the servers that session started. And every `cockpit run` ends
with a `cockpit gc` pass, which removes the worktree and the `refs/review-cockpit/` ref of any
review with no server running that nobody has come back to for seven days.

| Command | What it does |
|---|---|
| `cockpit ps` | Every running server: pull request, port, pid, age, how long it has had nobody connected, how many cockpits are |
| `cockpit stop <pr>` / `--all` / `--started-by <id>` | Stop servers and leave everything else where it is |
| `cockpit gc [--days <n>] [--dry-run]` | Remove the checkouts of reviews nobody came back to |

`cockpit stop` only signals a process it can show is a cockpit server: one that answers
`/api/health` with the token from its own `server.json`, or, when it answers nothing at all,
one whose command line is a `cockpit … serve`. A pid on its own is not enough, because pids
are reused. Anything else alive is reported and left running.

`cockpit gc` removes the checkout and nothing else. `review.json`, `drafts.json`,
`judgment.json` and every `submitted-<ts>.json` stay, because a checkout is a commit GitHub
still has and those files are not. It never runs `git worktree prune`, so a worktree another
tool registered in the same clone is safe. `--dry-run` prints what it would remove.

## Uninstall

```sh
scripts/uninstall.sh
```

It unlinks the `cockpit` command and the skill, and leaves the cache alone. It prints the one
command that deletes the cache, if that is what you want.

## Configuration

Both files are optional.

`~/.config/review-cockpit/config.json` tells the tool where your clones are, so it can take a
worktree instead of cloning:

```json
{ "workspaceRoots": ["/Users/me/workspace"] }
```

Each root is searched one level deep for a clone whose origin matches the pull request's
repository.

`.review-cockpit.json`, at the root of the repository under review, adds to the built-in
lists:

```json
{
  "sensitivePaths": ["internal/tenancy/**"],
  "generatedPatterns": ["api/gen/**"],
  "hazardPatterns": { "go": ["unsafeQuery"] }
}
```

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

## The commands underneath

The skill runs `cockpit run`, which does the first four steps above in one go. Every step is
also its own command, which is how you debug one.

| Command | What it does |
|---|---|
| `cockpit run <pr> [--reuse-server] [--port <n>] [--no-open] [--skip-graph] [--idle-minutes <n>] [--session <id>] [--cwd <dir>]` | Prepare, stage 1, serve, open the browser, then the graph, then a `gc` pass. Last stdout line is JSON: `{url, prDir, compact, judgmentOut, headSha}`. |
| `cockpit prepare <pr>` | Resolve and check out only. Prints the checkout as JSON. |
| `cockpit analyze <pr> [--expect-judgment] [--no-fold-generated] [--skip-graph]` | Stage 1 and stage 3 into `review.json`, and `compact.md` beside it. |
| `cockpit compact <pr>` | Rewrite `compact.md` from the document on its own. |
| `cockpit judge-prompt <pr>` | Print the whole judgment prompt to stdout. |
| `cockpit judge-merge <pr> [--judgment <file>]` | Validate `judgment.json`, merge it, write the document and the log. |
| `cockpit mark-failed <pr> --stage 2 --message <text>` | Mark the judgment sections failed with a message the cockpit shows. |
| `cockpit serve <pr> [--port <n>] [--open] [--idle-minutes <n>] [--session <id>]` | Serve the cockpit, the document and the drafts on 127.0.0.1, or print the URL of the server already serving them. |
| `cockpit stop <pr>` / `--all` / `--started-by <id>` | Stop running servers and nothing else. |
| `cockpit clean <pr>` | Stop the server, remove the worktree and the ref, keep the document and the drafts. |
| `cockpit gc [--days <n>] [--dry-run]` | Remove the checkout of every review with no server and a document older than `--days`, which defaults to 7. |
| `cockpit ps` | List the running servers. |
| `cockpit doctor` | Check the installation and print the table above. |
| `cockpit validate <file> [--as document\|judgment\|drafts]` | Schema and referential rules. |
| `cockpit merge <document> <judgment> [--out <file>]` | Apply a judgment file to a document. |

`<pr>` is `123`, `owner/repo#123`, or a pull request URL. A bare number is read against the
GitHub remote of the repository holding the working directory.

`run` prints one progress line per stage with its elapsed time to stderr, and the JSON on the
last line of stdout. Running it again on a pull request whose head has not moved skips the
analysis and serves the cached document. Running it after new commits re-analyses, keeps every
draft whose line survived, and sets the rest aside where you can see them. `--reuse-server`
keeps a server that is already running and leaves its browser tab alone.

`--expect-judgment` says a judgment pass will follow: without it the stage 2 sections are
marked `not-attached` and the cockpit shows "Not analyzed" instead of "Analyzing…".
`--no-fold-generated` leaves generated files unfolded and scored, and still records the rule
that matched them. `--skip-graph` leaves stage 3 `pending`. `--idle-minutes` changes the window
the server stops itself after and `0` turns it off; `--session` records a session id in
`server.json`, and is taken from `CLAUDE_CODE_SESSION_ID` when the flag is absent.

### The local API

| Route | What it does |
|---|---|
| `GET /` | The built cockpit, one self-contained HTML file |
| `GET /api/document` | `review.json` as it stands |
| `GET /api/events` | Server-sent events: `{"type":"document"}` on every rewrite, and one `{"type":"shutdown","reason":"idle"}` before the server stops itself |
| `GET /api/drafts` | The drafts file, or an empty one, plus `orphaned` when a re-attach set drafts aside |
| `PUT /api/drafts` | Replaces the drafts file after `validateDrafts`, stamps `updatedAt`, answers with what it stored |
| `POST /api/submit` | `{verdict, summaryBody}`: posts one review from the stored drafts |
| `POST /api/refresh` | Re-reads the comments and the checks from GitHub and rewrites the document |
| `GET /api/health` | Port, pid, whether a document exists, uptime, the `server.json` token, the number of attached cockpits and how long it has had none |

`POST /api/submit` answers `{url, id, comments, submitted}` on success, `409 {code:
"head_moved", expected, actual}` when the pull request has new commits, `422 {code: "own_pr"}`
when GitHub refuses a verdict on your own pull request, and `502 {code: "gh_failed", message,
exitCode}` with the `gh` error otherwise. Only the first of those touches the drafts: it moves
them to `submitted-<timestamp>.json` and leaves an empty file behind, and then refetches the
pull request's comments so what you posted appears as pinned threads.

## How it works

The design lives in `docs/`. Start with `docs/01-product-brief.md`, then
`docs/02-architecture.md`; `docs/DECISIONS.md` is why each piece is the way it is.

One JSON document is the only contract. `packages/analyzer` writes the deterministic part of
it: the diff parsed into files and hunks, git history, Go structure through tree-sitter, a risk
floor per hunk, the existing comments and checks, and the call graph. The Claude session adds
the judgment — groups, reading order, reasons, the brief — as a separate file that
`packages/schema` validates and merges, clamping every proposal against the deterministic
floor. `packages/server` serves the document and pushes every rewrite of it to the browser.
`packages/cockpit` renders it and computes nothing of its own.

```
packages/schema/      the contract: JSON Schema, generated types, validator, judgment merge
packages/analyzer/    diff, git history, tree-sitter, risk, the Go call graph, review.json
packages/server/      node:http on 127.0.0.1: the cockpit, the document, the drafts, submit
packages/cli/         the cockpit command
packages/cockpit/     the React app: renders the review document and nothing else
skills/cockpit/       SKILL.md, the procedure the Claude session follows, and its prompt
.claude-plugin/       plugin.json and marketplace.json: what /plugin install reads
bin/cockpit           the wrapper that puts the built CLI on the Bash tool's PATH
hooks/hooks.json      the SessionStart hook, and scripts/plugin-bootstrap.sh behind it
fixtures/             hand-authored review documents, their generator and their checker
docs/                 the design: brief, architecture, schema, UX, risk model, milestones
```

**This repository is at milestone M7**, the last of v1 (`docs/06-milestones.md`).
`POST /api/ask`, the cockpit-to-agent channel, still answers 501: questions go to the terminal.
Re-review after new commits is M8.

## Working on it

```sh
npm install
npm run build        # schema, analyzer, server, cli, cockpit
npm test
npm run typecheck
```

The cockpit renders hand-authored fixtures with no server and no GitHub, which is how to work
on the UI:

```sh
npm run dev --workspace @review-cockpit/cockpit
```

- <http://localhost:5173/?fixture=pr-fake-1> — every stage ready
- <http://localhost:5173/?fixture=pr-fake-1.stage1> — stage 2 and 3 pending, a judgment pass running
- <http://localhost:5173/?fixture=pr-fake-1.notattached> — stage 2 and 3 pending with nothing attached
- <http://localhost:5173/?fixture=pr-fake-1.graphfail> — the call graph failed
- <http://localhost:5173/?fixture=pr-fake-1.stage2fail> — the judgment pass failed
- <http://localhost:5173/?fixture=pr-fake-empty> — a merge-only PR with no textual changes

`fixtures/pr-fake-1.json` is a review document for a 20-file, 1,752-line Go pull request in a
service that manages tenant records: a protobuf change with its generated `*.pb.go`, an sqlc
query change with its generated code, a `NOT NULL` migration, one high-risk core change with a
pinned bot comment, a mechanical rename over nine files, an import-only and a whitespace-only
hunk, tests, and a 43-node call graph. Its comments cover what the ingestion produces: a
two-comment thread, a resolved thread, an outdated comment, two comments with no line to pin
them to, a bot summary inside the body, and checks in six states.

The JSON is generated from authored diff bodies, so every line number follows from the line
arrays:

```sh
npm run fixtures:build     # rewrite the fixtures from fixtures/generate.ts
npm run fixtures:check     # assert line numbers, id references, group and path rules
```

`fixtures/check.ts` wraps `validateDocument`, so the fixtures and the tool are checked by the
same rules. `docs/03-review-document-schema.md` lists them.

### The judgment pass, by hand

Every step the skill takes is a command, so the pass can be run without Claude Code:

```sh
cockpit analyze owner/repo#123 --expect-judgment
cockpit serve   owner/repo#123 --open
cockpit judge-prompt owner/repo#123      # read the prompt, write judgment.json yourself
cockpit judge-merge  owner/repo#123
```

The prompt lives in `skills/cockpit/judgment-prompt.md` with `{{placeholders}}` the CLI fills,
so it is reviewable as text rather than buried in a string. `judge-merge` prints every proposal
it dropped or clamped and appends the same lines to `log.txt`. A rejected judgment is kept as
`judgment.rejected.json`, the first five errors are printed in plain words, nothing is written,
and the exit code is non-zero. `skills/cockpit/SKILL.md` holds the retry: fix once, try once
more, then `cockpit mark-failed`.

### Validate and merge

```sh
cockpit validate fixtures/pr-fake-1.json
cockpit validate fixtures/judgment/pr-fake-1.json
cockpit merge fixtures/pr-fake-1.stage1.json fixtures/judgment/pr-fake-1.json --out /tmp/review.json
```

`validate` runs the JSON Schema and then the referential rules from
`docs/03-review-document-schema.md`, names the JSON path of anything wrong, and exits non-zero
on an error. Unknown fields are warnings, so a document from a newer minor version still
passes. `merge` clamps risk to the deterministic floor, assigns group ids, renumbers the walk,
appends what the judgment left out, caps the reasons and recomputes the counts, printing one
log line for everything it dropped or changed.
