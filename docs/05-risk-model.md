# 05 — Risk model

Status: implemented in `packages/analyzer` at M3. Produces `risk` on every hunk in
`03-review-document-schema.md`. Where the implementation had to differ from the first draft
of this doc, the doc has been corrected in place and the reason is stated.

## What risk means here

Risk is the answer to one question per hunk: how carefully should a human read this? It is not a bug probability. A hunk is high risk when a mistake in it would be expensive, hard to spot, or both. The model is built to fail toward "read it", never toward "skip it".

Two layers produce it:

1. **Deterministic layer.** Computed from git history and parsed source, no LLM. Produces a score and a floor per hunk. Runs in stage 1 and is refined in stage 3.
2. **Judgment layer.** The LLM reads the compact view and may raise a hunk's level, group hunks, order them, and explain them. It can never lower a level below the floor.

## Deterministic signals

### File-level signals from git

All three come from one `git log` pass over the base history, so cost does not grow with the number of changed files.

```
git log <merge-base(base, head)> --since=2.years --format='%H%x09%ct%x09%ae%x09%s' --name-only
```

Three details the first draft left out:

- The commit time `%ct` is in the format because the 90-day window has to be computed per
  commit, and a second `git log --since=90.days` would be a second pass.
- The pass starts at the merge base of the base branch and the head, not at the tip of the
  base branch. On a merged pull request the tip is ahead of the review and includes the
  pull request's own commits, which would count the author's work on the file as prior
  experience with it.
- Rename following (`-M`, `--follow`) is left out: it is the expensive part of a two-year
  log, and the analyzer instead sums the history of the current path and, for a renamed
  file, of its previous path. A file renamed earlier in the window reports the history of
  its current name only, which under-reports churn. That is the wrong direction for a
  safety-first model and is in `BACKLOG.md`.

