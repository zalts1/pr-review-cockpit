# 03 — Review document schema

Status: living spec, implemented in `packages/schema`. The contract described in `02-architecture.md`.

## Purpose

One JSON file per PR describes everything the cockpit shows. The analyzer writes it. The judgment pass amends it. The server serves it. The cockpit renders it and never computes risk, order or grouping on its own. Because the cockpit is a plain renderer, an error in the LLM's output can only ever show up as a wrong label, never as a crash or a wrong diff.

The document has two producers with different trust levels. Stage 1 comes from code and git and is trusted. Stage 2 comes from the LLM and is validated and clamped before it is merged. The schema keeps the two apart so the merge rules are mechanical.

## Conventions

- All identifiers are strings and stable for the life of one review. A hunk keeps its id across stages and across a server restart.
- Line numbers are 1-based and use GitHub's terms: `oldNo` for the base side, `newNo` for the head side. A comment's `side` is `LEFT` or `RIGHT`, exactly as GitHub's review API expects.
- Times are ISO 8601 strings in UTC.
- Every section that can arrive late has an entry in `status`. The cockpit reads `status` first and renders placeholders for anything not `ready`.
- Unknown fields are allowed everywhere. The validator warns about them but does not reject the document.

## Top level

```jsonc
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-09-08T12:34:56Z",
  "tool": { "name": "review-cockpit", "version": "0.1.0" },

  "pr":        { /* PrInfo */ },
  "checkout":  { /* CheckoutInfo */ },
  "status":    { /* SectionStatus per section, see below */ },

  "files":        [ /* File[]                stage 1 */ ],
  "comments":     [ /* Comment[]             stage 1 */ ],
  "conversation": [ /* ConversationComment[] stage 1, optional */ ],
  "checks":       [ /* Check[]               stage 1 */ ],
  "botSummaries": [ /* BotSummary[]          stage 1, optional */ ],

  "groups":    [ /* Group[]    stage 2 */ ],
  "path":      [ /* PathStep[] stage 2 */ ],
  "summary":   { /* Summary    stage 2 */ },

  "graph":     { /* Graph      stage 3 */ }
}
```

Stage 2 and 3 sections are present from the first write, as empty arrays or objects, so the cockpit never has to check for a missing key. It checks `status` instead. The one exception is `summary.counts`, which stage 1 can compute and writes from the first version, so the card can show the numbers before any judgment pass has run.

### `status`

```jsonc
"status": {
  "files":    { "state": "ready",   "updatedAt": "..." },
  "comments": { "state": "ready",   "updatedAt": "..." },
  "checks":   { "state": "ready",   "updatedAt": "..." },
  "groups":   { "state": "pending", "updatedAt": "...", "message": "not-attached" },
  "path":     { "state": "pending", "updatedAt": "...", "message": "not-attached" },
  "summary":  { "state": "pending", "updatedAt": "...", "message": "not-attached" },
  "graph":    { "state": "failed",  "updatedAt": "...", "message": "tree-sitter timed out after 120s" }
}
```

`state` is one of `pending`, `ready`, `failed`. `message` is required when `state` is `failed` and is shown to the reviewer as written.

On a **pending** stage 2 section the message says whether anything is running. `"not-attached"` means no judgment pass is attached to this session, and the cockpit writes "Not analyzed"; no message means one is running, and the cockpit writes "Analyzing…". `cockpit analyze` writes `"not-attached"` unless it is given `--expect-judgment`. This is a message convention rather than a fourth state, so every rule written against `pending`, `ready` and `failed` still holds.

### `pr`

```jsonc
"pr": {
  "owner": "northwind-labs",
  "repo": "tenant-platform",
  "number": 1234,
  "url": "https://github.com/northwind-labs/tenant-platform/pull/1234",
  "title": "Add tenant record API",
  "body": "Markdown body of the PR description",
  "author": "jdoe",
  "draft": false,
  "labels": ["backend", "needs-migration"],
  "base": { "ref": "main", "sha": "a1b2c3..." },
  "head": { "ref": "TP-329-tenant-record-api", "sha": "d4e5f6..." },
  "additions": 812,
  "deletions": 140,
  "changedFiles": 19
}
```

