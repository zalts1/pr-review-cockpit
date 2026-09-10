/** Every subcommand `cockpit` answers to. The skill test checks its text against this list. */
export const SUBCOMMANDS = [
  'run',
  'prepare',
  'analyze',
  'compact',
  'judge-prompt',
  'judge-merge',
  'mark-failed',
  'serve',
  'stop',
  'clean',
  'gc',
  'ps',
  'doctor',
  'validate',
  'merge',
] as const;

export type Subcommand = (typeof SUBCOMMANDS)[number];

export const usage = `cockpit — the PR review cockpit command line tool

Usage:
  cockpit run      <pr> [--reuse-server] [--port <n>] [--no-open] [--skip-graph]
                        [--idle-minutes <n>] [--session <id>] [--cwd <dir>]
  cockpit prepare  <pr> [--cwd <dir>]
  cockpit analyze  <pr> [--expect-judgment] [--no-fold-generated] [--skip-graph] [--cwd <dir>]
  cockpit compact  <pr> [--cwd <dir>]
  cockpit judge-prompt <pr> [--cwd <dir>]
  cockpit judge-merge  <pr> [--judgment <file>] [--cwd <dir>]
  cockpit mark-failed  <pr> --stage 2 --message <text> [--cwd <dir>]
  cockpit serve    <pr> [--port <n>] [--open] [--idle-minutes <n>] [--session <id>]
                        [--cwd <dir>]
  cockpit stop     <pr> | --all | --started-by <id>
  cockpit clean    <pr> [--cwd <dir>]
  cockpit gc       [--days <n>] [--dry-run]
  cockpit ps
  cockpit doctor
  cockpit validate <file> [--as document|judgment|drafts]
  cockpit merge <document> <judgment> [--out <file>]

<pr> is 123, owner/repo#123, or a GitHub pull request URL. A bare number is
read against the GitHub remote of the repository holding the working directory.

run       One command from a pull request to an open cockpit: prepare, stage 1,
          serve, open the browser, then the graph. The document is served and
          the browser opened as soon as stage 1 is on disk, so the cockpit is
          usable while the graph builds. Progress goes to stderr; the last line
          of stdout is JSON with url, prDir, compact, judgmentOut and headSha.
          A cached document at the pull request's current head is served as it
          is, with no analysis. --reuse-server keeps a server that is already
          running and leaves its browser tab alone. --no-open serves without
          opening a browser. --idle-minutes and --session are passed to the
          server it starts.

prepare   Resolves the pull request through gh and checks it out: a worktree on
          a local clone when one is found, a cached clone when not. Prints the
          checkout as JSON.

analyze   Runs prepare, then stage 1 (diff, git signals, tree-sitter structure,
          risk) and stage 3 (the Go call graph), writing review.json into the
          cache directory. Progress and timings go to stderr, the document path
          to stdout. --no-fold-generated keeps generated files unfolded and
          scored, and still records the rule that matched them.
          --expect-judgment says a judgment pass will follow, so the stage 2
          sections read as pending. Without it they carry the message
          "not-attached" and the cockpit says "Not analyzed" rather than
          "Analyzing…". The review skill always passes it.

compact   Rewrites compact.md next to review.json: the whole pull request as
          text for the judgment pass, at a fraction of the diff. analyze
          writes it too, so this is for regenerating it on its own.

judge-prompt
          Prints the complete judgment prompt for the pull request to stdout:
          the instructions, the judgment schema, the floor and merge rules, the
          shape of the summary, and the compact view at the end. The prompt
          says where to write judgment.json.

judge-merge
          Reads judgment.json next to review.json, validates it, merges it into
          the document and writes the document back, so an open cockpit picks
          it up. Prints what the merge dropped or clamped and appends it to
          log.txt. On a rejection nothing is written, the file is kept as
          judgment.rejected.json, and the first five errors are printed.
          --judgment reads the judgment from somewhere else.

mark-failed
          Marks a stage of the document failed with a message the cockpit
          shows. --stage 2 sets groups, path and summary, which is what a
          judgment pass that was rejected twice leaves behind.

serve     Serves the cockpit and the document on 127.0.0.1 and pushes every
          change to review.json over server-sent events. Prints the URL. A
          pull request whose server is already running prints that server's
          URL instead of starting a second one. It stops itself after 30
          minutes with no cockpit connected, telling any cockpit that is still
          there why; --idle-minutes changes that and 0 turns it off.
          --session records the Claude Code session that asked for it, so
          "cockpit stop --started-by" can find it later. The session is taken
          from CLAUDE_CODE_SESSION_ID when the flag is absent.

stop      Stops running servers and leaves everything else alone: one pull
          request, every one with --all, or every one a Claude Code session
          started with --started-by <id>. A pid that cannot be shown to be a
          cockpit server is never signalled, and a server.json whose process
          is gone is removed. Always exits 0, because the SessionEnd hook runs
          it while a session is closing.

clean     Stops the server, removes the worktree and the review-cockpit ref,
          and keeps review.json and drafts.json.

gc        Removes the checkout of every cached pull request with no server
          running and a review document older than --days, which defaults to
          7: the worktree and the refs/review-cockpit/ ref, both of which a
          later run makes again in seconds. It never touches review.json,
          drafts.json, judgment.json or a submitted-<ts>.json, and never runs
          git worktree prune, so a worktree another tool registered is safe.
          --dry-run prints what it would remove and removes nothing. cockpit
          run does a non-dry pass at the end of a successful start.

ps        Lists the servers that are running: the pull request, the port, the
          pid, how long ago it started, how long it has had no cockpit
          connected, and how many are connected now.

doctor    Checks the installation: the node version, gh and its login, the
          built cockpit and CLI, the review skill's symlink, and the optional
          config file with its workspace roots, and how many servers are
          running. Prints a table and exits non-zero when something has to be
          fixed.

validate  Checks a file against its JSON Schema and the referential rules.
          The kind is detected from the file unless --as says otherwise.
          Prints every error and warning and exits non-zero on an error.

merge     Applies a judgment file to a review document: clamps risk to the
          floor, assigns group ids, renumbers the walk, caps the reasons and
          recomputes the counts. Prints the log of everything it dropped or
          clamped. Writes the merged document to --out, or to stdout.
`;
