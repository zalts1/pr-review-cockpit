---
name: cockpit
description: >-
  Open a GitHub pull request in the PR Review Cockpit, a local web app that
  shows the diff with a risk level, a reading order and a brief on every hunk.
  Use when the user names the cockpit: "cockpit 123", "cockpit
  owner/repo#123", "cockpit <pull request URL>", "open the cockpit for <pr>",
  "review 123 in the cockpit", or "review this PR in the cockpit". The user
  has to ask for the cockpit; a bare "review this PR" with no mention of it is
  a different job and not this skill. Takes a pull request number,
  owner/repo#number, or a GitHub pull request URL.
---

# Review a pull request in the cockpit

The `cockpit` command line tool does the mechanical work. It resolves the pull request, checks
it out, analyses the diff, serves the web app, and posts the review the user writes there.

You do one part of it, the judgment pass, and then stay in the terminal to answer questions
about the code.

Run the steps below in order. Step 4 is the judgment pass, and nothing else does it: skip it and
the cockpit shows deterministic risk with no groups, no reading order and no brief. The browser
opens in step 5, after the judgment is merged, so the user meets a finished page rather than a
row of placeholders.

Before step 1, only if `cockpit` is not on PATH: run `cockpit doctor`, or
`${CLAUDE_PLUGIN_ROOT}/bin/cockpit doctor` when the bare command is not found. A plugin install
builds itself on the first session start, and a build that failed left its reason in
`${CLAUDE_PLUGIN_DATA}/bootstrap.log`. Give the user that table or that log, and stop: no step
below works without the command.

## 1. Resolve the argument

The user names the pull request in one of three ways, and `cockpit` takes all three:

- `123` — a bare number. It only works from inside a clone of the repository that holds the
  pull request, because the repository comes from the clone's GitHub remote. If the working
  directory is not inside one, ask the user which repository they mean and use the next form.
- `owner/repo#123`
- `https://github.com/owner/repo/pull/123`

Use the same argument for every command in this procedure. If it was a bare number, stay in
the same directory for all of them.

## 2. Analyse and serve, without opening anything

```
cockpit run <pr>
```

That resolves the pull request, checks it out, runs stage 1, starts the server and then builds
the call graph. It does not open a browser: step 5 does that, once there is something worth
looking at. Progress goes to stderr, one line per stage with its elapsed time, and the last
line of stdout is one line of JSON:

```json
{"url":"http://127.0.0.1:8090","prDir":"…/pr-123","compact":"…/pr-123/compact.md","judgmentOut":"…/pr-123/judgment.json","headSha":"…","judgment":"session","hunks":40}
```

It is the only line of output that starts with `{`; every other line is progress on stderr.

Read that line and keep the values. `judgmentOut` is where your judgment file goes, `prDir`
holds everything about this review including the checkout at `prDir/worktree`, and `judgment`
says which path step 4 takes.

One progress line is for the user, not for you. It looks like one of these:

```
estimate: stage 1 ~9s, judgment ~4m (from 6 past runs on this repo)
estimate: no history for this repo yet; judgment usually takes 3 to 6 minutes
```

Tell them that, in your own words, as soon as the command returns:

> Analysing owner/repo#123. Stage 1 took nine seconds; the judgment pass usually takes about
> four minutes on this repository. I will open the cockpit when it is ready.

Then go straight to step 3. Do not wait for the user to answer.

## 3. Which judgment path

The `judgment` value in the JSON says it: `session` means you do the pass yourself in step 4a,
`headless` means a separate run of Claude does it in step 4b while your terminal stays free. It
comes from `~/.config/review-cockpit/config.json`, which you can also read on its own:

```
cockpit config get judgment
```

Trust the JSON when you have it; the config command is for when you do not.

## 4a. The judgment pass, in this session

```
cockpit judge <pr>
```

That prints one prompt: the instructions, the JSON Schema your output must match, the rules
the tool enforces, the shape of the summary, and the whole pull request as a compact view at
the end.

Follow that prompt exactly. It tells you to open files from the checkout and read the code
around each change before you write anything. Do that. A judgment written from the diff alone
is the thing this tool exists to replace.

While you work, print these four lines and nothing else between your tool calls, so the user
sees the pass moving without reading your thinking:

```
judgment: read the compact view (N hunks) · expect ~Ym
judgment: opening files in the checkout
judgment: writing judgment.json
judgment: merged, opening the cockpit
```

`N` is the hunk count from the JSON in step 2 and `Y` is the minutes from the estimate line.
Four lines, in that order, and no others.

Write your output to the `judgmentOut` path, which is the path the prompt names too. Write
nothing else: not the review document, not the checkout, and no comment on the pull request.
Then merge it:

```
cockpit judge-merge <pr>
```

It validates your file, merges it into the document, writes the document, and prints every
proposal it dropped or clamped. Read the merge log: a dropped group or a clamped risk level is
a mistake of yours worth knowing about.

### If the merge rejects your file

The command exits non-zero, prints the first five errors, and keeps your file as
`judgment.rejected.json`. Nothing was merged.

Fix those errors once. Write the corrected file back to `judgmentOut` and run
`cockpit judge-merge <pr>` again.

If the second attempt is also rejected, stop trying. Mark the stage failed so the cockpit
stops promising work that is not coming:

```
cockpit mark-failed <pr> --stage 2 --message "the judgment pass was rejected twice"
```

