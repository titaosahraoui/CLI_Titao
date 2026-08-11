import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Tool, ToolResult } from './types.js';
import { resolveWithinWorkspace } from '../core/workspace-boundary.js';

const execFileAsync = promisify(execFile);

export const grepSearchTool: Tool = {
  name: 'grep_search',
  description:
    'Search for text patterns in files using ripgrep. Returns matching lines with file paths and line numbers. Use includes to filter by file type.',
  parameters: z.object({
    query: z.string().describe('Text or regex pattern to search for'),
    path: z
      .string()
      .optional()
      .describe('Directory or file to search in (default: current directory)'),
    includes: z
      .array(z.string())
      .optional()
      .describe('Glob patterns to filter files, e.g. ["*.ts", "*.js"]'),
    isRegex: z.boolean().optional().describe('Treat query as regex pattern (default: false)'),
    caseSensitive: z.boolean().optional().describe('Case-sensitive search (default: true)'),
  }),
  permission: 'read',

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const query = args.query as string;
    const includes = args.includes as string[] | undefined;
    const isRegex = (args.isRegex as boolean | undefined) ?? false;
    const caseSensitive = (args.caseSensitive as boolean | undefined) ?? true;
    let searchPath: string;

    try {
      searchPath = await resolveWithinWorkspace(
        process.cwd(),
        (args.path as string | undefined) ?? '.',
        'read',
      );
    } catch (err: any) {
      return { success: false, output: '', error: `Search failed: ${err.message}` };
    }

    // Build ripgrep arguments
    const rgArgs: string[] = [
      '--no-heading',
      '--line-number',
      '--max-count',
      '100',
      '--max-columns',
      '200',
      '--color',
      'never',
    ];

    if (!caseSensitive) rgArgs.push('-i');
    if (!isRegex) rgArgs.push('--fixed-strings');

    // Add include patterns
    if (includes) {
      for (const pattern of includes) {
        rgArgs.push('-g', pattern);
      }
    }

    // Exclude common noise directories
    rgArgs.push('-g', '!node_modules', '-g', '!.git', '-g', '!dist', '-g', '!build');

    rgArgs.push('--', query, searchPath);

    try {
      const { stdout } = await execFileAsync('rg', rgArgs, {
        maxBuffer: 2 * 1024 * 1024,
        timeout: 15000,
      });

      const lines = stdout.trim().split('\n').filter(Boolean);

      if (lines.length === 0) {
        return { success: true, output: 'No matches found.' };
      }

      const output =
        lines.length > 50
          ? lines.slice(0, 50).join('\n') + `\n\n... (${lines.length - 50} more matches truncated)`
          : lines.join('\n');

      return { success: true, output: `Found ${lines.length} match(es):\n${output}` };
    } catch (err: any) {
      // Exit code 1 means no matches (not an error)
      if (err.code === 1 || err.status === 1) {
        return { success: true, output: 'No matches found.' };
      }
      if (err.code === 'ENOENT') {
        // Ripgrep not installed — fall back to native search
        return {
          success: false,
          output: '',
          error:
            'ripgrep (rg) is not installed. Please install it:\n  Windows: winget install BurntSushi.ripgrep.MSVC\n  macOS: brew install ripgrep\n  Linux: apt install ripgrep',
        };
      }
      return { success: false, output: '', error: `Search failed: ${err.message}` };
    }
  },
};