`head.sha` is the commit every posted comment is bound to. If GitHub reports a different head at submit time, the server refuses to post.

### `checkout`

```jsonc
"checkout": {
  "mode": "worktree",                       // "worktree" | "clone"
  "path": "/Users/me/.cache/review-cockpit/northwind-labs/tenant-platform/pr-1234/worktree",
  "sourceRepo": "/Users/me/workspace/tenant-platform"   // absent for "clone"
}
```

## Stage 1: `files`

One entry per changed file, in the order GitHub lists them. The diff lives here, so the cockpit needs no other source for the code it shows.

```jsonc
{
  "id": "f3",
  "path": "api/service/tenant/record.go",
  "previousPath": null,                      // set when status is "renamed"
  "status": "modified",                      // added | modified | deleted | renamed
  "language": "go",                          // go | typescript | tsx | python | proto | yaml | json | markdown | other
  "binary": false,
  "generated": { "is": false, "rule": null },   // e.g. { "is": true, "rule": "**/*.pb.go" }
  "additions": 64,
  "deletions": 12,
  "signals": { /* FileSignals */ },
  "hunks": [ /* Hunk[] */ ]
}
```

Generated files still carry their hunks, so the reviewer can expand them. The cockpit collapses them by default.

### `FileSignals`

The raw deterministic measurements for the file. The risk model doc says how each is computed and weighted. They are kept in the document so the cockpit can show them on hover and so the LLM can see them.

```jsonc
"signals": {
  "churnCommits90d": 14,           // commits touching this file in the last 90 days on the base branch
  "bugfixCommits": 5,              // of those, commits whose message matches fix|bug|hotfix|revert|regression
  "authorPriorCommits": 0,         // commits by the PR author to this file before this PR
  "fanIn": 23,                     // functions elsewhere that call a function changed in this file
  "fanOut": 7,                     // functions the changed functions call
  "fanSource": "grep",             // grep | graph | null   stage 1 estimates with git grep on the changed symbols, stage 3 replaces it with parsed call-graph counts
  "complexityBefore": 18,          // sum of cyclomatic complexity of changed functions, base side
  "complexityAfter": 27,           // same, head side
  "sensitivePath": { "match": true, "rule": "**/auth/**" },   // or { "match": false, "rule": null }
  "testFile": false,               // matches the language's test naming convention
  "coverageDelta": null            // percentage points, only when a coverage report is available
}
```

Every numeric field may be `null` when the signal could not be computed, for example fan-in on a language without call-graph support. `null` means unknown and is never treated as zero. `fanSource` is `null` when both `fanIn` and `fanOut` are `null`: with nothing counted there is no source to name. The validator rejects a document that names a source for counts it does not have.

### `Hunk`

```jsonc
{
  "id": "f3.h2",
  "oldStart": 88, "oldLines": 14,
  "newStart": 91, "newLines": 31,
  "header": "func (s *Service) UpdateRecord(ctx context.Context, req *pb.UpdateRecordRequest) (*pb.Record, error) {",
  "symbols": ["Service.UpdateRecord"],       // enclosing functions on the head side, from tree-sitter
  "kind": "code",                            // code | import | test | comment-only | whitespace-only
  "lines": [
    { "type": "context", "oldNo": 88, "newNo": 91, "text": "\tif req.GetId() == \"\" {" },
    { "type": "del",     "oldNo": 89, "newNo": null, "text": "\t\treturn nil, ErrMissingID" },
    { "type": "add",     "oldNo": null, "newNo": 92, "text": "\t\treturn nil, status.Error(codes.InvalidArgument, \"id is required\")" }
  ],
  "risk": { /* Risk */ }
}
```

`id` is `<fileId>.h<index>`, where index counts hunks within the file from 1. `header` is the nearest enclosing function line, as GitHub shows it, or the empty string. `kind` is decided deterministically and lets the cockpit collapse import shuffles and whitespace changes without waiting for stage 2.

### `Risk`

Risk is per hunk. It has a deterministic floor set in stage 1 and a final level that stage 2 may raise but not lower below the floor.

