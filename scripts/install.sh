#!/usr/bin/env bash
# Installs the PR review cockpit for the current user: builds it, puts the cockpit
# command on PATH, and registers the review skill with Claude Code. Idempotent.
set -uo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cli_entry="$root/packages/cli/dist/cockpit.js"
skill_source="$root/skill/review"
skill_link="$HOME/.claude/skills/review"
local_bin="$HOME/.local/bin"

problems=0

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
note() { printf '   %s\n' "$1"; }
problem() {
  printf '   %s\n' "$1"
  problems=$((problems + 1))
}

step "Dependencies"
if ! (cd "$root" && npm install); then
  problem "npm install failed. Fix that first: nothing below will work without it."
  exit 1
fi

step "Build"
if ! (cd "$root" && npm run build); then
  problem "npm run build failed, so there is no cockpit to link. Fix the build and run this again."
  exit 1
fi

step "The cockpit command"
linked=""
if (cd "$root/packages/cli" && npm link) >/dev/null 2>&1; then
  resolved=$(command -v cockpit || true)
  if [ -n "$resolved" ]; then
    linked="npm link ($resolved)"
  fi
fi

if [ -z "$linked" ]; then
  # npm link needs a writable global prefix, and a Homebrew or system node often has none
  # the user owns. A symlink in their own bin directory needs no privileges at all.
  mkdir -p "$local_bin"
  if ln -sfn "$cli_entry" "$local_bin/cockpit"; then
    linked="symlink ($local_bin/cockpit)"
    case ":$PATH:" in
      *":$local_bin:"*) ;;
      *) problem "$local_bin is not on your PATH. Add it: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
    esac
  else
    problem "the cockpit command could not be linked. Run it as: node $cli_entry"
  fi
fi
[ -n "$linked" ] && note "linked by $linked"

step "The review skill"
mkdir -p "$(dirname "$skill_link")"
if [ -L "$skill_link" ]; then
  current=$(cd "$(dirname "$skill_link")" && cd "$(readlink "$skill_link")" 2>/dev/null && pwd)
  ln -sfn "$skill_source" "$skill_link"
  if [ "$current" = "$skill_source" ]; then
    note "already linked: $skill_link -> $skill_source"
  else
    note "relinked from ${current:-a broken link}: $skill_link -> $skill_source"
  fi
elif [ -e "$skill_link" ]; then
  problem "$skill_link already exists and is not a symlink, so it was left alone."
  problem "Move it aside and run this script again: mv \"$skill_link\" \"$skill_link.backup\""
else
  ln -s "$skill_source" "$skill_link"
  note "linked: $skill_link -> $skill_source"
fi

step "Checks"
if [ -n "$linked" ] && command -v cockpit >/dev/null 2>&1; then
  cockpit doctor || problems=$((problems + 1))
else
  node "$cli_entry" doctor || problems=$((problems + 1))
fi

if [ "$problems" -gt 0 ]; then
  printf '\n%s thing(s) need your attention above.\n' "$problems"
  exit 1
fi

cat <<'DONE'

Installed. In Claude Code, from inside a clone of the repository you want to review:

  review 123

or "review https://github.com/owner/repo/pull/123" from anywhere.
DONE
