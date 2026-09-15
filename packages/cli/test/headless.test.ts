import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { judgmentFromText, newProgress, parseStream, progressLine } from '../src/headless.js';
import { ALLOWED_TOOLS, claudeArgs } from '../src/commands/judge.js';

const JUDGMENT = '/cache/northwind-labs/tenant-platform/pr-1234/judgment.json';

const transcript = readFileSync(new URL('./stream-json.jsonl', import.meta.url), 'utf8');

describe('the stream-json progress parser', () => {
  it('reads a whole transcript', () => {
    const state = parseStream(transcript, JUDGMENT);

    expect(state.sessionId).toBe('0c3d5f2a-1111-4c2b-9a77-8f0e2b6d41aa');
    expect(state.reads).toBe(3);
    expect(state.writing).toBe(true);
    expect(state.done).toBe(true);
    expect(state.isError).toBe(false);
  });

  it('counts only the main conversation, not a subagent it spawned', () => {
    const subagentOnly = transcript
      .split('\n')
      .filter((line) => line.includes('"parent_tool_use_id":"toolu_99"'))
      .join('\n');

    expect(parseStream(subagentOnly, JUDGMENT).reads).toBe(0);
  });

  it('turns a half-finished run into the line the terminal shows', () => {
    const upToTheGlob = transcript.split('\n').slice(0, 7).join('\n');
    const state = parseStream(upToTheGlob, JUDGMENT);

    expect(state.writing).toBe(false);
    expect(progressLine(state, 130, 270)).toBe('judgment · 2m10s / ~4m30s · 3 files read');
    expect(progressLine(parseStream(transcript, JUDGMENT), 271, 270)).toBe(
      'judgment · 4m31s / ~4m30s · 3 files read · writing…',
    );
  });

  it('says it is starting before the first read, and drops the estimate when there is none', () => {
    expect(progressLine(newProgress(), 3, null)).toBe('judgment · 3s · starting…');
  });

  it('carries the failure of a run that ended badly', () => {
    const failed = `${transcript.split('\n').slice(0, 3).join('\n')}\n${JSON.stringify({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      session_id: 'x',
      result: 'the model ran out of turns',
    })}`;
    const state = parseStream(failed, JUDGMENT);

    expect(state.isError).toBe(true);
    expect(state.error).toBe('the model ran out of turns');
  });

  it('ignores a line that is not an event', () => {
    expect(parseStream('not json at all\n', JUDGMENT).reads).toBe(0);
  });
});

describe('the judgment in a final message', () => {
  it('takes the object out of a fenced answer', () => {
    const text = 'Here it is:\n\n```json\n{ "schemaVersion": "1.3.0" }\n```\n';
    expect(judgmentFromText(text)).toBe('{ "schemaVersion": "1.3.0" }');
  });

  it('takes a bare object with prose round it', () => {
    expect(judgmentFromText('Done. {"a":1} That is all.')).toBe('{"a":1}');
  });

  it('is null when the message holds no JSON', () => {
    expect(judgmentFromText('I could not write the file.')).toBeNull();
    expect(judgmentFromText('{ broken')).toBeNull();
  });
});

describe('what claude -p is started with', () => {
  it('streams events and denies anything the pass was not given', () => {
    const args = claudeArgs({
      prompt: 'x',
      cwd: '/cache/worktree',
      judgmentPath: JUDGMENT,
      timeoutMs: 1000,
      onProgress: () => undefined,
      model: 'opus',
    });

    expect(args.slice(0, 6)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'dontAsk',
    ]);
    expect(args).toEqual(expect.arrayContaining(['--model', 'opus']));
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(ALLOWED_TOOLS.join(','));
  });

  it('allows the reads and the read-only git commands, and nothing that writes', () => {
    expect(ALLOWED_TOOLS).toContain('Read');
    expect(ALLOWED_TOOLS).toContain('Bash(git log *)');
    expect(
      ALLOWED_TOOLS.some((rule) => rule.startsWith('Write') || rule.startsWith('Edit')),
    ).toBe(false);
  });
});