```jsonc
"risk": {
  "floor": "high",                 // low | medium | high   set in stage 1, never changes
  "level": "high",                 // low | medium | high   final, equals floor until stage 2 runs
  "score": 0.82,                   // 0..1 deterministic score behind the floor
  "mode": "scrutinize",            // skim | scrutinize   derived: high or medium => scrutinize
  "factors": [                     // why the floor is what it is, for hover
    { "signal": "sensitivePath",   "contribution": 0.30, "detail": "matches **/auth/**" },
    { "signal": "fanIn",           "contribution": 0.22, "detail": "23 callers" },
    { "signal": "bugfixCommits",   "contribution": 0.18, "detail": "5 fix commits in 90 days" }
  ],
  "reason": null,                  // plain-language sentence from stage 2, or null
  "adjustedBy": null               // null | { "from": "medium", "to": "high", "why": "..." } when stage 2 raised it
}
```

The clamp rule, applied by the CLI at merge time: if stage 2 proposes a level lower than `floor`, the proposal is dropped and recorded in the log. If it proposes a higher level, `level` and `adjustedBy` are updated.

## Stage 1: `comments`

Existing review comments on the PR, from bots and from people, pinned to the diff. Fetched with `gh api repos/{owner}/{repo}/pulls/{n}/comments --paginate`.

```jsonc
{
  "id": "c1990001",               // "c" and GitHub's own comment id
  "source": { "kind": "bot", "name": "Cursor Bugbot" },     // kind: bot | human
  "author": "cursor[bot]",
  "path": "api/service/tenant/record.go",
  "line": 92,
  "side": "RIGHT",
  "hunkId": "f3.h2",              // null when the comment is on a line outside the current diff
  "threadId": "PRRT_kwDO…",       // the review thread; replies carry the same one
  "body": "Markdown body",
  "url": "https://github.com/.../pull/1234#discussion_r...",
  "createdAt": "2026-09-08T10:00:00Z",
  "resolved": false,
  "severity": "medium"            // low | medium | high | null   parsed from the bot's own body when it names a level, else null
}
```

`hunkId` is the join key the cockpit uses to place a pin. A comment on a line that no longer exists in the diff has `hunkId: null` and is listed in a separate "outdated" area.

How each field is filled:

