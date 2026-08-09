import { spawn, ChildProcess } from 'child_process';
import { z } from 'zod';
import type { McpServerConfig, McpTool, McpRequest, McpResponse } from './types.js';
import type { Tool, ToolResult } from '../tools/types.js';

/**
 * Model Context Protocol (MCP) Client.
 * Connects external stdio MCP tool servers to Titao's ToolRegistry.
 */
export class McpClient {
  private childProcess: ChildProcess | null = null;
  private config: McpServerConfig;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, (res: McpResponse) => void>();
  private buffer = '';

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  /** Connect to the MCP server and initialize protocol session. */
  async connect(): Promise<McpTool[]> {
    return new Promise((resolve, reject) => {
      try {
        this.childProcess = spawn(this.config.command, this.config.args ?? [], {
          env: { ...process.env, ...this.config.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.childProcess.stdout?.on('data', (data: Buffer) => {
          this.handleStdoutData(data.toString());
        });

        this.childProcess.on('error', (err) => {
          reject(new Error(`MCP server '${this.config.name}' failed to spawn: ${err.message}`));
        });

        // Initialize MCP handshake
        this.sendRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          clientInfo: { name: 'titao-cli', version: '0.1.0' },
        })
          .then(async () => {
            // Request available tools
            const listRes = await this.sendRequest('tools/list', {});
            const tools = (listRes.result?.tools as McpTool[]) ?? [];
            resolve(tools);
          })
          .catch((err) => reject(err));
      } catch (err: any) {
        reject(new Error(`Failed to initialize MCP client: ${err.message}`));
      }
    });
  }

  /** Call a remote tool on the MCP server. */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const response = await this.sendRequest('tools/call', {
        name,
        arguments: args,
      });

      if (response.error) {
        return { success: false, output: '', error: response.error.message };
      }

      const content = (response.result?.content as Array<{ type: string; text?: string }>) ?? [];
      const outputText = content.map((c) => c.text ?? '').join('\n');

      return { success: true, output: outputText };
    } catch (err: any) {
      return { success: false, output: '', error: `MCP tool call '${name}' failed: ${err.message}` };
    }
  }

  /** Convert MCP tools to Titao Tool interface objects. */
  adaptMcpTools(mcpTools: McpTool[]): Tool[] {
    return mcpTools.map((mcpTool) => ({
      name: `mcp_${this.config.name}_${mcpTool.name}`,
      description: `[MCP: ${this.config.name}] ${mcpTool.description}`,
      parameters: z.object({}).passthrough(),
      permission: 'execute',
      execute: (args) => this.callTool(mcpTool.name, args),
    }));
  }

  /** Disconnect from MCP server. */
  disconnect(): void {
    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = null;
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<McpResponse> {
    const id = this.nextRequestId++;
    const req: McpRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request '${method}' timed out`));
      }, 15000);

      this.pendingRequests.set(id, (res) => {
        clearTimeout(timeout);
        resolve(res);
      });

      this.childProcess?.stdin?.write(JSON.stringify(req) + '\n');
    });
  }

  private handleStdoutData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response: McpResponse = JSON.parse(line);
        if (response.id !== undefined && this.pendingRequests.has(Number(response.id))) {
          const handler = this.pendingRequests.get(Number(response.id))!;
          this.pendingRequests.delete(Number(response.id));
          handler(response);
        }
      } catch {
        // Ignore unparseable JSON-RPC lines
      }
    }
  }
}
