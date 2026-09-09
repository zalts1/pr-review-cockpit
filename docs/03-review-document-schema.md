# 03 — Review document schema

Status: draft for review. The contract described in `02-architecture.md`.

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

  "files":     [ /* File[]     stage 1 */ ],
  "comments":  [ /* Comment[]  stage 1 */ ],
  "checks":    [ /* Check[]    stage 1 */ ],

  "groups":    [ /* Group[]    stage 2 */ ],
  "path":      [ /* PathStep[] stage 2 */ ],
  "summary":   { /* Summary    stage 2 */ },

  "graph":     { /* Graph      stage 3 */ }
}
```

Stage 2 and 3 sections are present from the first write, as empty arrays or objects, so the cockpit never has to check for a missing key. It checks `status` instead.

### `status`

```jsonc
"status": {
  "files":    { "state": "ready",   "updatedAt": "..." },
  "comments": { "state": "ready",   "updatedAt": "..." },
  "checks":   { "state": "ready",   "updatedAt": "..." },
  "groups":   { "state": "pending", "updatedAt": "..." },
  "path":     { "state": "pending", "updatedAt": "..." },
  "summary":  { "state": "pending", "updatedAt": "..." },
  "graph":    { "state": "failed",  "updatedAt": "...", "message": "tree-sitter timed out after 120s" }
}
```

`state` is one of `pending`, `ready`, `failed`. `message` is required when `state` is `failed` and is shown to the reviewer as written.

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
  "fanSource": "grep",             // grep | graph   stage 1 estimates with git grep on the changed symbols, stage 3 replaces it with parsed call-graph counts
  "complexityBefore": 18,          // sum of cyclomatic complexity of changed functions, base side
  "complexityAfter": 27,           // same, head side
  "sensitivePath": { "match": true, "rule": "**/auth/**" },   // or { "match": false, "rule": null }
  "testFile": false,               // matches the language's test naming convention
  "coverageDelta": null            // percentage points, only when a coverage report is available
}
```

Every numeric field may be `null` when the signal could not be computed, for example fan-in on a language without call-graph support. `null` means unknown and is never treated as zero.

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

Existing review comments on the PR, from bots and from people, pinned to the diff.

```jsonc
{
  "id": "c17",
  "source": { "kind": "bot", "name": "Cursor Bugbot" },     // kind: bot | human
  "author": "cursor[bot]",
  "path": "api/service/tenant/record.go",
  "line": 92,
  "side": "RIGHT",
  "hunkId": "f3.h2",              // null when the comment is on a line outside the current diff
  "body": "Markdown body",
  "url": "https://github.com/.../pull/1234#discussion_r...",
  "createdAt": "2026-09-08T10:00:00Z",
  "resolved": false,
  "severity": "medium"            // low | medium | high | null   parsed from the bot's own labels when present, else null
}
```

`hunkId` is the join key the cockpit uses to place a pin. A comment on a line that no longer exists in the diff has `hunkId: null` and is listed in a separate "outdated" area.

## Stage 1: `checks`

```jsonc
{
  "name": "Wiz",
  "app": "wiz-io",
  "status": "success",            // success | failure | pending | neutral | skipped | cancelled
  "url": "https://github.com/.../checks/...",
  "completedAt": "2026-09-08T10:05:00Z"
}
```

Displayed as a strip. Never pinned to a line in v1.

## Stage 2: `groups`

A group is a set of hunks the reviewer should treat as one thing. Stage 1 may create groups of kind `generated`, `import`, `whitespace` from deterministic rules. Stage 2 adds the semantic ones.

```jsonc
{
  "id": "g2",
  "kind": "mechanical-rename",    // generated | import | whitespace | mechanical-rename | formatting | test-update | semantic
  "title": "Rename TenantRecord to TenantProfile",
  "description": "Same identifier replaced across 9 files. No logic change.",
  "hunkIds": ["f1.h1", "f1.h2", "f4.h1", "f5.h1", "f5.h2", "f7.h1"],
  "mode": "skim",                 // skim | scrutinize
  "collapsedByDefault": true,
  "producedBy": "stage2"          // stage1 | stage2
}
```

Rules enforced at merge:

- A hunk belongs to at most one group. A second assignment is rejected with a validation error.
- A group with `mode: "skim"` may not contain a hunk whose `risk.floor` is `high`. The CLI removes such hunks from the group and logs it.
- A group produced by stage 1 may not be removed by stage 2.

