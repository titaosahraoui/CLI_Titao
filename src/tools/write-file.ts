import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import type { Tool, ToolResult } from './types.js';

function resolveProjectPath(inputPath: string): string {
  const cleaned = inputPath.trim().replace(/^[/\\]+/, '');
  return path.resolve(process.cwd(), cleaned);
}

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Create a new file or overwrite an existing file with the given content. Parent directories will be created automatically.',
  parameters: z.object({
    path: z.string().describe('Path for the file to create or overwrite'),
    content: z.string().describe('The full content to write to the file'),
  }),
  permission: 'write',

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const filePath = resolveProjectPath(args.path as string);
    const content = args.content as string;

    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');

      const lineCount = content.split('\n').length;
      return {
        success: true,
        output: `Successfully wrote ${lineCount} lines to ${filePath}`,
      };
    } catch (err: any) {
      return { success: false, output: '', error: `Failed to write file: ${err.message}` };
    }
  },
};
