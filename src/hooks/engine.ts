import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export type HookEvent = 'pre-edit' | 'post-edit' | 'pre-commit' | 'post-commit';

export interface HookConfig {
  event: HookEvent;
  command: string;
  enabled?: boolean;
}

export interface HookResult {
  success: boolean;
  event: HookEvent;
  command: string;
  output: string;
  error?: string;
}

/**
 * Executes shell-script hooks to programmatically enforce team styling/linting rules.
 */
export class HooksEngine {
  private hooks: HookConfig[] = [];
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  /** Load hook configuration from .titao/hooks.json if present. */
  async loadHooks(): Promise<void> {
    const hooksFile = path.join(this.cwd, '.titao', 'hooks.json');
    if (!existsSync(hooksFile)) {
      return;
    }

    try {
      const content = await readFile(hooksFile, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.hooks)) {
        this.hooks = parsed.hooks;
      }
    } catch {
      // Ignore unreadable hooks file
    }
  }

  /** Register a hook programmatically. */
  registerHook(hook: HookConfig): void {
    this.hooks.push({ ...hook, enabled: hook.enabled ?? true });
  }

  /** Execute all enabled hooks registered for a specific lifecycle event. */
  async runHooks(event: HookEvent, envContext?: Record<string, string>): Promise<HookResult[]> {
    const matching = this.hooks.filter((h) => h.event === event && (h.enabled ?? true));
    const results: HookResult[] = [];

    for (const hook of matching) {
      const res = await this.executeHookCommand(hook, envContext);
      results.push(res);
      if (!res.success) {
        break; // Stop running further hooks if a pre-hook fails
      }
    }

    return results;
  }

  private executeHookCommand(hook: HookConfig, envContext?: Record<string, string>): Promise<HookResult> {
    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'powershell.exe' : '/bin/bash';
      const args = isWindows ? ['-NoProfile', '-Command', hook.command] : ['-c', hook.command];

      const child = spawn(shell, args, {
        cwd: this.cwd,
        env: { ...process.env, ...envContext },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        const output = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')).trim();
        resolve({
          success: code === 0,
          event: hook.event,
          command: hook.command,
          output,
          error: code !== 0 ? `Hook exited with code ${code}` : undefined,
        });
      });

      child.on('error', (err) => {
        resolve({
          success: false,
          event: hook.event,
          command: hook.command,
          output: '',
          error: err.message,
        });
      });
    });
  }
}
