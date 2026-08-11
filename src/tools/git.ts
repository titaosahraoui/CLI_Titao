import { z } from 'zod';
import { simpleGit } from 'simple-git';
import path from 'path';
import type { Tool, ToolResult } from './types.js';
import { resolveWithinWorkspace } from '../core/workspace-boundary.js';

const git = simpleGit(process.cwd());

export const gitStatusTool: Tool = {
  name: 'git_status',
  description:
    'Show working tree status (modified files, staged files, untracked files, current branch).',
  parameters: z.object({}),
  permission: 'read',

  async execute(): Promise<ToolResult> {
    try {
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        return { success: false, output: '', error: 'Current directory is not a git repository.' };
      }

      const status = await git.status();
      const output = [
        `Branch: ${status.current}`,
        `Ahead: ${status.ahead}, Behind: ${status.behind}`,
        `Staged: ${status.staged.length}`,
        `Modified: ${status.modified.length}`,
        `Untracked: ${status.not_added.length}`,
      ];

      if (status.files.length > 0) {
        output.push('\nChanged files:');
        for (const file of status.files.slice(0, 30)) {
          output.push(`  ${file.working_dir || ' '} ${file.path}`);
        }
        if (status.files.length > 30) {
          output.push(`  ... (${status.files.length - 30} more files)`);
        }
      }

      return { success: true, output: output.join('\n') };
    } catch (err: any) {
      return { success: false, output: '', error: `Git status failed: ${err.message}` };
    }
  },
};

export const gitDiffTool: Tool = {
  name: 'git_diff',
  description: 'Show git diff of uncommitted changes in the repository.',
  parameters: z.object({
    path: z.string().optional().describe('Specific file path to show diff for'),
    staged: z
      .boolean()
      .optional()
      .describe('Show staged diff instead of unstaged (default: false)'),
  }),
  permission: 'read',

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        return { success: false, output: '', error: 'Current directory is not a git repository.' };
      }

      const options: string[] = [];
      if (args.staged) options.push('--staged');
      if (typeof args.path === 'string' && args.path.trim()) {
        const safePath = await resolveWithinWorkspace(process.cwd(), args.path.trim(), 'read');
        options.push('--', path.relative(process.cwd(), safePath));
      }

      const diff = await git.diff(options);
      if (!diff || !diff.trim()) {
        return { success: true, output: 'No uncommitted git diff.' };
      }

      const lines = diff.split('\n');
      const output =
        lines.length > 100
          ? lines.slice(0, 100).join('\n') + `\n... (${lines.length - 100} lines truncated)`
          : diff;

      return { success: true, output };
    } catch (err: any) {
      return { success: false, output: '', error: `Git diff failed: ${err.message}` };
    }
  },
};

export const gitCommitTool: Tool = {
  name: 'git_commit',
  description: 'Stage modified files and create a git commit with a message.',
  parameters: z.object({
    message: z.string().describe('Commit message'),
    all: z
      .boolean()
      .optional()
      .describe('Stage all modified and deleted files before committing (default: true)'),
  }),
  permission: 'write',

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        return { success: false, output: '', error: 'Current directory is not a git repository.' };
      }

      const stageAll = args.all ?? true;
      if (stageAll) {
        await git.add('-A');
      }

      const commitRes = await git.commit(args.message as string);
      return {
        success: true,
        output: `Created commit [${commitRes.branch} ${commitRes.commit}]: ${args.message}`,
      };
    } catch (err: any) {
      return { success: false, output: '', error: `Git commit failed: ${err.message}` };
    }
  },
};
