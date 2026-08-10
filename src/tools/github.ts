import { z } from 'zod';
import { simpleGit } from 'simple-git';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Tool, ToolResult } from './types.js';

const execFileAsync = promisify(execFile);
const git = simpleGit(process.cwd());

const GITHUB_TOKEN_ENV_KEYS = [
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_PERSONAL_ACCESS_TOKEN',
] as const;

export function extractGithubTokenFromHostsYaml(hostsYaml: string, host = 'github.com'): string | null {
  const lines = hostsYaml.split(/\r?\n/);
  let inTargetHost = false;
  let targetIndent = -1;

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) {
      continue;
    }

    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const keyMatch = rawLine.match(/^\s*([^:#]+):\s*(.*)$/);
    if (!keyMatch) {
      continue;
    }

    const key = keyMatch[1].trim();
    const value = keyMatch[2].trim();

    if (indent === 0) {
      inTargetHost = key === host;
      targetIndent = inTargetHost ? indent : -1;
      continue;
    }

    if (inTargetHost && indent <= targetIndent) {
      inTargetHost = false;
      targetIndent = -1;
    }

    if (inTargetHost && key === 'oauth_token' && value) {
      return value.replace(/^['"]|['"]$/g, '');
    }
  }

  return null;
}

function getGhHostsFilePaths(): string[] {
  const candidates: string[] = [];

  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'GitHub CLI', 'hosts.yml'));
  }

  candidates.push(path.join(os.homedir(), '.config', 'gh', 'hosts.yml'));

  return Array.from(new Set(candidates));
}

async function getGithubToken(): Promise<string | null> {
  for (const key of GITHUB_TOKEN_ENV_KEYS) {
    const token = process.env[key];
    if (token) {
      return token;
    }
  }

  for (const hostsFilePath of getGhHostsFilePaths()) {
    try {
      const hostsYaml = await readFile(hostsFilePath, 'utf-8');
      const token = extractGithubTokenFromHostsYaml(hostsYaml);
      if (token) {
        return token;
      }
    } catch {
      // Ignore missing or unreadable gh config files and try the next location.
    }
  }

  return null;
}

/**
 * Extracts owner/repo from git remote origin URL.
 * Supports SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git).
 */
async function getRepoOwnerAndName(): Promise<{ owner: string; repo: string } | null> {
  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return null;

    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0];
    if (!origin || !origin.refs.fetch) return null;

    const url = origin.refs.fetch;
    const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
    if (!match) return null;

    return { owner: match[1], repo: match[2] };
  } catch {
    return null;
  }
}

export const githubCreateIssueTool: Tool = {
  name: 'github_create_issue',
  description: 'Create a new GitHub issue in the repository using gh CLI or GitHub REST API.',
  parameters: z.object({
    title: z.string().describe('Title of the GitHub issue'),
    body: z.string().describe('Body/description of the GitHub issue (markdown supported)'),
    repo: z.string().optional().describe('GitHub repository in owner/repo format (optional, auto-detected if omitted)'),
    labels: z.array(z.string()).optional().describe('Labels to attach to the issue'),
  }),
  permission: 'write',

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const title = args.title as string;
    const body = args.body as string;
    const labels = Array.isArray(args.labels) ? args.labels : [];

    let targetRepo = args.repo as string | undefined;

    if (!targetRepo) {
      const detected = await getRepoOwnerAndName();
      if (detected) {
        targetRepo = `${detected.owner}/${detected.repo}`;
      }
    }

    // Attempt 1: Try gh CLI
    try {
      const commandArgs = ['issue', 'create', '--title', title, '--body', body];
      if (targetRepo) {
        commandArgs.push('--repo', targetRepo);
      }
      if (labels.length > 0) {
        commandArgs.push('--label', labels.join(','));
      }

      const { stdout } = await execFileAsync('gh', commandArgs);
      return {
        success: true,
        output: `✅ Created GitHub issue: ${stdout.trim()}`,
      };
    } catch (ghErr: any) {
      // Attempt 2: GitHub REST API via GITHUB_TOKEN or GH_TOKEN
      const token = await getGithubToken();

      if (!token) {
        return {
          success: false,
          output: '',
          error: `Failed to create GitHub issue.\n   - gh CLI error: ${ghErr.message}\n   - GITHUB_TOKEN not set.\n\nTo enable GitHub integration, run 'gh auth login' or set environment variable GITHUB_TOKEN.`,
        };
      }

      if (!targetRepo) {
        return {
          success: false,
          output: '',
          error: 'Could not auto-detect GitHub repository. Please specify repo in owner/repo format.',
        };
      }

      try {
        const response = await fetch(`https://api.github.com/repos/${targetRepo}/issues`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Titao-Agent',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title,
            body,
            labels: labels.length > 0 ? labels : undefined,
          }),
        });

        const data: any = await response.json();

        if (!response.ok) {
          return {
            success: false,
            output: '',
            error: `GitHub API error (${response.status}): ${data.message ?? JSON.stringify(data)}`,
          };
        }

        return {
          success: true,
          output: `✅ Created GitHub issue #${data.number}: ${data.html_url}`,
        };
      } catch (apiErr: any) {
        return {
          success: false,
          output: '',
          error: `GitHub issue creation failed: ${apiErr.message}`,
        };
      }
    }
  },
};

export const githubListIssuesTool: Tool = {
  name: 'github_list_issues',
  description: 'List GitHub issues for the repository.',
  parameters: z.object({
    repo: z.string().optional().describe('GitHub repository in owner/repo format (optional, auto-detected if omitted)'),
    state: z.enum(['open', 'closed', 'all']).optional().describe('Issue state filter (default: open)'),
    limit: z.number().optional().describe('Maximum number of issues to return (default: 10)'),
  }),
  permission: 'read',

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const state = args.state ?? 'open';
    const limit = args.limit ?? 10;
    let targetRepo = args.repo as string | undefined;

    if (!targetRepo) {
      const detected = await getRepoOwnerAndName();
      if (detected) {
        targetRepo = `${detected.owner}/${detected.repo}`;
      }
    }

    try {
      const commandArgs = ['issue', 'list', '--state', state, '--limit', String(limit)];
      if (targetRepo) {
        commandArgs.push('--repo', targetRepo);
      }

      const { stdout } = await execFileAsync('gh', commandArgs);
      return {
        success: true,
        output: stdout.trim() || 'No issues found matching criteria.',
      };
    } catch {
      const token = await getGithubToken();

      if (!token || !targetRepo) {
        return {
          success: false,
          output: '',
          error: 'GitHub issues list requires gh CLI authenticated or GITHUB_TOKEN set.',
        };
      }

      try {
        const response = await fetch(
          `https://api.github.com/repos/${targetRepo}/issues?state=${state}&per_page=${limit}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github.v3+json',
              'User-Agent': 'Titao-Agent',
            },
          },
        );

        const data: any = await response.json();
        if (!Array.isArray(data)) {
          return { success: false, output: '', error: 'Failed to fetch issues from GitHub REST API.' };
        }

        const issuesList = data
          .filter((i: any) => !i.pull_request)
          .map((i: any) => `#${i.number} [${i.state}] ${i.title} (${i.html_url})`)
          .join('\n');

        return {
          success: true,
          output: issuesList || 'No issues found.',
        };
      } catch (err: any) {
        return { success: false, output: '', error: `Failed to list GitHub issues: ${err.message}` };
      }
    }
  },
};
