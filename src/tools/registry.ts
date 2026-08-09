import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Tool, ToolResult } from './types.js';
import type { ToolDefinition } from '../providers/types.js';

/**
 * Registry for all available tools.
 * Handles registration, JSON Schema generation, and dispatching execution.
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /** Register a tool. */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /** Register multiple tools at once. */
  registerAll(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /** Get JSON Schema tool definitions for the LLM. */
  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters, {
          $refStrategy: 'none',
          target: 'openApi3',
        }) as Record<string, unknown>,
      },
    }));
  }

  /** Execute a tool by name with the given arguments. */
  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: '', error: `Unknown tool: ${name}` };
    }

    // Validate arguments with Zod
    const parsed = tool.parameters.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        output: '',
        error: `Invalid arguments for ${name}: ${parsed.error.issues.map((i: { path: (string | number)[]; message: string }) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      };
    }

    try {
      return await tool.execute(parsed.data);
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Tool '${name}' failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** Get the permission level for a tool. */
  getPermission(name: string): 'read' | 'write' | 'execute' | undefined {
    return this.tools.get(name)?.permission;
  }

  /** Get all registered tool names. */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Check if a tool is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}
