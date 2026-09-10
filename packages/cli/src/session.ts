/**
 * Claude Code exports `CLAUDE_CODE_SESSION_ID` to the Bash tool it runs `cockpit` from, and its
 * `SessionEnd` hook payload carries the same value as `session_id`. The hook documentation lists
 * neither environment variable, so `CLAUDE_SESSION_ID` is accepted as well rather than betting on
 * one spelling.
 */
export function sessionIdFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const name of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID']) {
    const value = env[name];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return undefined;
}