## Stage 2: `path`

The recommended walk order. Every hunk that is not inside a collapsed group appears exactly once. Grouped hunks appear once, as the group.

```jsonc
[
  { "step": 1, "ref": { "kind": "hunk",  "id": "f2.h1" }, "phase": "models",    "note": "New Record struct and validation rules." },
  { "step": 2, "ref": { "kind": "hunk",  "id": "f3.h2" }, "phase": "core",      "note": "UpdateRecord now validates id and returns gRPC status." },
  { "step": 3, "ref": { "kind": "group", "id": "g2" },    "phase": "callsites", "note": "Mechanical rename, 9 files." },
  { "step": 4, "ref": { "kind": "hunk",  "id": "f9.h1" }, "phase": "tests",     "note": null }
]
```

`phase` is one of `models`, `core`, `callsites`, `tests`, `config`, `other`. The cockpit uses it for the progress line, for example "core 2/4 · 1 high-risk remaining".

Merge rules: every non-grouped, non-generated hunk must appear exactly once. Missing hunks are appended at the end under `phase: "other"` and logged. Duplicates and unknown ids are dropped.

## Stage 2: `summary`

```jsonc
"summary": {
  "oneLiner": "Adds a tenant record API with validation, renames TenantRecord to TenantProfile across the service.",
  "reviewFocus": [
    "UpdateRecord changes error semantics from a sentinel to a gRPC status; check every caller that compared against ErrMissingID.",
    "Migration 0042 adds a NOT NULL column without a default."
  ],
  "counts": { "hunks": 23, "highRisk": 3, "skimmable": 12 }
}
```

`counts` is recomputed by the CLI at merge from the actual document, not taken from the LLM.

## Stage 3: `graph`

The blast-radius map. Nodes are functions and files touched by the change plus their one-hop neighbors. Edges are calls and imports.

```jsonc
"graph": {
  "nodes": [
    { "id": "n1", "kind": "function", "label": "Service.UpdateRecord", "file": "api/service/tenant/record.go", "changed": true,  "hunkIds": ["f3.h2"] },
    { "id": "n2", "kind": "function", "label": "Handler.PatchTenant",  "file": "api/http/tenant.go",           "changed": false, "hunkIds": [] },
    { "id": "n3", "kind": "package",  "label": "api/service/tenant",   "file": null,                           "changed": true,  "hunkIds": ["f2.h1", "f3.h1", "f3.h2"] }
  ],
  "edges": [
    { "from": "n2", "to": "n1", "kind": "calls" }
  ],
  "truncated": false               // true when the graph was cut to a node limit
}
```

`kind` for nodes is `function`, `file` or `package`. `hunkIds` is the click target: clicking a node scrolls to its first hunk. Unchanged neighbors have an empty list and are drawn muted.

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
  "summary": { "oneLiner": "...", "reviewFocus": ["..."] }
}
```

The CLI validates it against a JSON Schema, then applies the merge rules above, then writes the result into the document and sets the stage 2 statuses to `ready`. A file that fails validation is kept as `judgment.rejected.json` and the exact errors are returned to the session for one retry.

## Versioning

- `schemaVersion` follows semantic versioning.
- **Minor** bump: a new optional field, a new enum value the cockpit can ignore. The cockpit accepts any document with the same major version.
- **Major** bump: a renamed or removed field, a changed meaning. The cockpit refuses a document with a different major version and shows the two versions.
- The analyzer always writes the newest version. There are no migrations in v1; a stale cached document is re-analyzed.
- The judgment file carries its own `schemaVersion`, and the prompt given to the LLM embeds the schema for that version, so the two cannot drift apart silently.

## Size

A 4,500-line PR produces a document of roughly 1 to 2 MB, most of it diff lines. This is fine for a local server and one browser tab. The graph is capped at 300 nodes and marked `truncated` beyond that.

## What the validator checks, beyond types

- Every `hunkId` referenced from `comments`, `groups`, `path`, `graph` and `riskAdjustments` exists in `files`.
- Every hunk appears at most once across all groups.
- `risk.level` is never below `risk.floor`.
- `status.<section>.message` is present when `state` is `failed`.
- `pr.head.sha` is a 40-character hex string.
- Comments have a `line` inside a hunk's line range on the given `side`, or `hunkId: null`.
