import { readdir } from 'fs/promises';
import path from 'path';

/** Directories and files to ignore during tree scan. */
const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.DS_Store',
  '__pycache__',
  '.next',
  '.turbo',
  'coverage',
]);

/**
 * Recursively scans a directory and generates a clean tree overview for the LLM context.
 */
export async function generateDirectoryTree(
  dirPath: string,
  maxDepth = 4,
  currentDepth = 0,
): Promise<string> {
  if (currentDepth >= maxDepth) {
    return '';
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const filtered = entries.filter((e) => !IGNORED_NAMES.has(e.name));

    // Sort: directories first, then files alphabetically
    filtered.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    const lines: string[] = [];
    const indent = '  '.repeat(currentDepth);

    for (const entry of filtered) {
      if (entry.isDirectory()) {
        lines.push(`${indent}📁 ${entry.name}/`);
        const subTree = await generateDirectoryTree(
          path.join(dirPath, entry.name),
          maxDepth,
          currentDepth + 1,
        );
        if (subTree) {
          lines.push(subTree);
        }
      } else {
        lines.push(`${indent}📄 ${entry.name}`);
      }
    }

    return lines.join('\n');
  } catch {
    return '';
  }
}
