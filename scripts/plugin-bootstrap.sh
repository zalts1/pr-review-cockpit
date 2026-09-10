#!/usr/bin/env bash
# SessionStart. A plugin install ships source, not dist/ or node_modules/, so the first
# session after an install or an update has to build before `cockpit` will run.
#
# It exits 0 on every path, including a failed build: a session has to start even when
# the cockpit cannot be built, and `cockpit doctor` is what reports why.
set -uo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cli_entry="$root/packages/cli/dist/cockpit.js"
ui_html="$root/packages/cockpit/dist/index.html"
stamp="$root/.bootstrap-stamp"
log="${CLAUDE_PLUGIN_DATA:-$root}/bootstrap.log"

version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$root/.claude-plugin/plugin.json" | head -1)

# This runs on every session start, so the fast path spawns as little as it can. A
# present dist/ is not enough on its own: the stamp is what distinguishes a build of
# this version from one left behind by the version an update replaced.
if [ -f "$cli_entry" ] && [ -f "$ui_html" ] && [ -f "$stamp" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$version" ]; then
  exit 0
fi

mkdir -p "$(dirname "$log")" 2>/dev/null
say() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >>"$log"; }

say "building v$version in $root"

node_major=$(node -v 2>/dev/null | sed -n 's/^v\([0-9]*\).*/\1/p')
if [ -z "$node_major" ]; then
  say 'node is not on PATH'
  printf 'cockpit: node is not on PATH, so the cockpit is not built. Install node 24 or newer, then start a new session.\n'
  exit 0
fi
if [ "$node_major" -lt 24 ]; then
  say "node v$node_major is too old"
  printf 'cockpit: node v%s is too old (24 or newer is needed), so the cockpit is not built.\n' "$node_major"
  exit 0
fi
if ! command -v gh >/dev/null 2>&1; then
  say 'gh is not on PATH'
  printf 'cockpit: the GitHub CLI (gh) is not on PATH, so the cockpit is not built. Install it from https://cli.github.com, then start a new session.\n'
  exit 0
fi

if ! (cd "$root" && npm ci --no-audit --no-fund && npm run build) >>"$log" 2>&1; then
  say "build failed for v$version"
  printf 'cockpit: the build failed, so `cockpit` will not run. The whole build log is at %s.\n' "$log"
  exit 0
fi

printf '%s' "$version" >"$stamp"
say "built v$version"
printf 'cockpit: built v%s\n' "$version"