Use a message that says what was wrong, in one line. Then go on to step 5 anyway: the
deterministic view is still worth opening. Do not try a third time, and never edit `review.json`
by hand.

## 4b. The judgment pass, headless

```
cockpit judge <pr> --headless
```

One command does the whole pass: it starts a headless Claude in the checkout with the same
prompt and only the reading tools, merges the answer, retries once if the merge rejects it, and
marks stage 2 failed on a second rejection. Your terminal is free while it runs, and its
progress goes to stderr as one line that rewrites itself:

```
judgment · 2m10s / ~4m30s · 9 files read · writing…
```

The last line of stdout is one line of JSON, and its status is what you relay:

```json
{"status":"ready","durationSeconds":262,"url":"http://127.0.0.1:8090"}
```

`"ready"` means the judgment is merged. `"failed"` means it was rejected twice or the run broke,
stage 2 is already marked failed, and the cockpit still has everything stage 1 produced. Either
way, go on to step 5.

## 5. Open the browser

```
cockpit open <pr>
```

That opens the cockpit on the running server and prints its URL. It is idempotent: called twice
it says the tab is already open rather than making a second one.

Tell the user it is ready, and that you are still here:

> The cockpit is open at http://127.0.0.1:8090: the diff with its risk heatmap, the summary, the
> reading order and a brief on every hunk. Start with Next, or ask me about any file, hunk or
> symbol in this pull request and I will read the code and answer.

If step 4 ended in a failure, say so plainly in the same message: the diff, the heatmap, the
comments and the checks are all stage 1, and none of them depend on the judgment.

## 6. Stay in the terminal

Wait. The user reads the diff in the browser and asks questions in the terminal.

Answer from the checkout at `prDir/worktree`, which is the repository at the pull request's
head commit. Read the files there rather than guessing from the diff. `prDir/review.json` has
every hunk with its risk and its reasons, and `prDir/compact.md` is the same pull request as
one text file.

Do not re-run the analysis, and do not post anything to GitHub. The user posts their review
from the cockpit themselves.

## 7. Clean up

When the user says "done", "finish", "clean up" or anything else that ends the review:

```
cockpit clean <pr>
```

That stops the server, removes the worktree it made, and deletes the ref it added to the clone
it checked out from. It keeps everything about the review itself. Report where those files are:

> Cleaned up. The server is stopped and the worktree is gone. What you wrote is
> kept in `<prDir>`: `review.json` is the analysed pull request, `drafts.json` holds any
> comment you did not send, and each review you posted is a `submitted-<timestamp>.json`.

Name the files that are actually there. If the user never drafted anything, do not claim a
drafts file.

Forgetting this step costs nothing: a server stops itself after 30 minutes with no cockpit
connected, and `cockpit gc`, which every `cockpit run` does a pass of, removes the worktree of
any review nobody has come back to for seven days. What the review is made of is never
collected.

## 8. Re-analyse after new commits

When the user says the author pushed new commits, or asks for a re-analysis:

```
cockpit run <pr> --reuse-server
```

`--reuse-server` keeps the server that is already running and leaves the user's open tab
alone, so the page reloads the new document by itself. Then do steps 3 and 4 again: the
judgment pass runs against the new diff. `cockpit open` in step 5 sees that tab and opens
nothing.

A `cockpit run` on a pull request whose head has not moved is cheap: it finds the cached
document, skips the analysis and serves what is on disk. It says so in its progress output.

## What the user sees

1. They type "cockpit 123" in Claude Code, or paste the pull request URL and ask for the cockpit.
2. Your message saying what is being analysed and how long the judgment is likely to take.
3. A few lines of progress while the judgment runs, and then a browser tab with the whole
   cockpit: the diff, the risk heatmap, the summary, the reading order and the existing comments.
4. They review in the browser: Next walks the order, `c` drafts a comment on a line, Submit
   posts one GitHub review. Their posted comments come back into the page as pinned threads
   within a few seconds.
5. They ask questions in the terminal, and you answer from the checkout.
6. They say "done", and the worktree and the server go away.

## When something fails

**`gh` is not authenticated.** `cockpit run` stops before it checks anything out. Tell the
user to run this, and stop:

```
gh auth login
```

Nothing else in this procedure works without it, so do not go on to step 4.

**No local clone of the repository.** `cockpit run` clones it into its own cache and keeps
going, so nothing is broken. Warn the user that the first review of a large repository is slow
for that reason, and that later reviews of the same repository reuse the clone. A clone the
tool can find takes a worktree instead, which is much faster; `~/.config/review-cockpit/config.json`
holds the `workspaceRoots` it searches.

**A server is already running for this pull request.** `cockpit run` uses it and starts
nothing, and its progress output says which port it reused. This is normal when the user
reviewed the same pull request earlier.

**The judgment pass failed.** Run `cockpit mark-failed` as step 4a describes, or let
`cockpit judge` do it, say so plainly, and go on to step 5. The cockpit is still useful without
a judgment.

**The user wants the cockpit now, before the judgment.** Run `cockpit open <pr>` at any point:
the server is up from the moment stage 1 finished, and the page fills in on its own as each
stage lands.

**Anything else fails.** Report the command and its error. Do not work around a broken step by
editing the files under `prDir` by hand. `cockpit doctor` checks the installation itself: the
node version, `gh` and its login, the build, this skill's link, and the config file.
