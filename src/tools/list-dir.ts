import { z } from 'zod';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import type { Tool, ToolResult } from './types.js';
import { resolveWithinWorkspace } from '../core/workspace-boundary.js';

export const listDirTool: Tool = {
  name: 'list_dir',
  description:
    'List the contents of a directory, showing files and subdirectories with their sizes.',
  parameters: z.object({
    path: z.string().describe('Path to the directory to list').default('.'),
  }),
  permission: 'read',

  async execute(args: Record<string, any>): Promise<ToolResult> {
    let targetPath: string;
    let wasFileFallback = false;

    try {
      targetPath = await resolveWithinWorkspace(process.cwd(), args.path as string, 'read');
    } catch (err: any) {
      return { success: false, output: '', error: `Failed to list directory: ${err.message}` };
    }

    // Check if targetPath is a file instead of a directory
    try {
      const pathStat = await stat(targetPath);
      if (pathStat.isFile()) {
        wasFileFallback = true;
        targetPath = path.dirname(targetPath);
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { success: false, output: '', error: `Path not found: ${targetPath}` };
      }
    }

    try {
      const entries = await readdir(targetPath, { withFileTypes: true });

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
        const fullPath = path.join(targetPath, entry.name);
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

      const prefix = wasFileFallback
        ? `Note: '${args.path}' is a file. Listed parent directory '${targetPath}':\n`
        : `Contents of ${targetPath}:\n`;

      if (results.length === 0) {
        return { success: true, output: `${prefix}(Directory is empty)` };
      }

      return {
        success: true,
        output: `${prefix}${results.join('\n')}`,
      };
    } catch (err: any) {
      return { success: false, output: '', error: `Failed to list directory: ${err.message}` };
    }
  },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
