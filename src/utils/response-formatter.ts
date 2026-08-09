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
 * Format thinking steps matching Antigravity CLI / Gemini CLI style:
 * ▸ Thought for 1s
 *   Short summary...
 */
export function formatThinkingUI(thinkingText: string, durationSec = 1): string {
  const lines = thinkingText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return '';

  const summary = lines[0] ?? 'Analyzing request...';

  return `\n  ${chalk.dim('▸')} ${chalk.bold.magenta(`Thought for ${durationSec}s`)}\n    ${chalk.dim(summary)}\n`;
}

/**
 * Format tool call invocation header matching Antigravity CLI / Gemini CLI style:
 * ● Create(src/path.ts)
 * ● Bash(node scripts/publish.js)
 * ● Edit(src/app.ts)
 * ● View(src/core/config.ts)
 */
export function formatToolCallUI(name: string, args: Record<string, unknown>): string {
  let actionName = 'Tool';
  let mainArg = '';

  switch (name) {
    case 'write_file':
      actionName = 'Create';
      mainArg = String(args.path ?? '');
      break;
    case 'edit_file':
      actionName = 'Edit';
      mainArg = String(args.path ?? '');
      break;
    case 'view_file':
      actionName = 'View';
      mainArg = String(args.path ?? '');
      break;
    case 'run_command':
      actionName = 'Bash';
      mainArg = String(args.command ?? '');
      break;
    case 'list_dir':
      actionName = 'List';
      mainArg = String(args.path ?? '.');
      break;
    case 'grep_search':
    case 'semantic_search':
      actionName = 'Search';
      mainArg = String(args.query ?? '');
      break;
    case 'git_status':
      actionName = 'GitStatus';
      mainArg = '';
      break;
    case 'git_diff':
      actionName = 'GitDiff';
      mainArg = String(args.path ?? '');
      break;
    case 'git_commit':
      actionName = 'GitCommit';
      mainArg = String(args.message ?? '');
      break;
    default:
      actionName = name.charAt(0).toUpperCase() + name.slice(1);
      mainArg = Object.values(args)[0] ? String(Object.values(args)[0]) : '';
  }

  const bullet = chalk.cyan('●');
  const actionStyled = chalk.cyan.bold(actionName);
  const targetStyled = chalk.dim(`(${mainArg})`);

  return `\n  ${bullet} ${actionStyled}${targetStyled}`;
}

/**
 * Format tool result output cleanly.
 */
export function formatToolResultUI(name: string, output: string, success: boolean): string {
  if (!success) {
    return `  ${chalk.red('❌')} ${chalk.red(output.trim())}`;
  }

  const lines = output.trim().split('\n');
  if (lines.length <= 3) {
    return `  ${chalk.dim('└─')} ${chalk.dim(lines.join(' '))}`;
  }

  return `  ${chalk.dim(`└─ ${lines[0]} (+${lines.length - 1} more lines)`)}`;
}
