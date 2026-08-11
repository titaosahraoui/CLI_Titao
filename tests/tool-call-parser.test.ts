import { describe, expect, it } from 'vitest';
import { parseToolCallsFromText } from '../src/providers/tool-call-parser.js';

describe('parseToolCallsFromText', () => {
  it('does not execute JSON examples in prose', () => {
    const text =
      'Example:\n```json\n{"name":"run_command","arguments":{"command":"echo unsafe"}}\n```';
    const parsed = parseToolCallsFromText(text, ['run_command']);

    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.text).toBe(text);
  });

  it('parses an explicitly delimited fallback call', () => {
    const parsed = parseToolCallsFromText(
      '<tool_call>{"name":"view_file","arguments":{"path":"README.md"}}</tool_call>',
      ['view_file'],
    );

    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].function).toEqual({
      name: 'view_file',
      arguments: { path: 'README.md' },
    });
    expect(parsed.text).toBe('');
  });

  it('leaves invalid or unavailable delimited calls in the response text', () => {
    const text =
      'keep <tool_call>{"name":"run_command","arguments":{"command":"echo unsafe"}}</tool_call>';
    const parsed = parseToolCallsFromText(text, ['view_file']);

    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.text).toBe(text);
  });

  it('requires arguments to be a non-array object', () => {
    const text = '<tool_call>{"name":"view_file","arguments":"README.md"}</tool_call>';
    const parsed = parseToolCallsFromText(text, ['view_file']);

    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.text).toBe(text);
  });
});
