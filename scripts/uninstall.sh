#!/usr/bin/env bash
# Reverses scripts/install.sh: unlinks the cockpit command and the cockpit skill.
# The cache of analysed pull requests is left alone. Idempotent.
set -uo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cli_entry="$root/packages/cli/dist/cockpit.js"
skill_source="$root/skills/cockpit"
skill_link="$HOME/.claude/skills/cockpit"
local_bin_link="$HOME/.local/bin/cockpit"
cache="${REVIEW_COCKPIT_CACHE:-$HOME/.cache/review-cockpit}"

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
note() { printf '   %s\n' "$1"; }

step "The cockpit command"
if npm rm --global @review-cockpit/cli >/dev/null 2>&1; then
  note "removed the global npm link"
else
  note "no global npm link to remove"
fi

if [ -L "$local_bin_link" ]; then
  target=$(readlink "$local_bin_link")
  if [ "$target" = "$cli_entry" ]; then
    rm "$local_bin_link"
    note "removed $local_bin_link"
  else
    note "left $local_bin_link alone: it points at $target, not at this checkout"
  fi
else
  note "no symlink at $local_bin_link"
fi

step "The cockpit skill"
if [ -L "$skill_link" ]; then
  current=$(cd "$(dirname "$skill_link")" && cd "$(readlink "$skill_link")" 2>/dev/null && pwd)
  if [ "$current" = "$skill_source" ] || [ -z "$current" ]; then
    rm "$skill_link"
    note "removed $skill_link"
  else
    note "left $skill_link alone: it points at $current, not at this checkout"
  fi
elif [ -e "$skill_link" ]; then
  note "left $skill_link alone: it is a directory of its own, not a link this script made"
else
  note "no link at $skill_link"
fi

step "What is kept"
note "$cache holds every analysed pull request, its drafts and the reviews you posted."
note "Delete it yourself if you want it gone: rm -rf \"$cache\""
note "$root is untouched. Delete the checkout to finish."
