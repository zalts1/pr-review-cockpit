# 01 — Product brief: PR Review Cockpit

Status: draft for review. Written 2026-09-08 from the Phase 0 discovery interview.

## The problem

Reviewing a large pull request is heavy work. The reviewer holds the whole change in their head, judges where a bug could hide, and switches between files all day. The tools that exist add text to this load. Cursor Bugbot, CodeRabbit and similar bots post more comments to read. Today the reviewer on our team asks Claude to summarize the PR, then reads the raw GitHub diff anyway.

We want the opposite. A cockpit that reduces what the reviewer has to read, and tells them where to look first.

## Who it is for

The primary user is a developer on a small platform team who reviews Go and TypeScript pull requests on github.com. They already use Claude Code and the `gh` command line tool. They review alone; there is no shared review session.

The tool must not be tied to one GitHub organization. It reads the repository from the local clone or from the PR URL, so any GitHub repository works.

## What we learned about the target

These facts come from local clones of the target organization and from the GitHub API. They shape the defaults.

| Fact | Consequence for the design |
|---|---|
| Go is the dominant language. TypeScript in the frontend repos. Python in a few tools. | Go gets the full static analysis in v1. TypeScript gets import-level edges. Python is out. |
| Polyrepo, about 60 repositories. The main backend repository is the large one: 14 Go modules and buf-generated protobuf code. | The analyzer must work per repository with no cross-repo knowledge. |
| A typical merged PR touches 6 or 7 files and about 300 lines. The painful tail is 20 to 25 files and 2,000 to 4,500 lines. | The cockpit must earn its keep on the tail. Small PRs are fine on GitHub already. |
| Generated files (`*.pb.go`, mocks) have no `.gitattributes` markers. | We ship our own detection patterns and let the user turn them off. |
| Cursor Bugbot is the only bot that posts inline comments. Wiz, Socket and CodeQL only report a pass or fail check. | We pin Bugbot and human comments to the diff. Other checks appear as a status strip. |
| The reviewer's current habit is "ask Claude to summarize, then read the diff". | This habit is the baseline the cockpit must beat. |

## What v1 delivers

The user types `review <pr>` inside Claude Code. The skill checks out the PR, analyzes it, and opens a local web app for that PR. The user reviews inside the web app and submits comments back to GitHub from there.

Features, in order of priority:

1. **GitHub-like diff view.** Same layout and feel as GitHub's "Files changed" tab, so nothing has to be relearned. Generated code, mocks and lockfiles are collapsed by default.
2. **Risk heatmap.** Every hunk carries a risk level shown as a tint in the gutter. High-risk hunks show a one-line reason in plain words. Mechanical groups such as renames and formatting are collapsed and labeled.
3. **Guided walkthrough.** A "Next" button steps through the hunks in a recommended order: data models, then core logic, then call sites, then tests. A progress line shows where the reviewer is and how many high-risk regions remain.
4. **Bot and human comments pinned in place.** Existing PR review comments from Cursor Bugbot and from people appear on the exact file and line inside the cockpit. Check results such as Wiz and lint appear in a header strip.
5. **Write-back.** The reviewer drafts comments in the cockpit. On submit, the local server posts them to the real PR as one GitHub review with the chosen verdict: comment, request changes, or approve. Every comment lands on the correct file and line of the original PR.
6. **Blast-radius map.** A separate tab shows which packages and functions the change touches and what calls into them. Clicking a node scrolls the diff to that hunk. This tab may load after the rest of the cockpit is already usable.

Progressive loading is a requirement. The cockpit opens as soon as the diff and the deterministic risk signals are ready. The recommended order, the plain-language reasons and the blast-radius map arrive while the reviewer is already working, and the UI says clearly what is still loading.

## What v1 does not do

- No collaboration between reviewers. One person, one session.
- No GitHub Enterprise, GitLab or Bitbucket.
- No browser extension. The cockpit is a local web app only.
- No live chat with Claude from inside the cockpit. The resident Claude session answers questions in the terminal. A cockpit-to-agent channel is a v2 item.
- No pinning of Wiz, Socket or CodeQL findings to file and line. They stay in the status strip.
- No deep call graph for TypeScript or Python. Go only in v1.
- No packaged marketplace distribution. Teammates clone the repo and run one install step. A proper plugin listing is decided later.

## How we know it works

The user reviews their normal PRs with the cockpit for two weeks. Two outcomes count as success:

- **Time.** Large PRs, 15 files or more, reach a confident approve or request-changes in noticeably less wall-clock time than today. The user judges this; we do not need a stopwatch.
- **Replacement.** The user stops running the `pr-summary` skill and stops reading the raw GitHub diff for those PRs, because the cockpit covers both.

Secondary signals: the share of the diff marked "skim" that the user never had to expand, and whether a teammate asks to install it.

The kill criterion is the first milestone. We build the cockpit against realistic fake PR data before any real analysis exists. If stepping through the fake PR in the cockpit does not feel lighter than reading a text summary next to the GitHub diff, we stop and rethink before building the analyzer.

## Constraints

- **Startup budget.** From `review <pr>` to a usable cockpit within about a minute, with a progress bar. Slower pieces may arrive after the cockpit opens.
- **Checkout.** Use a git worktree when a local clone of the repository exists. Otherwise make a temporary clone with full history, because churn and blame signals need it.
- **Zero configuration by default.** `review 123` inside a clone reviews that repository. A URL or `owner/repo#123` works from anywhere. Detection patterns for generated code are built in.
- **Risk floor.** The deterministic signals set a floor. The LLM may raise the risk of a hunk. It may never lower a deterministically high-risk hunk below "review carefully". A false sense of safety is the failure we fear most.
- **Light theme.** GitHub's light palette as the baseline.

## Main risks

- **The thesis is wrong.** A spatial, guided view may not beat a good text summary. The first milestone exists to find this out cheaply.
- **Wrong "skim" labels.** If the heatmap hides a real bug behind a collapsed group, trust is gone. The risk floor and conservative grouping rules exist for this.
- **Comment placement.** GitHub review comments need exact commit, file, line and side. Getting one wrong looks worse than posting nothing. Write-back needs a dry-run preview before submit.
- **Startup time on the large repository.** A fresh clone of the main backend repository is slow. The worktree path must be the common path for the team.

## Open questions carried into later docs

- How the cockpit asks the resident Claude session a question, if at all, before v2. Architecture doc.
- Exact weights of the deterministic signals and the blend with LLM judgment. Risk model doc.
- Whether review drafts survive a server restart. Architecture doc.
