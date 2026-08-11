import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import type { Tool, ToolResult } from './types.js';
import { resolveWithinWorkspace } from '../core/workspace-boundary.js';

export const editFileTool: Tool = {
  name: 'edit_file',
  description:
    'Edit a file by replacing exact text. The search text must match the file content exactly, including whitespace and indentation. Use view_file first to see the exact content.',
  parameters: z.object({
    path: z.string().describe('Path to the file to edit'),
    search: z.string().describe('Exact text to find in the file (must match precisely)'),
    replace: z.string().describe('Text to replace the search text with'),
  }),
  permission: 'write',

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const rawPath = args.path as string;
    const search = args.search as string;
    const replace = args.replace as string;

    try {
      const filePath = await resolveWithinWorkspace(process.cwd(), rawPath, 'write');
      const content = await readFile(filePath, 'utf-8');

      if (!content.includes(search)) {
        const trimmedSearch = search.trim();
        const contentLines = content.split('\n');
        const candidates = contentLines
          .map((line, i) => ({ line: line.trim(), num: i + 1 }))
          .filter((l) => l.line.includes(trimmedSearch.split('\n')[0].trim()))
          .slice(0, 3);

        let hint = 'Search text not found in file.';
        if (candidates.length > 0) {
          hint += ` Similar content found near line(s): ${candidates.map((c) => c.num).join(', ')}. Use view_file to see exact content.`;
        } else {
          hint += ' Use view_file to see the exact file content first.';
        }

        return { success: false, output: '', error: hint };
      }

      const occurrences = content.split(search).length - 1;
      if (occurrences > 1) {
        return {
          success: false,
          output: '',
          error: `Found ${occurrences} occurrences of the search text. Include more surrounding context to uniquely identify the target.`,
        };
      }

      const newContent = content.replace(search, replace);
      await writeFile(filePath, newContent, 'utf-8');

      const searchLines = search.split('\n').length;
      const replaceLines = replace.split('\n').length;

      return {
        success: true,
        output: `Edited ${filePath}: replaced ${searchLines} line(s) with ${replaceLines} line(s).`,
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { success: false, output: '', error: `File not found: ${rawPath}` };
      }
      return { success: false, output: '', error: `Edit failed: ${err.message}` };
    }
  },
};
