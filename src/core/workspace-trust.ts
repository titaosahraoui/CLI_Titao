import { createHash } from 'crypto';
import { readFile, realpath } from 'fs/promises';
import path from 'path';
import Conf from 'conf';

export interface TrustedWorkspace {
  canonicalRoot: string;
  fingerprint: string;
  trustedAt: string;
}

interface TrustSchema {
  workspaces: Record<string, TrustedWorkspace>;
}

export interface WorkspaceTrustStoreOptions {
  projectName?: string;
}

export interface WorkspaceExecutionMetadata {
  hooks: Array<{ event: string; command: string; enabled: boolean }>;
  mcpServers: Array<{
    name: string;
    command: string;
    args: string[];
    environmentVariables: string[];
  }>;
}

async function readExecutionConfig(root: string, filename: string): Promise<Buffer> {
  try {
    return await readFile(path.join(root, '.titao', filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.alloc(0);
    throw error;
  }
}

function workspaceKey(canonicalRoot: string): string {
  const normalized = process.platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot;
  return createHash('sha256').update(normalized).digest('hex');
}

function parseJsonBuffer(contents: Buffer): Record<string, unknown> {
  if (contents.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(contents.toString('utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Read command metadata for a trust prompt without returning environment values. */
export async function inspectWorkspaceExecutionConfig(
  root: string,
): Promise<WorkspaceExecutionMetadata> {
  const canonicalRoot = await realpath(path.resolve(root));
  const [hooksBytes, mcpBytes] = await Promise.all([
    readExecutionConfig(canonicalRoot, 'hooks.json'),
    readExecutionConfig(canonicalRoot, 'mcp.json'),
  ]);
  const hooksConfig = parseJsonBuffer(hooksBytes);
  const mcpConfig = parseJsonBuffer(mcpBytes);
  const rawHooks = Array.isArray(hooksConfig.hooks) ? hooksConfig.hooks : [];
  const rawServers =
    mcpConfig.mcpServers !== null &&
    typeof mcpConfig.mcpServers === 'object' &&
    !Array.isArray(mcpConfig.mcpServers)
      ? (mcpConfig.mcpServers as Record<string, unknown>)
      : {};

  const hooks = rawHooks.flatMap((hook) => {
    if (hook === null || typeof hook !== 'object') return [];
    const candidate = hook as Record<string, unknown>;
    if (typeof candidate.event !== 'string' || typeof candidate.command !== 'string') return [];
    return [
      {
        event: candidate.event,
        command: candidate.command,
        enabled: candidate.enabled !== false,
      },
    ];
  });
  const mcpServers = Object.entries(rawServers).flatMap(([name, server]) => {
    if (server === null || typeof server !== 'object') return [];
    const candidate = server as Record<string, unknown>;
    if (typeof candidate.command !== 'string') return [];
    const environment =
      candidate.env !== null && typeof candidate.env === 'object' && !Array.isArray(candidate.env)
        ? (candidate.env as Record<string, unknown>)
        : {};
    return [
      {
        name,
        command: candidate.command,
        args: Array.isArray(candidate.args)
          ? candidate.args.filter((argument): argument is string => typeof argument === 'string')
          : [],
        environmentVariables: Object.keys(environment).sort(),
      },
    ];
  });

  return { hooks, mcpServers };
}

/** Persists content-bound trust decisions for repository-owned executable configuration. */
export class WorkspaceTrustStore {
  private readonly config: Conf<TrustSchema>;

  constructor(options: WorkspaceTrustStoreOptions = {}) {
    this.config = new Conf<TrustSchema>({
      projectName: options.projectName ?? 'titao',
      configName: 'workspace-trust',
      defaults: { workspaces: {} },
    });
  }

  async fingerprint(root: string): Promise<string> {
    const canonicalRoot = await realpath(path.resolve(root));
    const [hooksBytes, mcpBytes] = await Promise.all([
      readExecutionConfig(canonicalRoot, 'hooks.json'),
      readExecutionConfig(canonicalRoot, 'mcp.json'),
    ]);

    return createHash('sha256')
      .update(canonicalRoot)
      .update('\0hooks\0')
      .update(hooksBytes)
      .update('\0mcp\0')
      .update(mcpBytes)
      .digest('hex');
  }

  async isTrusted(root: string): Promise<boolean> {
    const canonicalRoot = await realpath(path.resolve(root));
    const entry = this.config.get('workspaces')[workspaceKey(canonicalRoot)];
    if (!entry || entry.canonicalRoot !== canonicalRoot) return false;
    return entry.fingerprint === (await this.fingerprint(canonicalRoot));
  }

  async trust(root: string): Promise<TrustedWorkspace> {
    const canonicalRoot = await realpath(path.resolve(root));
    const entry: TrustedWorkspace = {
      canonicalRoot,
      fingerprint: await this.fingerprint(canonicalRoot),
      trustedAt: new Date().toISOString(),
    };
    this.config.set('workspaces', {
      ...this.config.get('workspaces'),
      [workspaceKey(canonicalRoot)]: entry,
    });
    return entry;
  }

  async revoke(root: string): Promise<void> {
    const canonicalRoot = await realpath(path.resolve(root));
    const workspaces = { ...this.config.get('workspaces') };
    delete workspaces[workspaceKey(canonicalRoot)];
    this.config.set('workspaces', workspaces);
  }

  async list(): Promise<TrustedWorkspace[]> {
    return Object.values(this.config.get('workspaces')).sort((left, right) =>
      left.canonicalRoot.localeCompare(right.canonicalRoot),
    );
  }
}
