/**
 * Cursor Bugbot's markers around the summary it writes into the pull request
 * body. The analyzer parses the same block into `botSummaries`, and the header
 * pill shows it, so leaving it in the description would show it twice.
 */
const BOT_SUMMARY_BLOCK = /\n*<!--\s*(\w+)_SUMMARY\s*-->[\s\S]*?<!--\s*\/\1_SUMMARY\s*-->/gi;

export function description(body: string): string {
  return body.replace(BOT_SUMMARY_BLOCK, '').trim();
}
