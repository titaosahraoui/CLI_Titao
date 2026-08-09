import type { ToolCall } from './types.js';

/**
 * Extracts tool calls from response text if the model printed tool calls
 * as raw JSON or XML text blocks rather than native OpenAI API structs.
 * Uses balanced bracket parsing to handle nested JSON objects properly.
 */
export function parseToolCallsFromText(
  text: string,
  availableTools: string[],
): { text: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  let cleanText = text;

  let idx = 0;
  while ((idx = text.indexOf('{', idx)) !== -1) {
    let depth = 0;
    let endIdx = -1;
    let inString = false;
    let escape = false;

    for (let i = idx; i < text.length; i++) {
      const char = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') depth++;
        else if (char === '}') {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
    }

    if (endIdx !== -1) {
      const jsonCandidate = text.slice(idx, endIdx + 1);
      try {
        const parsed = JSON.parse(jsonCandidate);
        const toolName =
          parsed.name ?? parsed.function ?? parsed.action ?? parsed.tool;
        const toolArgs =
          parsed.arguments ?? parsed.parameters ?? parsed.action_input ?? parsed.args ?? {};

        if (
          toolName &&
          typeof toolName === 'string' &&
          availableTools.includes(toolName)
        ) {
          toolCalls.push({
            id: `text_call_${Date.now()}_${toolCalls.length}`,
            type: 'function',
            function: {
              name: toolName,
              arguments: typeof toolArgs === 'object' ? toolArgs : { input: toolArgs },
            },
          });

          cleanText = cleanText.replace(jsonCandidate, '').trim();
          idx = endIdx + 1;
          continue;
        }
      } catch {
        // Ignore non-JSON or non-tool objects
      }
    }
    idx++;
  }

  // Strip markdown code block wrappers
  cleanText = cleanText
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  return { text: cleanText, toolCalls };
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
