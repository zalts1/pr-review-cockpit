#!/usr/bin/env bash
# SessionEnd. Stops the cockpit servers this session started, so a session that ends leaves
# nothing running. It exits 0 on every path: a session is already closing, and there is nothing
# useful a failure here could tell anyone.
#
# Claude Code gives SessionEnd hooks a 1.5-second budget between them all, and a timeout set on
# a plugin's own hook does not raise it, so everything below has to be quick.
set -uo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
log="${CLAUDE_PLUGIN_DATA:-$root}/session-end.log"

payload=$(cat)
# The documented SessionEnd payload is {session_id, transcript_path, cwd, hook_event_name,
# reason}. jq is not a dependency of this plugin, so the id comes out with sed.
session=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
reason=$(printf '%s' "$payload" | sed -n 's/.*"reason"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

mkdir -p "$(dirname "$log")" 2>/dev/null
say() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >>"$log"; }

if [ -n "$session" ]; then
  say "session $session ended (${reason:-unknown}): stopping its servers"
  set -- --started-by "$session"
else
  say "session ended (${reason:-unknown}) with no session_id in the payload, so every server is stopped"
  set -- --all
fi

if ! out=$("$root/bin/cockpit" stop "$@" 2>&1); then
  say "cockpit stop $* failed"
fi
printf '%s\n' "$out" | sed '/^$/d' >>"$log"
exit 0
