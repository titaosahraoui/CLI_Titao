import { z } from 'zod';

/** Result returned by a tool execution. */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

/** A tool that can be registered and invoked by the agent. */
export interface Tool {
  /** Unique name for this tool. */
  name: string;
  /** Human-readable description (sent to the LLM). */
  description: string;
  /** Zod schema for parameter validation. Auto-converted to JSON Schema for the LLM. */
  parameters: z.ZodObject<any>;
  /** Permission category determines approval requirements. */
  permission: 'read' | 'write' | 'execute';
  /** Execute the tool with validated arguments. */
  execute(args: Record<string, any>): Promise<ToolResult>;
}
