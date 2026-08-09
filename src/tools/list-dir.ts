import { z } from 'zod';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import type { Tool, ToolResult } from './types.js';

export const listDirTool: Tool = {
  name: 'list_dir',
  description: 'List the contents of a directory, showing files and subdirectories with their sizes.',
  parameters: z.object({
    path: z.string().describe('Path to the directory to list').default('.'),
  }),
  permission: 'read',

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const dirPath = path.resolve(args.path as string);

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      // Filter out common noise
      const filtered = entries.filter(
        (e) => !['node_modules', '.git', '.DS_Store', '__pycache__'].includes(e.name),
      );

      const results: string[] = [];

      for (const entry of filtered.sort((a, b) => {
        // Directories first, then files
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          results.push(`📁 ${entry.name}/`);
        } else {
          try {
            const stats = await stat(fullPath);
            const size = formatSize(stats.size);
            results.push(`📄 ${entry.name} (${size})`);
          } catch {
            results.push(`📄 ${entry.name}`);
          }
        }
      }

      if (results.length === 0) {
        return { success: true, output: `Directory is empty: ${dirPath}` };
      }

      return {
        success: true,
        output: `Contents of ${dirPath}:\n${results.join('\n')}`,
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { success: false, output: '', error: `Directory not found: ${dirPath}` };
      }
      return { success: false, output: '', error: `Failed to list directory: ${err.message}` };
    }
  },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
