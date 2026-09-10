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

Run the steps below in order. Step 3 is yours and no other process does it: skip it and the
cockpit shows deterministic risk with no groups, no reading order and no brief.

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

## 2. Open the cockpit

```
cockpit run <pr>
```

That one command resolves the pull request, checks it out, runs stage 1 of the analysis,
starts the server, opens the browser, and then builds the call graph. Progress goes to stderr,
one line per stage with its elapsed time. The last line of stdout is one line of JSON:

```json
{"url":"http://127.0.0.1:8090","prDir":"…/pr-123","compact":"…/pr-123/compact.md","judgmentOut":"…/pr-123/judgment.json","headSha":"…"}
```

It is the only line of output that starts with `{`; every other line is progress on stderr.

Read that line and keep the values. `url` is the cockpit, `judgmentOut` is where your judgment
file goes in step 3, and `prDir` holds everything about this review, including the checkout at
`prDir/worktree`.

Tell the user the URL as soon as the command returns, and tell them what is not ready yet:

> The cockpit is open at http://127.0.0.1:8090. The diff, the risk heatmap, the existing
> comments and the checks are there now. The summary, the groups and the reading order are
> still being analysed — I am writing them next, and they will appear in the page on their own.

Then go straight to step 3. Do not wait for the user to answer.

## 3. The judgment pass

```
cockpit judge-prompt <pr>
```

That prints one prompt: the instructions, the JSON Schema your output must match, the rules
the tool enforces, the shape of the summary, and the whole pull request as a compact view at
the end.

Follow that prompt exactly. It tells you to open files from the checkout and read the code
around each change before you write anything. Do that. A judgment written from the diff alone
is the thing this tool exists to replace.

Write your output to the `judgmentOut` path from step 2, which is the path the prompt names
too. Write nothing else: not the review document, not the checkout, and no comment on the pull
request. Then merge it:

```
cockpit judge-merge <pr>
```

It validates your file, merges it into the document, writes the document, and prints every
proposal it dropped or clamped. The open cockpit picks the new document up on its own. Read
the merge log: a dropped group or a clamped risk level is a mistake of yours worth knowing
about.

### If the merge rejects your file

The command exits non-zero, prints the first five errors, and keeps your file as
`judgment.rejected.json`. Nothing was merged, so the cockpit still says the stage 2 sections
are being analysed.

Fix those errors once. Write the corrected file back to `judgmentOut` and run
`cockpit judge-merge <pr>` again.

If the second attempt is also rejected, stop trying. Mark the stage failed so the cockpit
stops promising work that is not coming:

```
cockpit mark-failed <pr> --stage 2 --message "the judgment pass was rejected twice"
```

Use a message that says what was wrong, in one line. Then tell the user the pull request is
open in the cockpit with deterministic risk only, give them the errors, and carry on with
step 4. Do not try a third time, and never edit `review.json` by hand.

## 4. Stay in the terminal

Tell the user the walk is ready, and that you are still here:

> The reading order and the brief are in the cockpit now. Start with Next, or ask me about any
> file, hunk or symbol in this pull request and I will read the code and answer.

Then wait. The user reads the diff in the browser and asks questions in the terminal.

Answer from the checkout at `prDir/worktree`, which is the repository at the pull request's
head commit. Read the files there rather than guessing from the diff. `prDir/review.json` has
every hunk with its risk and its reasons, and `prDir/compact.md` is the same pull request as
one text file.

Do not re-run the analysis, and do not post anything to GitHub. The user posts their review
from the cockpit themselves.

## 5. Clean up

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

## 6. Re-analyse after new commits

When the user says the author pushed new commits, or asks for a re-analysis:

```
cockpit run <pr> --reuse-server
```

`--reuse-server` keeps the server that is already running and leaves the user's open tab
alone, so the page reloads the new document by itself. Then do step 3 again: the judgment pass
runs against the new diff.

A `cockpit run` on a pull request whose head has not moved is cheap: it finds the cached
document, skips the analysis and serves what is on disk. It says so in its progress output.

## What the user sees

1. They type "cockpit 123" in Claude Code, or paste the pull request URL and ask for the cockpit.
2. About a minute of progress lines in the terminal, one per stage.
3. A browser tab with the diff, the risk heatmap, the existing comments and the checks. The
   summary, the groups and the reading order say they are being analysed.
4. Your message with the URL, and then a second message when the walk is ready.
5. They review in the browser: Next walks the order, `c` drafts a comment on a line, Submit
   posts one GitHub review. Their posted comments come back into the page as pinned threads
   within a few seconds.
6. They ask questions in the terminal, and you answer from the checkout.
7. They say "done", and the worktree and the server go away.

## When something fails

**`gh` is not authenticated.** `cockpit run` stops before it checks anything out. Tell the
user to run this, and stop:

```
gh auth login
```

Nothing else in this procedure works without it, so do not go on to step 3.

**No local clone of the repository.** `cockpit run` clones it into its own cache and keeps
going, so nothing is broken. Warn the user that the first review of a large repository is slow
for that reason, and that later reviews of the same repository reuse the clone. A clone the
tool can find takes a worktree instead, which is much faster; `~/.config/review-cockpit/config.json`
holds the `workspaceRoots` it searches.

**A server is already running for this pull request.** `cockpit run` uses it and starts
nothing, and its progress output says which port it reused. This is normal when the user
reviewed the same pull request earlier. Give them that URL.

**The judgment pass was rejected twice.** Run `cockpit mark-failed` as step 3 describes, say
so plainly, and keep going. The cockpit is still useful: the diff, the heatmap, the comments
and the checks are all stage 1, and none of them depend on your judgment.

**Anything else fails.** Report the command and its error. Do not work around a broken step by
editing the files under `prDir` by hand. `cockpit doctor` checks the installation itself: the
node version, `gh` and its login, the build, this skill's link, and the config file.
