# 05 — Risk model

Status: draft for review. Produces `risk` on every hunk in `03-review-document-schema.md`.

## What risk means here

Risk is the answer to one question per hunk: how carefully should a human read this? It is not a bug probability. A hunk is high risk when a mistake in it would be expensive, hard to spot, or both. The model is built to fail toward "read it", never toward "skip it".

Two layers produce it:

1. **Deterministic layer.** Computed from git history and parsed source, no LLM. Produces a score and a floor per hunk. Runs in stage 1 and is refined in stage 3.
2. **Judgment layer.** The LLM reads the compact view and may raise a hunk's level, group hunks, order them, and explain them. It can never lower a level below the floor.

## Deterministic signals

### File-level signals from git

All three come from one `git log` pass over the base branch, so cost does not grow with the number of changed files.

```
git log <base.sha> --since=2.years --format='%H%x09%ae%x09%s' --name-only
```

| Signal | Computation | Why it matters |
|---|---|---|
| `churnCommits90d` | Commits in the last 90 days that touched the file. | Files that change often are where bugs cluster. |
| `bugfixCommits` | Of those, commits whose subject matches `\b(fix|fixes|fixed|bug|hotfix|revert|regression)\b`, case-insensitive. | A file that keeps needing fixes is a file people misunderstand. |
| `authorPriorCommits` | Commits in the two-year window by the PR author that touched the file, before this PR. The author's identities are the committer emails on the PR's own commits, taken from `gh pr view --json commits`. | An author's first touch on a file misses the unwritten rules of that file. |

### File-level signals from paths

