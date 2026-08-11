import type { ToolCall } from './types.js';

const TOOL_CALL_BLOCK = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;

/** Extract explicitly delimited fallback calls from providers without native tool calling. */
export function parseToolCallsFromText(
  text: string,
  availableTools: string[],
): { text: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  const withoutParsedBlocks = text.replace(TOOL_CALL_BLOCK, (block, payload: string) => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return block;
      const candidate = parsed as Record<string, unknown>;
      const args = candidate.arguments;
      if (
        typeof candidate.name !== 'string' ||
        !availableTools.includes(candidate.name) ||
        args === null ||
        typeof args !== 'object' ||
        Array.isArray(args)
      ) {
        return block;
      }

      toolCalls.push({
        id: `text_call_${Date.now()}_${toolCalls.length}`,
        type: 'function',
        function: {
          name: candidate.name,
          arguments: args as Record<string, unknown>,
        },
      });
      return '';
    } catch {
      return block;
    }
  });

  return {
    text: toolCalls.length > 0 ? withoutParsedBlocks.trim() : text,
    toolCalls,
  };
}

/**
 * Clean path helper to prevent /src/... leading slash issues on Windows.
 */
export function normalizeFilePath(rawPath: string): string {
  let cleaned = rawPath.trim();
  if (cleaned.startsWith('/') || cleaned.startsWith('\\')) {
    cleaned = cleaned.replace(/^[/\\]+/, '');
  }
  return cleaned;
}
