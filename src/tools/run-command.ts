import { z } from 'zod';
import { spawn } from 'child_process';
import type { Tool, ToolResult } from './types.js';
import { resolveWithinWorkspace } from '../core/workspace-boundary.js';

export const runCommandTool: Tool = {
  name: 'run_command',
  description:
    'Execute a shell command and return its output. Use for running tests, builds, linting, git commands, or other development tools.',
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    cwd: z
      .string()
      .optional()
      .describe('Working directory for the command (default: project root)'),
    timeout: z
      .number()
      .int()
      .min(100)
      .max(300_000)
      .optional()
      .describe('Timeout in milliseconds (default: 30000)'),
  }),
  permission: 'execute',

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const command = args.command as string;
    const timeout = (args.timeout as number | undefined) ?? 30000;
    let cwd: string;

    try {
      cwd = await resolveWithinWorkspace(
        process.cwd(),
        (args.cwd as string | undefined) ?? '.',
        'cwd',
      );
    } catch (err: any) {
      return { success: false, output: '', error: `Failed to execute command: ${err.message}` };
    }

    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'powershell.exe' : '/bin/bash';
      const shellArgs = isWindows ? ['-NoProfile', '-Command', command] : ['-c', command];

      const child = spawn(shell, shellArgs, {
        cwd,
        timeout,
        env: { ...process.env, PAGER: 'cat', NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const MAX_OUTPUT = 15000;
        let output = stdout;
        if (output.length > MAX_OUTPUT) {
          output = output.slice(0, MAX_OUTPUT) + '\n... (output truncated)';
        }

        let result = `Exit code: ${code ?? 'unknown'}\n`;
        result += output;
        if (stderr && stderr.trim()) {
          const stderrTrimmed =
            stderr.length > 3000 ? stderr.slice(0, 3000) + '\n... (stderr truncated)' : stderr;
          result += `\nSTDERR:\n${stderrTrimmed}`;
        }

        resolve({
          success: code === 0,
          output: result,
          error: code !== 0 ? `Command exited with code ${code}` : undefined,
        });
      });

      child.on('error', (err) => {
        resolve({
          success: false,
          output: '',
          error: `Failed to execute command: ${err.message}`,
        });
      });
    });
  },
};
