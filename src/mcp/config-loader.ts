import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { McpClient } from './client.js';
import type { McpServerConfig } from './types.js';
import type { ToolRegistry } from '../tools/registry.js';

export interface McpConfigFile {
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

/**
 * Loads .titao/mcp.json and connects all configured MCP servers to ToolRegistry.
 */
export async function loadAndRegisterMcpServers(
  registry: ToolRegistry,
  cwd: string = process.cwd(),
  options: { trusted?: boolean } = {},
): Promise<McpClient[]> {
  if (options.trusted !== true) return [];

  const configFile = path.join(cwd, '.titao', 'mcp.json');
  if (!existsSync(configFile)) {
    return [];
  }

  const clients: McpClient[] = [];

  try {
    const content = await readFile(configFile, 'utf-8');
    const parsed: McpConfigFile = JSON.parse(content);

    if (parsed.mcpServers) {
      for (const [name, server] of Object.entries(parsed.mcpServers)) {
        const config: McpServerConfig = {
          name,
          command: server.command,
          args: server.args,
          env: server.env,
        };

        const client = new McpClient(config);
        try {
          const mcpTools = await client.connect();
          const adaptedTools = client.adaptMcpTools(mcpTools);
          registry.registerAll(adaptedTools);
          clients.push(client);
        } catch (err: any) {
          console.error(`⚠️  Failed to connect to MCP server '${name}': ${err.message}`);
        }
      }
    }
  } catch {
    // Ignore unreadable MCP config
  }

  return clients;
}
