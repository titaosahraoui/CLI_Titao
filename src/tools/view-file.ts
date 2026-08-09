import { z } from 'zod';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import type { Tool, ToolResult } from './types.js';

function resolveProjectPath(inputPath: string): string {
  const cleaned = inputPath.trim().replace(/^[/\\]+/, '');
  return path.resolve(process.cwd(), cleaned);
}

export const viewFileTool: Tool = {
  name: 'view_file',
  description:
    'View the contents of a file. Returns line-numbered content. Use startLine/endLine to view specific sections of large files.',
  parameters: z.object({
    path: z.string().describe('Path to the file to view'),
    startLine: z.number().optional().describe('Start line number (1-indexed, inclusive)'),
    endLine: z.number().optional().describe('End line number (1-indexed, inclusive)'),
  }),
  permission: 'read',

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const rawPath = args.path as string;
    const filePath = resolveProjectPath(rawPath);
    const startLine = args.startLine as number | undefined;
    const endLine = args.endLine as number | undefined;

    try {
      const stats = await stat(filePath);
      if (stats.size > 5 * 1024 * 1024) {
        return {
          success: false,
          output: '',
          error: `File is too large (${(stats.size / 1024 / 1024).toFixed(1)} MB). Use startLine/endLine to view sections.`,
        };
      }

      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      const start = Math.max(0, (startLine ?? 1) - 1);
      const end = Math.min(totalLines, endLine ?? totalLines);
      const slice = lines.slice(start, end);

      const MAX_LINES = 500;
      const truncated = slice.length > MAX_LINES;
      const displayLines = truncated ? slice.slice(0, MAX_LINES) : slice;

      const output = displayLines
        .map((line, i) => `${String(start + i + 1).padStart(4)} | ${line}`)
        .join('\n');

      const header = `File: ${filePath} (${totalLines} lines total)`;
      const footer = truncated
        ? `\n... Showing ${MAX_LINES} of ${slice.length} lines. Use startLine/endLine to view more.`
        : '';

      return { success: true, output: `${header}\n${output}${footer}` };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { success: false, output: '', error: `File not found: ${filePath} (resolved from '${rawPath}')` };
      }
      return { success: false, output: '', error: `Failed to read file: ${err.message}` };
    }
  },
};
