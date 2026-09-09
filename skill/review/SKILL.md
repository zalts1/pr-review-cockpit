---
name: review
description: >-
  Review a GitHub pull request in the PR Review Cockpit, a local web app that
  shows the diff with a risk level, a reading order and a brief on every hunk.
  Use when the user says "review <pr>", "review this PR", "open the cockpit for
  <pr>", or asks for help reviewing a pull request they name by number or URL.
  Accepts a pull request number, owner/repo#number, or a GitHub URL.
---

# Review a pull request in the cockpit

The `cockpit` command line tool does the work. You do one step of it: the judgment pass.
A deterministic analyzer has already parsed the diff and set a risk floor on every hunk.
You add the grouping, the reading order, the reasons and the brief.

At this milestone only the judgment pass is written down here. The steps around it are
marked M7 and are still run by hand.

## 1. Prepare and analyze — M7

M7 resolves the pull request, checks it out and runs the analyzer from this skill. Until
then the user runs it:

```
cockpit analyze <pr> --expect-judgment
```

`--expect-judgment` tells the cockpit that a judgment pass is coming, so it says
"Analyzing…" rather than "Not analyzed".

## 2. Serve and open the browser — M7

M7 starts the server and opens the cockpit. Until then the user runs `cockpit serve <pr>`.
The cockpit is usable from that moment; your judgment arrives in it live.

## 3. The judgment pass

This is your step. Run it as soon as the document exists. Do not wait for the browser.

```
cockpit judge-prompt <pr>
```

That prints one prompt: the instructions, the schema your output must match, the rules the
tool enforces, the shape of the summary, and the whole pull request as a compact view at
the end.

Follow that prompt literally. It tells you to open files in the checkout and read the code
around each change before you write anything. Do that. A judgment written from the diff
alone is the thing this tool exists to replace.

Write your output to the `judgment.json` path the prompt names. Write nothing else: not the
review document, not the checkout, no comment on the pull request.

Then merge it:

```
cockpit judge-merge <pr>
```

It validates your file, merges it, writes the document, and prints every proposal it
dropped or clamped. Read that log. A dropped group or a clamped risk level is a mistake of
yours worth knowing about.

### If it is rejected

The command exits non-zero, prints the first five errors, and keeps your file as
`judgment.rejected.json`. Nothing was merged.

Fix those errors once. Write the corrected file back to `judgment.json` and run
`cockpit judge-merge <pr>` again.

If the second attempt is also rejected, stop. Tell the user the pull request is open in the
cockpit with deterministic risk only, and give them the errors. Do not try a third time,
and do not edit the review document by hand.

## 4. Stay in the terminal

The user reads the diff in the browser and asks questions in the terminal. You still have
the checkout and the document, so answer from the code.

## 5. Clean up — M7

M7 runs `cockpit clean <pr>` when the user says they are done. It stops the server and
removes the worktree, and keeps the review document.