| Signal | Computation |
|---|---|
| `sensitivePath` | First matching glob from the built-in list, or from `.review-cockpit.json` at the repository root, which is checked first. |
| `testFile` | `*_test.go`, `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `test_*.py`, `*_test.py`, any path containing `__tests__/` or `/testdata/`. |
| `generated` | See below. Not a risk signal on its own; it sets the floor to low and folds the file. |

Built-in sensitive globs:

```
**/auth/**  **/authn/**  **/authz/**  **/rbac/**  **/permission*/**  **/session*/**
**/payment*/**  **/billing/**  **/invoice*/**
**/migrations/**  **/migration/**  **/*.sql
**/infra/**  **/terraform/**  **/*.tf  **/helm/**  **/charts/**  **/k8s/**  **/*.yaml in deploy/ or infra/
.github/workflows/**  Dockerfile*  **/Makefile
**/crypto/**  **/secret*/**  **/*token*  **/*credential*
```

Built-in generated patterns:

```
**/*.pb.go  **/*.pb.gw.go  **/*_grpc.pb.go  **/*.pb.ts  **/*_pb2.py  **/*_pb2_grpc.py
**/mocks/**  **/mock_*.go  **/*_mock.go  **/*.gen.go  **/*_gen.go  **/*.generated.*
**/zz_generated*  **/gen/**  **/generated/**
package-lock.json  pnpm-lock.yaml  yarn.lock  go.sum  Cargo.lock  poetry.lock  uv.lock
**/*.min.js  **/*.min.css  **/*.snap
```

A file is also treated as generated when its first five lines contain `Code generated` and `DO NOT EDIT`, the Go convention. Detection is reported in `generated.rule` so the reviewer can see why a file was folded, and `--no-fold-generated` turns folding off.

### Structure signals from tree-sitter

Computed for Go in v1. TypeScript gets `fanIn` and `fanOut` from import edges only. Other languages report `null`.

| Signal | Computation |
|---|---|
| `complexityBefore`, `complexityAfter` | For each function that overlaps a hunk: 1 plus the count of `if`, `else if`, `for`, `case`, `select` case, `&&`, `||`, and `return` inside a loop or conditional. Summed over the file's changed functions, on the base side and on the head side. |
| `fanIn` | Stage 1: `git grep -w -c <symbol>` across the repository for every function or method name defined in a changed function's file, minus occurrences in the defining file. Stage 3: the number of distinct functions whose bodies contain a call resolved to that symbol. `fanSource` says which. |
| `fanOut` | Stage 1: `null`. Stage 3: distinct symbols called from the changed functions, excluding the standard library. |

Method calls in Go resolve by name and, where the receiver type is known inside the same package, by type. Cross-package resolution follows imports one hop. Anything unresolved is counted by name alone, which over-counts. Over-counting raises risk, which is the safe direction.

### Hunk-level features

Computed per hunk from its own lines. They are not stored as signals, only as factors on the risk.

| Feature | Computation |
|---|---|
| `size` | Added plus deleted lines. |
| `deleteRatio` | Deleted divided by added plus deleted. Deletions of logic are riskier than additions because nothing new is there to be tested. |
| `kind` | `import` when every changed line is inside an import block. `whitespace-only` when changed lines differ only in whitespace. `comment-only` when every changed line is a comment. Otherwise `code`. Test files get `test`. |
| `hazards` | Count of changed lines matching hazard patterns for the language. Go: `go func`, `sync.`, `atomic.`, `unsafe.`, `recover()`, `context.WithTimeout`, `time.Sleep`, `select {`, `chan `, `defer`, `panic(`, `os.Exit`, `exec.Command`, `sql.`, `Exec(`, `Query(`, `http.Client`, `tls.`, `rand.`. TypeScript: `eval(`, `dangerouslySetInnerHTML`, `innerHTML`, `child_process`, `fetch(`, `localStorage`, `setTimeout`, `Promise.race`, `as any`, `@ts-ignore`. |
| `touchesErrorPath` | Any changed line matches `err != nil`, `return nil, `, `catch`, `throw`, `panic(`. Error handling is where reviewers skim and bugs hide. |
| `touchesPublicSurface` | The enclosing function is exported (Go: capitalised name; TypeScript: `export`) or the hunk changes a struct or type definition. |

## Scoring

### Normalise

Every signal becomes a number between 0 and 1. Unknown (`null`) signals become 0 and are marked so in the factors, but see the floor rules: unknown fan-in never lowers a floor that another rule set.

| Signal | Normalisation |
|---|---|
| `churnCommits90d` | `min(x / 15, 1)` |
| `bugfixCommits` | `min(x / 4, 1)` |
| `authorPriorCommits` | `1` when 0, `0.5` when 1 or 2, `0` when 3 or more |
| `fanIn` | `min(log2(1 + x) / 6, 1)`, so 63 callers is 1 |
| `complexity` | `min(max(after - before, 0) / 10, 1)`, growth only; plus `0.3` when `after >= 15` |
| `size` | `min(x / 120, 1)` |
| `deleteRatio` | the ratio itself |
| `hazards` | `min(x / 3, 1)` |
| `touchesErrorPath`, `touchesPublicSurface`, `sensitivePath` | 0 or 1 |

### Weighted sum

```
score = 0.18 * sensitivePath
      + 0.15 * fanIn
      + 0.12 * bugfixCommits
      + 0.10 * churnCommits90d
      + 0.10 * authorPriorCommits
      + 0.10 * complexity
      + 0.08 * hazards
      + 0.07 * touchesErrorPath
      + 0.05 * touchesPublicSurface
      + 0.05 * size
```

The weights sum to 1, so the score stays in 0 to 1. The three heaviest weights go to the signals with the clearest evidence in the literature and in practice: sensitive area, blast radius, and fix history.

### Thresholds

| Score | Level |
|---|---|
| `>= 0.55` | high |
| `>= 0.28` | medium |
| below | low |

### Floor rules

Rules run after the score and can only push the floor up, with two named exceptions that push it down.

| Rule | Effect |
|---|---|
| `sensitivePath` matches and `kind` is `code` | floor at least **high** |
| File is a migration (`**/migrations/**`, `*.sql`) and the hunk has any change | floor **high** |
| `deleteRatio > 0.7` and `size >= 20` in a non-test file | floor at least **medium** |
| Test file, `deleteRatio > 0.5` | floor at least **medium**. Deleted tests deserve a look. |
| `hazards >= 2` | floor at least **medium** |
| `kind` is `import`, `whitespace-only` or `comment-only` | floor **low**, score ignored |
| `generated.is` is true | floor **low**, score ignored, file folded |

`mode` follows the level: `scrutinize` for high and medium, `skim` for low.

### Worked example

`api/service/tenant/record.go`, hunk `f3.h2`, 31 lines changed in `UpdateRecord`.

| Signal | Raw | Normalised | Weight | Contribution |
|---|---|---|---|---|
| sensitivePath | `**/auth/**` no match | 0 | 0.18 | 0.00 |
| fanIn | 23 | 0.76 | 0.15 | 0.11 |
| bugfixCommits | 5 | 1.00 | 0.12 | 0.12 |
| churnCommits90d | 14 | 0.93 | 0.10 | 0.09 |
| authorPriorCommits | 0 | 1.00 | 0.10 | 0.10 |
| complexity | 18 → 27 | 0.9 + 0.3 → 1.0 | 0.10 | 0.10 |
| hazards | 0 | 0 | 0.08 | 0.00 |
| touchesErrorPath | yes | 1 | 0.07 | 0.07 |
| touchesPublicSurface | exported method | 1 | 0.05 | 0.05 |
| size | 31 | 0.26 | 0.05 | 0.01 |
| **score** | | | | **0.65 → high** |

No floor rule fires. Floor is high from the score alone. The factors list carries the top three contributions so the hover text reads "5 fix commits in 90 days · 23 callers · first change by this author".

## The judgment layer

### Input

The compact view written by the CLI, `compact.md`. Per hunk: id, path, enclosing symbol, kind, floor, the top factors, and the change text: full for hunks under 40 lines, the first 15 changed lines otherwise. Also the PR title and body, the file list with generated files marked, and the existing bot comments. The session may open any file in the checkout when it wants more.

### Output

The judgment file from `03-review-document-schema.md`. Four kinds of content:

| Output | What the LLM decides | What the CLI enforces |
|---|---|---|
| `groups` | Which hunks are one mechanical change, with a title and a skim or scrutinize mode. | No hunk in two groups. No high-floor hunk in a skim group. Stage 1 groups cannot be removed. |
| `path` | The order to read hunks and groups, with a phase and a note each. | Every hunk appears exactly once; missing ones are appended under `other`. |
| `reasons` | One plain sentence per hunk explaining what could go wrong. Required for every high hunk, optional otherwise. | Sentence length capped at 200 characters. Reasons for unknown hunk ids are dropped. |
| `riskAdjustments` | Hunks whose level should be higher than the floor, with a reason. | A proposed level below the floor is dropped and logged. Raising is applied and recorded in `adjustedBy`. |

The LLM is told the floor rules and told plainly that it cannot lower risk. Asking it to argue for lowering produces text nobody reads; asking it to spot what the signals missed produces the raises we want.

### Validation

1. Parse as JSON. Failure: return the parse error to the session for one retry.
2. Validate against the judgment JSON Schema. Failure: return the first five schema errors for one retry.
3. Referential checks: every hunk id exists.
4. Merge rules, applied in this order: risk adjustments, then groups, then path, then reasons, then summary. Counts are recomputed from the merged document.
5. Anything dropped by a rule goes to `log.txt` with the hunk id and the rule, so a wrong floor can be investigated.

After a second failure, stage 2 sections are marked `failed` with the validation message, and the cockpit runs on deterministic risk alone.

## Calibration

The v1 weights are priors, not measurements. To improve them without guessing:

- Every review keeps its document in the cache. After two weeks there is a corpus of real PRs with real floors.
- For each PR, the reviewer's own comments and any later fix commits touching the same lines are the ground truth for "this needed attention".
- A `cockpit calibrate` command, not in v1, will report how often high floors received comments and how often low floors did. Weights and thresholds are adjusted from that report, by hand, in one commit that explains why.

The one number to watch from day one: how often a hunk with floor `low` receives a human comment on the real PR. If that is common, the thresholds are too permissive and "skim" is lying.

## Repository overrides

`.review-cockpit.json` at the repository root, all fields optional:

```jsonc
{
  "sensitivePaths": ["internal/tenancy/**", "pkg/authz/**"],
  "generatedPatterns": ["api/gen/**"],
  "hazardPatterns": { "go": ["tenant.Unsafe"] }
}
```

Overrides add to the built-in lists. Nothing is removable per repository in v1, because removing a sensitive path is exactly the kind of change that should be argued about in a PR of its own.