- `source.kind` is `bot` when the login ends in `[bot]` or GitHub types the user as a bot. `source.name` is a friendly name for the bots we know — `cursor[bot]` is "Cursor Bugbot", `github-actions[bot]` is "GitHub Actions" — and the login for everyone else, bot or person.
- `line` is GitHub's `line`, or `original_line` when GitHub reports no current line.
- `hunkId` is found by looking the line up in the parsed diff on the given side. A comment GitHub reports with no current line, and every comment on a thread GitHub marks outdated, is left unplaced: `original_line` is a line number from the commit the comment was written against, so placing by it would pin the comment to whatever code holds that number now (ADR-38).
- `resolved` and `threadId` come from one GraphQL query for `pullRequest.reviewThreads`, joined to the comments by comment id. Resolution belongs to the thread, not the comment, and this is the only API that reports it. With the query unavailable, `threadId` falls back to the reply chain (`in_reply_to_id`, else the comment's own id) and nothing reads as resolved.
- `severity` is parsed from a bot's body when it names a level: on a line of its own ("**Medium Severity**"), after a label ("**Severity:** High"), or inside a GitHub alert ("[!WARNING] High Risk"). A person's comment has no severity.

A reply is a comment of its own with the same `path` and `line` as the comment it answers. The cockpit groups a thread into one chip and counts the replies on it; nothing in the document nests them.

## Stage 1: `conversation`

Comments with no line to pin them to. Two kinds land here: top-level comments on the PR conversation, from `gh api repos/{owner}/{repo}/issues/{n}/comments --paginate`, and review comments GitHub reports against a whole file rather than a line.

```jsonc
{
  "id": "ic4001",                 // "ic" and GitHub's own comment id
  "source": { "kind": "human", "name": "danat" },
  "author": "danat",
  "path": null,                   // the file, for a file-level review comment; null for a top-level one
  "line": null,
  "side": null,
  "hunkId": null,
  "body": "Markdown body",
  "url": "https://github.com/.../pull/1234#issuecomment-4001",
  "createdAt": "2026-09-08T09:14:00Z",
  "resolved": false,
  "severity": null
}
```

`line`, `side` and `hunkId` are null here and nowhere else: a `Comment` always has a line, so the two shapes stay apart and the outdated area keeps meaning "a line comment we could not place" (ADR-37). The cockpit shows these in a disclosure at the foot of the rail, not in the diff.

## Stage 1: `checks`

From `gh api repos/{owner}/{repo}/commits/{headSha}/check-runs --paginate` plus `gh api repos/{owner}/{repo}/commits/{headSha}/status` for the legacy commit statuses.

```jsonc
{
  "name": "Wiz",
  "app": "wiz-io",                // the app slug of a check run, the context of a legacy status
  "status": "success",            // success | failure | pending | neutral | skipped | cancelled
  "url": "https://github.com/.../checks/...",
  "completedAt": "2026-09-08T10:05:00Z"
}
```

Displayed as a strip. Never pinned to a line in v1.

`status` is normalised: a run that has not completed is `pending` whatever its conclusion field says; `timed_out`, `action_required` and `startup_failure` are `failure`; `stale` is `cancelled`; a conclusion we do not know is `neutral`; a legacy `error` is `failure`. `url` is `details_url`, then `html_url` or `target_url`, then the PR itself. One entry per name, the latest by completion time: a re-run leaves both attempts on the commit and the older one is not what the reviewer is looking at.

## Stage 1: `botSummaries`

A review summary a bot wrote into the PR body, lifted out of it. Cursor Bugbot wraps one in `<!-- CURSOR_SUMMARY -->` markers with a risk level line and an overview.

```jsonc
{
  "source": { "kind": "bot", "name": "Cursor Bugbot" },
  "riskLevel": "medium",          // low | medium | high | null when the bot named no level
  "body": "<the overview, markdown>",
  "url": "https://github.com/northwind-labs/tenant-platform/pull/1234"
}
```

`pr.body` still holds the block, because the document reports the PR as it is; the cockpit drops it from the rendered description instead, so the summary is on screen once (ADR-40). The overview is the block without its scaffolding: the blockquote the alert is written as, the alert marker, the level line the pill already says, and the "Reviewed by" footer the pill's link replaces. A block with an opening marker and no closing one is left alone, because its end is unknown.

## Stage 2: `groups`

A group is a set of hunks the reviewer should treat as one thing. Stage 1 may create groups of kind `generated`, `import`, `whitespace` from deterministic rules. Stage 2 adds the semantic ones.

```jsonc
{
  "id": "g2",
  "kind": "mechanical-rename",    // generated | import | whitespace | mechanical-rename | formatting | test-update | semantic
  "title": "Rename TenantRecord to TenantProfile",
  "description": "Same identifier replaced across 9 files. No logic change.",
  "hunkIds": ["f1.h1", "f1.h2", "f4.h1", "f5.h1", "f5.h2", "f7.h1"],
  "mode": "skim",                 // skim | scrutinize   reading depth
  "collapsedByDefault": true,     // the only field that controls expansion
  "producedBy": "stage2"          // stage1 | stage2
}
```

`mode` and `collapsedByDefault` answer two different questions. `mode` says how closely to read the group once it is open. `collapsedByDefault` says whether it starts open. A renderer expands a group when, and only when, `collapsedByDefault` is `false`; it never infers expansion from `mode`.

Rules enforced at merge:

- A hunk belongs to at most one group. A second assignment is rejected with a validation error.
- A group with `mode: "skim"` may not contain a hunk whose `risk.floor` is `high`. The CLI removes such hunks from the group and logs it.
- A group with `mode: "scrutinize"` must have `collapsedByDefault: false`, because folding a group the reviewer is told to read closely is a contradiction. The CLI expands such a group and logs it; the validator reports the combination as an error.
- A group produced by stage 1 may not be removed by stage 2.
- A group left with no hunks after those rules is dropped and logged.

## Stage 2: `path`

The recommended walk order. Every hunk that is not in a group of kind `generated` is covered exactly once, either directly as a `hunk` step or through the group that holds it. A group is one step, wherever it appears. Groups of kind `generated` are folded, are not part of the walk, and may be left out of `path` entirely; a hunk inside one is never walked on its own.

```jsonc
[
  { "step": 1, "ref": { "kind": "hunk",  "id": "f2.h1" }, "phase": "models",    "note": "New Record struct and validation rules." },
  { "step": 2, "ref": { "kind": "hunk",  "id": "f3.h2" }, "phase": "core",      "note": "UpdateRecord now validates id and returns gRPC status." },
  { "step": 3, "ref": { "kind": "group", "id": "g2" },    "phase": "callsites", "note": "Mechanical rename, 9 files." },
  { "step": 4, "ref": { "kind": "hunk",  "id": "f9.h1" }, "phase": "tests",     "note": null }
]
```

`phase` is one of `models`, `core`, `callsites`, `tests`, `config`, `other`. The cockpit uses it for the progress line, for example "core 2/4 · 1 high-risk remaining".

Merge rules: unknown ids and repeated steps are dropped and logged. A step that names a hunk which is inside a group becomes a step for that group, at that position, keeping the note; if the group is already in the walk, the step is dropped. Anything left uncovered, hunk or non-generated group, is appended at the end under `phase: "other"` and logged.

## Stage 2: `summary`

The shape follows the reviewer brief the team already uses (the `pr-summary` skill): understanding first, coverage never. All string fields are markdown.

```jsonc
"summary": {
  "tldr": "Lets a detection carry the tenants that asked for it, so it can be credited back to them.",
  "whereItFits": [
    "Detection management service, store and gRPC handler.",
    "Triggered by the customer-attribution ticket; user-facing only through the derived `is_custom_for_tenant` flag."
  ],
  "flow": {
    "before": "content sync → UpsertDetections → detections table",
    "after":  "content sync → UpsertDetections → detections table + requested_by_tenants junction (full replace per upsert)"
  },
  "example": "An upsert with `requested_by_tenant_ids: []` clears the attribution but keeps the detection row.",
  "watchFor": [
    "Migration adds a NOT NULL column with no default.",
    "The column is `requested_by_tenant_id`, not `tenant_id`, to stay clear of the tenant-scoping plugin."
  ],
  "counts": { "hunks": 23, "highRisk": 3, "skimmable": 12 }
}
```

The review path table in the cockpit is derived from `path`, not stored here, so the two can never disagree. `counts` is written by stage 1 and recomputed by the CLI at merge; it is the one field of `summary` that is always present. `flow.before` and `flow.after` are short single lines; `example` and the bullets are markdown. Adopted after the first real PR made the earlier one-liner-plus-focus shape look thin next to the team's existing brief.

## Stage 3: `graph`

The blast-radius map. Nodes are functions and files touched by the change plus their one-hop neighbors. Edges are calls and imports.

```jsonc
"graph": {
  "nodes": [
    { "id": "n1", "kind": "function", "label": "Service.UpdateRecord", "file": "api/service/tenant/record.go", "changed": true,  "hunkIds": ["f3.h2"] },
    { "id": "n2", "kind": "function", "label": "Handler.PatchTenant",  "file": "api/http/tenant.go",           "changed": false, "hunkIds": [] },
    { "id": "n3", "kind": "package",  "label": "api/service/tenant",   "file": null,                           "changed": true,  "hunkIds": ["f2.h1", "f3.h1", "f3.h2"],
      "count": { "changedFunctions": 3, "foldedNeighbours": 155 } }
  ],
  "edges": [
    { "from": "n2", "to": "n1", "kind": "calls" }
  ],
  "truncated": true                // true when some package folded neighbours away
}
```

Package nodes carry `"count": { "changedFunctions": 3, "foldedNeighbours": 155 }` so the cockpit's package-level view is complete even when function-level neighbours were folded into their package instead of emitted. Function nodes are emitted for every changed function and for at most 40 neighbours per changed package; the rest are counted, not dropped. Edges between function nodes carry `"kind": "calls"`; the cockpit aggregates them into package edges with a `weight`. Revised after the first real PR hit the 300-node cap.

`kind` for nodes is `function`, `file` or `package`. `hunkIds` is the click target: clicking a node scrolls to its first hunk. Unchanged neighbors have an empty list and are drawn muted. `count` is required on a package node and absent on every other kind.

The fold, per changed package: rank the one-hop neighbours callers first, then callees, each by fan-in, emit the first 40 as function nodes, and count the rest in `foldedNeighbours`. A neighbour past one package's cap that another package kept is drawn, not counted twice. `truncated` is true when any package folded something, and nothing else sets it. A package node is emitted for every package that has any node, changed or not, so the cockpit's level 1 is always the whole picture.

## The judgment file

What the LLM produces. It is a separate file, never the document itself, so the LLM cannot touch stage 1 data.

```jsonc
{
  "schemaVersion": "1.0.0",
  "groups": [ /* Group[] without id or producedBy; the CLI assigns both */ ],
  "path":   [ /* PathStep[] without step numbers; order in the array is the order */ ],
  "reasons": {
    "f3.h2": "Changes the error contract of UpdateRecord. Callers matching on ErrMissingID will silently stop matching.",
    "f6.h1": "Adds a NOT NULL column with no default, which fails on tables with existing rows."
  },
  "riskAdjustments": [
    { "hunkId": "f6.h1", "level": "high", "why": "Migration is destructive on existing rows." }
  ],
  "summary": {
    "tldr": "...",
    "whereItFits": ["..."],
    "flow": { "before": "...", "after": "..." },
    "example": "...",
    "watchFor": ["..."]
  }
}
```

`summary` is required. `groups`, `path`, `reasons` and `riskAdjustments` may be left out when there is nothing to say; the merge reads a missing section as empty. A group carries no id, so a `path` step cannot name one: a step for a proposed group names any hunk inside it, and the merge turns that step into a step for the group it created. A step may name a group id directly only for a stage 1 group, whose id the judgment pass has already read.

The CLI validates it against a JSON Schema, then applies the merge rules above, then writes the result into the document and sets the stage 2 statuses to `ready`. A file that fails validation is kept as `judgment.rejected.json` and the exact errors are returned to the session for one retry.

## The drafts file

The reviewer's unsent comments, stored as `drafts.json` beside the document. Written by the cockpit through the server, in GitHub review API terms from the first keystroke, so nothing is translated at submit time.

```jsonc
{
  "schemaVersion": "1.2.0",
  "pr": { "owner": "northwind-labs", "repo": "tenant-platform", "number": 1234 },
  "verdict": "COMMENT",            // COMMENT | REQUEST_CHANGES | APPROVE | null while unchosen
  "summaryBody": "",               // the review body posted with the verdict
  "drafts": [ /* Draft[] */ ],
  "updatedAt": "2026-09-10T12:41:12Z",  // optional; when this file was last written
  "orphaned": [ /* Draft[] */ ]         // optional; drafts a re-analysis could not re-attach
}
```

`updatedAt` is stamped by the server on every write and is how the cockpit orders its
browser-storage copy against the stored file: both times come from the server's clock, so the
newer copy wins and the older one is replaced (ADR-42). A file with no `updatedAt` has never
been written, and loses to one that has.

`orphaned` is written by the re-attach after a re-analysis, into `drafts.orphaned.json`, and
served as a field of `GET /api/drafts`. The cockpit never writes it: a `PUT` that carries it
has it dropped, so a cockpit cannot resurrect an orphan list the analyzer has cleared. Ids do
not repeat across `drafts` and `orphaned`.

```jsonc
{
  "id": "d1",
  "path": "api/service/tenant/record.go",
  "line": 92,
  "side": "RIGHT",                 // LEFT | RIGHT
  "startLine": null,               // number | null   the first line of a multi-line comment
  "startSide": null,               // LEFT | RIGHT | null
  "body": "Markdown body",
  "commitId": "d4e5f6...",         // the head SHA this comment is bound to
  "createdAt": "2026-09-08T12:40:00Z",
  "updatedAt": "2026-09-08T12:41:12Z"
}
```

`startLine` and `startSide` are both set for a multi-line comment and both `null` otherwise, because GitHub needs both or neither. `validateDrafts` checks that, checks `commitId` is a commit SHA, and checks that ids do not repeat. A renderer may carry extra fields, for instance the hunk a draft belongs to, since unknown fields are allowed; they are warnings, not errors.

## Versioning

- `schemaVersion` follows semantic versioning. It is `1.2.0`: the drafts file gained the optional `updatedAt` and `orphaned` fields, as `conversation`, `botSummaries` and `threadId` arrived in `1.1.0`, so a cached `1.0.0` document still validates and still renders.
- **Minor** bump: a new optional field, a new enum value the cockpit can ignore. The cockpit accepts any document with the same major version.
- **Major** bump: a renamed or removed field, a changed meaning. The cockpit refuses a document with a different major version and shows the two versions.
- The analyzer always writes the newest version. There are no migrations in v1; a stale cached document is re-analyzed.
- The judgment file carries its own `schemaVersion`, and the prompt given to the LLM embeds the schema for that version, so the two cannot drift apart silently. A judgment from another major version is an error, not a warning.
- `checkVersion(doc)` in `packages/schema` answers the one question a renderer needs: does this document's major version match the one this build understands. The cockpit calls it before it renders anything.

## Size

A 4,500-line PR produces a document of roughly 1 to 2 MB, most of it diff lines. This is fine for a local server and one browser tab. The graph has no global node cap: the per-package fold bounds it at 40 neighbours per changed package plus one node per changed function and one per package. A 24-file Go pull request measured 190 nodes and 500 edges.

## What the validator checks, beyond types

`validateDocument`, `validateJudgment` and `validateDrafts` in `packages/schema` run the JSON Schema first and, when the shape holds, these rules. Each finding names the JSON path of the field and says the rule in plain words. Errors reject the file; warnings do not.

Referential:

- Every `hunkId` referenced from `comments`, `groups`, `path`, `graph` and `riskAdjustments` exists in `files`.
- Ids do not repeat: files, hunks, groups, comments, graph nodes, drafts.
- A hunk id is `<fileId>.h<index>`, counting from 1 within the file.
- Every hunk appears at most once across all groups.
- Comments have a `line` inside the referenced hunk's line range on the given `side` and a `path` matching that hunk's file, or `hunkId: null`.
- Comment ids do not repeat across `comments` and `conversation`.
- Every entry of `botSummaries` has `source.kind: "bot"`.
- `graph` edges reference nodes that exist, and a node is `changed` exactly when it carries hunk ids.
- A `graph` node carries `count` when it is a package node, and does not when it is not.

Risk:

- `risk.level` is never below `risk.floor`.
- `risk.mode` follows `risk.level`: `skim` for low, `scrutinize` for medium and high.
- `risk.adjustedBy` records the raise that happened: `from` is the floor, `to` is the level, and `to` is above `from`.
- A high-risk hunk with no `reason` is a warning, once stage 2 has run.

Walk and groups:

- Step numbers run 1..n in array order, and no step is walked twice.
- Every hunk outside a generated group is covered exactly once, and every non-generated group appears once, when `status.path` is `ready`.
- A skim group holds no hunk whose floor is high, and a scrutinize group is not collapsed by default.

Counts and consistency:

- `summary.counts` matches the document, whatever the state of `status.summary`.
- `summary` carries `tldr`, `whereItFits`, `flow`, `example` and `watchFor` when `status.summary` is `ready`. `watchFor` may be empty, but it is written.
- `file.additions` and `file.deletions` match the hunk lines, and `pr.additions`, `pr.deletions` and `pr.changedFiles` match the files.
- A hunk's `oldLines` and `newLines` match its line list, and the line numbers run consecutively from `oldStart` and `newStart`.
- `status.<section>.message` is present when `state` is `failed`.
- `pr.head.sha` is a 40-character hex string.

Warnings:

- Two comments of one thread on different paths, which the cockpit will show under one chip.
- An unknown field, named with its path.
- A `schemaVersion` from another major version, which a renderer will refuse.
