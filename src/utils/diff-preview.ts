import chalk from 'chalk';
import { structuredPatch } from 'diff';

/**
 * Generates a colorful red/green unified diff preview for terminal display.
 */
export function formatDiffPreview(
  filePath: string,
  oldContent: string,
  newContent: string,
): string {
  if (oldContent === newContent) {
    return chalk.dim('  (No changes in content)');
  }

  const patch = structuredPatch(filePath, filePath, oldContent, newContent, 'Original', 'Modified');
  const lines: string[] = [];

  lines.push(chalk.bold.yellow(`\n  📝 Proposed changes for ${filePath}:`));
  lines.push(chalk.dim('  ────────────────────────────────────────────────'));

  for (const hunk of patch.hunks) {
    lines.push(
      chalk.dim(`  @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`),
    );

    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        lines.push(`  ${chalk.green(line)}`);
      } else if (line.startsWith('-')) {
        lines.push(`  ${chalk.red(line)}`);
      } else {
        lines.push(`  ${chalk.dim(line)}`);
      }
    }
  }

  lines.push(chalk.dim('  ────────────────────────────────────────────────\n'));
  return lines.join('\n');
}
