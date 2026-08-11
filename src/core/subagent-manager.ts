import { AgentLoop } from './agent-loop.js';
import { ContextManager } from './context-manager.js';
import { PermissionManager } from './permissions.js';
import type { PermissionPolicy } from './permissions.js';
import type { LLMProvider } from '../providers/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import { buildSystemPrompt } from '../prompts/system.js';

export interface SubagentOptions {
  role: string;
  taskPrompt: string;
  provider: LLMProvider;
  tools: ToolRegistry;
  permissionPolicy: PermissionPolicy;
  cwd?: string;
  maxTurns?: number;
}

export interface SubagentResult {
  role: string;
  success: boolean;
  output: string;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

/**
 * Agent Teams & Subagents Manager.
 * Spawns secondary agents for isolated subtasks (research, log analysis, testing)
 * without cluttering the primary agent's main context window.
 */
export class SubagentManager {
  /**
   * Spawn and run an isolated sub-agent for a specific task.
   */
  static async runSubagent(options: SubagentOptions): Promise<SubagentResult> {
    const cwd = options.cwd ?? process.cwd();
    const subSystemPrompt = `${buildSystemPrompt({
      cwd,
      model: 'subagent',
    })}\n\n## SUBAGENT ROLE\nYou are a specialized sub-agent running in an isolated sub-context for the role: '${options.role}'. Complete the requested task efficiently and provide a clean, comprehensive summary.`;

    const subContext = new ContextManager(subSystemPrompt, 32768);
    const subPermissions = new PermissionManager(options.permissionPolicy);

    let resultOutput = '';
    let isSuccess = true;

    const subLoop = new AgentLoop({
      provider: options.provider,
      tools: options.tools,
      context: subContext,
      permissions: subPermissions,
      maxTurns: options.maxTurns ?? 15,
      callbacks: {
        onStreamText: (text) => {
          resultOutput += text;
        },
        onToolCall: () => {},
        onToolResult: () => {},
        onRequestPermission: async () => false,
        onComplete: () => {},
        onError: (err) => {
          isSuccess = false;
          resultOutput += `\nSubagent Error: ${err.message}`;
        },
      },
    });

    await subLoop.processUserMessage(options.taskPrompt);

    const usage = subContext.getTokenUsage();

    return {
      role: options.role,
      success: isSuccess,
      output: resultOutput.trim(),
      tokenUsage: usage,
    };
  }
}