| Signal | Computation | Why it matters |
|---|---|---|
| `churnCommits90d` | Commits in the last 90 days that touched the file. | Files that change often are where bugs cluster. |
| `bugfixCommits` | Of those 90-day commits, the ones whose subject matches `\b(fix|fixes|fixed|bug|hotfix|revert|regression)\b`, case-insensitive. | A file that keeps needing fixes is a file people misunderstand. |
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
**/infra/**  **/terraform/**  **/*.tf  **/helm/**  **/charts/**  **/k8s/**
deploy/**/*.yaml  **/deploy/**/*.yaml  infra/**/*.yaml  **/infra/**/*.yaml
.github/workflows/**  Dockerfile*  **/Makefile
**/crypto/**  **/secret*/**  **/*token*  **/*credential*
```

A pattern with no slash matches the basename, as gitignore does, which is what makes
`Dockerfile*` and the lock files below match at any depth. `**` spans path segments, `*` and
`?` stay inside one. The first pattern that matches is the one reported, so a folded or
floored file names a rule the reviewer can check.

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

Computed for Go in v1: enclosing symbols, complexity and the call graph. TypeScript gets
`fanIn` only, from the names its changed files export; it gets no symbols, no complexity and
no `fanOut`, so a TypeScript hunk carries no enclosing symbol in the document and its file
reports `complexityBefore` and `complexityAfter` as `null`. Other languages report `null` for
all of them.

| Signal | Computation |
|---|---|
| `complexityBefore`, `complexityAfter` | For each function that overlaps a hunk: 1 plus the count of `if`, `else if`, `for`, `case`, `select` case, `&&`, `||`, and `return` inside a loop or conditional. Summed over the file's changed functions, on the base side and on the head side. `else` on its own is not a branch and is not counted; `default:` is not counted either, because it carries no condition. A function literal counts into the function that holds it, which is where a reviewer reads it. The head side names the changed functions; the base side is the same names in the base file, so a function that only moved contributes zero growth. |
| `fanIn` | Stage 1: whole-word matches of the changed symbol names across the repository, minus occurrences in the defining file. Stage 3: the number of distinct functions whose bodies contain a call resolved to a symbol changed in this file. `fanSource` says which. |
| `fanOut` | Stage 1: `null`. Stage 3: distinct symbols called from the changed functions, excluding the standard library and anything unresolved. |

The stage 1 estimate is one `git grep -w -E` with every changed symbol in one alternation,
not one `git grep` per symbol: on a repository of about ten thousand Go files, a pattern per
symbol took 11 seconds and the single alternation takes 1.4 for the same matches. The matches
are attributed per symbol afterwards by tokenising each matched line the way `-w` matched it.

Generated files get no fan-in at all (`fanIn`, `fanOut` and `fanSource` are `null`). A
generated file defines hundreds of same-named symbols — `Reset`, `String`, `GetId` — and
counting their callers measures the generator, not the change: on a real protobuf file the
estimate came to 21,991. Generated hunks are floored low anyway, so the number bought
nothing and lied on hover.

For TypeScript, stage 1 counts the same way over the names the changed files export.

Method calls in Go resolve by name and, where the receiver type is known inside the same package, by type. Cross-package resolution follows imports one hop. Anything unresolved is counted by name alone, which over-counts. Over-counting raises risk, which is the safe direction.

### Hunk-level features

Computed per hunk from its own lines. They are not stored as signals, only as factors on the risk.

| Feature | Computation |
|---|---|
| `size` | Added plus deleted lines. |
| `deleteRatio` | Deleted divided by added plus deleted. Deletions of logic are riskier than additions because nothing new is there to be tested. |
| `kind` | Decided in this order: `whitespace-only` when the changed lines differ only in whitespace, `comment-only` when every changed line is a comment, `import` when every changed line falls inside an import statement, `test` when the file is a test file, `code` otherwise. The trivial kinds come first so an import shuffle inside a test file is skimmable rather than measured as a test change. Import statements are found by scanning both sides of the file for import ranges, and a changed line counts against the side it belongs to; string lines alone never make a hunk an import hunk. |
| `hazards` | Count of changed lines matching hazard patterns for the language. A line counts once however many patterns it matches. Go: `go func`, `sync.`, `atomic.`, `unsafe.`, `recover()`, `context.WithTimeout`, `time.Sleep`, `select {`, `chan `, `defer`, `panic(`, `os.Exit`, `exec.Command`, `sql.`, `Exec(`, `Query(`, `http.Client`, `tls.`, `rand.`. TypeScript: `eval(`, `dangerouslySetInnerHTML`, `innerHTML`, `child_process`, `fetch(`, `localStorage`, `setTimeout`, `Promise.race`, `as any`, `@ts-ignore`. |
| `touchesErrorPath` | Any changed line matches `err != nil`, `return nil, `, `catch`, `throw`, `panic(`. Error handling is where reviewers skim and bugs hide. |
| `touchesPublicSurface` | The enclosing function is exported (Go: capitalised name; TypeScript: `export`) or the hunk changes a struct or type definition. Never true in a test file: a Go test function is capitalised by convention and called by the test runner alone, so its name says nothing about blast radius. Counting it added 0.05 to every hunk of every test file, which was enough to push routine test edits from low to medium. |

## Scoring

### Normalise

Every signal becomes a number between 0 and 1. Unknown (`null`) signals become 0 and are marked so in the factors, but see the floor rules: unknown fan-in never lowers a floor that another rule set.

| Signal | Normalisation |
|---|---|
| `churnCommits90d` | `min(x / 15, 1)` |
| `bugfixCommits` | `min(x / 4, 1)` |
| `authorPriorCommits` | `1` when 0, `0.5` when 1 or 2, `0` when 3 or more |
| `fanIn` | `min(log2(1 + x) / 6, 1)`, so 63 callers is 1 |
| `complexity` | `min(max(after - before, 0) / 10, 1)`, growth only; plus `0.3` when `after >= 15`, the sum clamped to 1 |
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

Each contribution is rounded to two decimals and the score is the sum of the rounded
contributions. The reviewer sees the top three contributions on hover, and they have to add
up to the number behind the heat; a score computed at full precision and rounded afterwards
does not.

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

The last two rules are the two named exceptions that push the floor down, and they run last
and win over every rule above them, migrations included. A whitespace change inside a
migration is a whitespace change. Stage 1's skim groups depend on this: the validator refuses
a high-floor hunk in a skim group, and these rules are what guarantee that generated, import
and whitespace hunks are never high.

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

No floor rule fires. Floor is high from the score alone. The factors list carries the top three contributions so the hover text reads "5 fix commits in 90 days · 23 callers · first change by this author". When a floor rule does fire, it takes the first of the three slots, with the rule and its effect as the detail, and the top two contributions follow.

### Refinement in stage 3

When the call graph lands, `fanIn` and `fanOut` are replaced by resolved counts and the hunk
is scored again. The score and the factors always follow the new counts, so what the reviewer
reads on hover agrees with the signals on the file. The floor only ever rises. The stage 1
estimate over-counts by construction, so the graph usually lowers the count, and a floor that
fell after the reviewer had already seen it would be a floor in name only. A floor kept above
its recomputed level says so in its first factor: "kept at high from the stage 1 estimate of
669 callers".

## The judgment layer

Implemented at M4. `cockpit analyze` writes the input, `cockpit judge-prompt` prints the
prompt, `cockpit judge-merge` validates and merges the output.

### Input

The compact view written by the CLI, `compact.md`, in this order: a legend; the pull request
with its title, author, refs, size and body verbatim; the file list, each line carrying the
file id, status, language, added and deleted lines, hunk count, path and the rule that folded
it when it is generated; the stage 1 groups with their hunk ids; one block per hunk that is
not in a generated group; and the stage 1 comments, when there are any.

A hunk block carries the id, the path, the enclosing symbols (falling back to the diff header
for a language the analyzer does not parse), the kind with the size of the change and the
lines it covers, the floor and score with the top factors on one line, and the change text:
full under 40 changed lines, the first 15 changed lines otherwise with a `… N more lines`
marker. The change text sits in a backtick fence that grows longer when the text itself holds
backticks.

The compact view is not a compressed diff. On a 24-file, 194-hunk pull request it came to
164 kB against 131 kB of `gh pr diff`: the change text inside it is 88 kB, two thirds of the
raw diff, and the remaining 76 kB is the per-hunk metadata that makes each block judgeable on
its own. What it replaces is the 776 kB review document.

The session may open any file in the checkout when it wants more, and the prompt tells it to:
read the callers of a changed function, read the code around a preview hunk, and check the
pull request body against the code, because a body written days earlier often describes an
earlier commit.

### Output

The judgment file from `03-review-document-schema.md`. Four kinds of content:

| Output | What the LLM decides | What the CLI enforces |
|---|---|---|
| `groups` | Which hunks are one mechanical change, with a title and a skim or scrutinize mode. | No hunk in two groups. No high-floor hunk in a skim group. Stage 1 groups cannot be removed. |
| `path` | The order to read hunks and groups, with a phase and a note each. | Every hunk appears exactly once; missing ones are appended under `other`. |
| `reasons` | One plain sentence per hunk explaining what could go wrong. Required for every high hunk, optional otherwise. | Sentence length capped at 200 characters. Reasons for unknown hunk ids are dropped. |
| `riskAdjustments` | Hunks whose level should be higher than the floor, with a reason. | A proposed level below the floor is dropped and logged. Raising is applied and recorded in `adjustedBy`. |

The LLM is told the floor rules and told plainly that it cannot lower risk. Asking it to argue for lowering produces text nobody reads; asking it to spot what the signals missed produces the raises we want.

One more thing the LLM decides, which the merge cannot check: a group of kind `generated` is
folded out of the walk entirely. That is the right home for a file whose own header says it is
generated but which no built-in pattern matched — on the verification pull request, 14 hunks
of a protobuf-ts client. The prompt says so, and says to name the header in the description so
the reviewer can check the call.

### Validation

`cockpit judge-merge` runs the steps in order and stops at the first failure:

1. Parse as JSON.
2. Validate against the judgment JSON Schema and the referential rules, which include that
   every hunk id exists.
3. Merge, in this order: risk adjustments, then groups, then path, then reasons, then summary.
   Counts are recomputed from the merged document.
4. Validate the merged document, which is the last line of defence against a merge rule with a
   gap in it.
5. Write the document by rename, so a cockpit that is already open picks it up and never reads
   half a file.

Anything a rule dropped or clamped is printed and appended to `log.txt` with the hunk id and
the rule, so a wrong floor can be investigated.

On any failure nothing is written, the judgment is kept as `judgment.rejected.json`, the first
five errors are printed in plain words with one line saying where to write the corrected file,
and the exit code is non-zero. The one retry lives in the skill, not in the CLI: the CLI has no
way to produce a better judgment, so it fails loudly and the session decides. After a second
rejection the skill stops and tells the reviewer, and the stage 2 sections stay `pending`, so
the cockpit runs on deterministic risk alone.

## Calibration

The v1 weights are priors, not measurements. To improve them without guessing:

- Every review keeps its document in the cache. After two weeks there is a corpus of real PRs with real floors.
- For each PR, the reviewer's own comments and any later fix commits touching the same lines are the ground truth for "this needed attention".
- A `cockpit calibrate` command, not in v1, will report how often high floors received comments and how often low floors did. Weights and thresholds are adjusted from that report, by hand, in one commit that explains why.

The one number to watch from day one: how often a hunk with floor `low` receives a human comment on the real PR. If that is common, the thresholds are too permissive and "skim" is lying.

The first three real pull requests say the opposite is the more likely problem. On a
24-file backend change, 3 hunks came out high, 110 medium and 81 low, and 39 of the 46
non-test code hunks were medium. In a repository where every touched file has 20 to 50
commits in 90 days, `churnCommits90d`, `authorPriorCommits` and `touchesErrorPath` alone
carry a hunk over 0.28, so "medium" describes the repository rather than the change. The
weights are priors and this is the first measurement against them; the candidate fixes, in
`BACKLOG.md`, are a higher medium threshold, normalising churn against the repository's own
median rather than a fixed 15, and dropping `authorPriorCommits` to a tie-breaker.

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
