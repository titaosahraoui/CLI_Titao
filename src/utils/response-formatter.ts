import chalk from 'chalk';
import { marked } from 'marked';
// @ts-ignore
import MarkedTerminal from 'marked-terminal';

// Configure marked to render markdown nicely in terminal using marked-terminal
marked.setOptions({
  renderer: new MarkedTerminal({
    code: chalk.yellow,
    blockquote: chalk.gray.italic,
    html: chalk.gray,
    heading: chalk.bold.cyan,
    firstHeading: chalk.bold.cyan.underline,
    strong: chalk.bold.white,
    em: chalk.italic.magenta,
    strikethrough: chalk.strikethrough,
    link: chalk.blue.underline,
    href: chalk.blue.underline,
    table: chalk.gray,
    tab: 2,
  }),
});

/**
 * Render Markdown text into colorful terminal output.
 */
export function renderTerminalMarkdown(markdownText: string): string {
  if (!markdownText.trim()) return '';
  try {
    const rendered = marked.parse(markdownText) as string;
    return rendered.trim();
  } catch {
    return markdownText;
  }
}

/**
 * Parses and separates thinking blocks (<think>...</think>) from response content.
 */
export interface ParsedResponse {
  thinking: string[];
  content: string;
}

export function parseThinkingBlocks(rawText: string): ParsedResponse {
  const thinking: string[] = [];
  let content = rawText;

  // Regex to extract <think>...</think> blocks (DeepSeek, Qwen reasoning tags)
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;

  let match: RegExpExecArray | null;
  while ((match = thinkRegex.exec(rawText)) !== null) {
    const thinkText = match[1].trim();
    if (thinkText) {
      thinking.push(thinkText);
    }
  }

  // Remove <think>...</think> from main content
  content = content.replace(thinkRegex, '').trim();

  // Also handle unclosed <think> tag if model is still thinking
  if (content.startsWith('<think>')) {
    const thinkText = content.replace('<think>', '').trim();
    thinking.push(thinkText);
    content = '';
  }

  return { thinking, content };
}

/**
 * Format thinking steps nicely for terminal display (Claude Code / Antigravity style).
 */
export function formatThinkingUI(thinkingText: string): string {
  const lines = thinkingText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return '';

  const formattedLines = lines
    .map((line) => `     ${chalk.dim('│')} ${chalk.dim.italic(line)}`)
    .join('\n');

  return `\n  ${chalk.magenta('💭 Thinking:')}\n${formattedLines}\n`;
}

/**
 * Format tool call invocation header for terminal display.
 */
export function formatToolCallUI(name: string, args: Record<string, unknown>): string {
  const argPairs = Object.entries(args)
    .map(([k, v]) => {
      const valStr = typeof v === 'string' ? `"${v}"` : JSON.stringify(v);
      return `${chalk.dim(k)}: ${chalk.cyan(valStr)}`;
    })
    .join(', ');

  return `\n  ${chalk.cyan('⚙')} ${chalk.bold.cyan(name)}${chalk.dim('(')}${argPairs}${chalk.dim(')')}`;
}

/**
 * Format tool result output.
 */
export function formatToolResultUI(name: string, output: string, success: boolean): string {
  if (!success) {
    return `  ${chalk.red('❌')} ${chalk.red(output.trim())}`;
  }

  const lines = output.trim().split('\n');
  const summary =
    lines.length > 8
      ? lines.slice(0, 8).join('\n  │ ') + `\n  │ ${chalk.dim(`... (${lines.length - 8} more lines)`)}`
      : lines.join('\n  │ ');

  return `  ${chalk.green('✓')} ${chalk.dim(`[${name}]`)}\n  │ ${chalk.dim(summary)}`;
}
