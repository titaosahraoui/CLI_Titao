import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createExecutionPolicy, isPolicyNarrowerOrEqual } from '../src/core/execution-policy.js';
import { SubagentManager } from '../src/core/subagent-manager.js';
import type { LLMProvider, StreamChunk } from '../src/providers/types.js';
import { ToolRegistry } from '../src/tools/registry.js';

describe('createExecutionPolicy', () => {
  it('denies side effects when a non-interactive prompt is not explicitly auto-approved', () => {
    expect(createExecutionPolicy({ interactive: false, autoApprove: false })).toEqual({
      reads: 'auto',
      writes: 'deny',
      commands: 'deny',
      git: 'deny',
    });
  });

  it('auto-approves every category only when explicitly requested', () => {
    expect(createExecutionPolicy({ interactive: false, autoApprove: true })).toEqual({
      reads: 'auto',
      writes: 'auto',
      commands: 'auto',
      git: 'auto',
    });
  });

  it('keeps side effects ask-gated for interactive sessions', () => {
    expect(createExecutionPolicy({ interactive: true, autoApprove: false })).toEqual({
      reads: 'auto',
      writes: 'ask',
      commands: 'ask',
      git: 'ask',
    });
  });
});

describe('isPolicyNarrowerOrEqual', () => {
  it('accepts a child policy that removes parent permissions', () => {
    expect(
      isPolicyNarrowerOrEqual(
        { reads: 'auto', writes: 'deny', commands: 'deny', git: 'deny' },
        { reads: 'auto', writes: 'ask', commands: 'deny', git: 'ask' },
      ),
    ).toBe(true);
  });

  it('rejects a child policy that grants more authority than its parent', () => {
    expect(
      isPolicyNarrowerOrEqual(
        { reads: 'auto', writes: 'auto', commands: 'deny', git: 'deny' },
        { reads: 'auto', writes: 'ask', commands: 'deny', git: 'deny' },
      ),
    ).toBe(false);
  });
});

describe('SubagentManager', () => {
  it('does not silently approve an ask-gated parent write policy', async () => {
    let chatCount = 0;
    let executions = 0;
    const provider: LLMProvider = {
      async *chat(): AsyncIterable<StreamChunk> {
        chatCount++;
        if (chatCount === 1) {
          yield {
            type: 'tool_call',
            toolCall: {
              id: 'write-1',
              type: 'function',
              function: { name: 'write_file', arguments: { path: 'unsafe.txt' } },
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

    await SubagentManager.runSubagent({
      role: 'test',
      taskPrompt: 'write a file',
      provider,
      tools,
      permissionPolicy: { reads: 'auto', writes: 'ask', commands: 'deny', git: 'deny' },
      maxTurns: 2,
    });

    expect(executions).toBe(0);
  });
});
