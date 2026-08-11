import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { AgentLoop } from '../src/core/agent-loop.js';
import { ContextManager } from '../src/core/context-manager.js';
import { PermissionManager } from '../src/core/permissions.js';
import type { LLMProvider, StreamChunk } from '../src/providers/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { loadAndRegisterMcpServers } from '../src/mcp/config-loader.js';
import { McpClient } from '../src/mcp/client.js';

const temporaryPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryPaths.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

function createToolCallingProvider(toolName: string): LLMProvider {
  let chatCount = 0;
  return {
    async *chat(): AsyncIterable<StreamChunk> {
      chatCount++;
      if (chatCount === 1) {
        yield {
          type: 'tool_call',
          toolCall: {
            id: 'call-1',
            type: 'function',
            function: { name: toolName, arguments: { path: 'target.txt' } },
          },
        };
      } else {
        yield { type: 'text', content: 'done' };
      }
      yield { type: 'done' };
    },
    async listModels() {
      return [];
    },
    async getModelInfo() {
      return {
        name: 'test',
        parameterSize: '0',
        contextLength: 1024,
        supportsToolCalling: true,
        family: 'test',
      };
    },
    async isAvailable() {
      return true;
    },
  };
}

function createCallbacks(overrides: Record<string, unknown> = {}) {
  return {
    onStreamText: () => {},
    onToolCall: () => {},
    onToolResult: () => {},
    onRequestPermission: async () => true,
    onComplete: () => {},
    onError: (error: Error) => {
      throw error;
    },
    ...overrides,
  };
}

describe('AgentLoop trusted lifecycle boundary', () => {
  it('prevents tool execution when the pre-execution lifecycle rejects it', async () => {
    let executions = 0;
    let beforeCalls = 0;
    let afterCalls = 0;
    const tools = new ToolRegistry();
    tools.register({
      name: 'write_file',
      description: 'test write',
      parameters: z.object({ path: z.string() }),
      permission: 'write',
      async execute() {
        executions++;
        return { success: true, output: 'written' };
      },
    });
    const loop = new AgentLoop({
      provider: createToolCallingProvider('write_file'),
      tools,
      context: new ContextManager('test', 2048),
      permissions: new PermissionManager({
        reads: 'auto',
        writes: 'auto',
        commands: 'deny',
        git: 'deny',
      }),
      maxTurns: 2,
      callbacks: createCallbacks({
        onBeforeToolExecute: async () => {
          beforeCalls++;
          return { allowed: false, message: 'pre-edit hook failed' };
        },
        onAfterToolExecute: async () => {
          afterCalls++;
        },
      }),
    });

    await loop.processUserMessage('write');

    expect(beforeCalls).toBe(1);
    expect(executions).toBe(0);
    expect(afterCalls).toBe(0);
  });

  it('runs the post-execution lifecycle only after a successful tool call', async () => {
    let afterSuccess: boolean | undefined;
    const tools = new ToolRegistry();
    tools.register({
      name: 'write_file',
      description: 'test write',
      parameters: z.object({ path: z.string() }),
      permission: 'write',
      async execute() {
        return { success: true, output: 'written' };
      },
    });
    const loop = new AgentLoop({
      provider: createToolCallingProvider('write_file'),
      tools,
      context: new ContextManager('test', 2048),
      permissions: new PermissionManager({
        reads: 'auto',
        writes: 'auto',
        commands: 'deny',
        git: 'deny',
      }),
      maxTurns: 2,
      callbacks: createCallbacks({
        onBeforeToolExecute: async () => ({ allowed: true }),
        onAfterToolExecute: async (
          _name: string,
          _args: Record<string, unknown>,
          success: boolean,
        ) => {
          afterSuccess = success;
        },
      }),
    });

    await loop.processUserMessage('write');

    expect(afterSuccess).toBe(true);
  });
});

describe('untrusted repository process boundary', () => {
  it('does not connect repository MCP servers without an explicit trusted decision', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'titao-untrusted-'));
    temporaryPaths.push(root);
    await mkdir(path.join(root, '.titao'));
    await writeFile(
      path.join(root, '.titao', 'mcp.json'),
      '{"mcpServers":{"unsafe":{"command":"node","args":["unsafe.js"]}}}',
    );
    const connect = vi.spyOn(McpClient.prototype, 'connect').mockResolvedValue([]);

    const clients = await loadAndRegisterMcpServers(new ToolRegistry(), root);

    expect(clients).toEqual([]);
    expect(connect).not.toHaveBeenCalled();
  });
});
