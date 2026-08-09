import type { LLMProvider, Message, ToolCall } from '../providers/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ContextManager } from './context-manager.js';
import type { PermissionManager } from './permissions.js';
import { parseToolCallsFromText } from '../providers/tool-call-parser.js';

/** Callbacks for the agent loop to communicate with the UI. */
export interface AgentCallbacks {
  /** Called when a text token is streamed from the LLM. */
  onStreamText: (text: string) => void;
  /** Called when a tool call is about to be executed. */
  onToolCall: (name: string, args: Record<string, unknown>) => void;
  /** Called when a tool execution completes. */
  onToolResult: (name: string, result: string, success: boolean) => void;
  /** Called when a tool requires user permission. Returns true if approved. */
  onRequestPermission: (tool: string, args: Record<string, unknown>) => Promise<boolean>;
  /** Called when the agent loop finishes processing. */
  onComplete: () => void;
  /** Called when an error occurs. */
  onError: (error: Error) => void;
}

export interface AgentLoopOptions {
  provider: LLMProvider;
  tools: ToolRegistry;
  context: ContextManager;
  permissions: PermissionManager;
  maxTurns: number;
  callbacks: AgentCallbacks;
}

/**
 * The core agent loop implementing a ReAct-style pattern:
 * 1. Send conversation to LLM
 * 2. Collect/stream response
 * 3. Extract tool calls (native OpenAI structs or text JSON fallback)
 * 4. Execute tool calls & feed results back to LLM
 * 5. Repeat until no more tool calls or max turns reached
 */
export class AgentLoop {
  private provider: LLMProvider;
  private tools: ToolRegistry;
  private context: ContextManager;
  private permissions: PermissionManager;
  private maxTurns: number;
  private callbacks: AgentCallbacks;
  private isRunning = false;

  constructor(options: AgentLoopOptions) {
    this.provider = options.provider;
    this.tools = options.tools;
    this.context = options.context;
    this.permissions = options.permissions;
    this.maxTurns = options.maxTurns;
    this.callbacks = options.callbacks;
  }

  /** Process a user message through the agent loop. */
  async processUserMessage(userMessage: string): Promise<void> {
    this.isRunning = true;

    // Add user message to conversation
    this.context.addMessage({ role: 'user', content: userMessage });

    let turnCount = 0;

    while (this.isRunning && turnCount < this.maxTurns) {
      turnCount++;

      // 1. Assemble messages with context budget
      const messages = this.context.assembleMessages();

      // 2. Call LLM with streaming
      let responseText = '';
      const toolCalls: ToolCall[] = [];

      try {
        for await (const chunk of this.provider.chat({
          messages,
          tools: this.tools.getToolDefinitions(),
          stream: true,
        })) {
          if (!this.isRunning) break;

          switch (chunk.type) {
            case 'text': {
              const content = chunk.content ?? '';
              responseText += content;
              break;
            }
            case 'tool_call':
              if (chunk.toolCall) {
                toolCalls.push(chunk.toolCall);
              }
              break;
            case 'done':
              if (chunk.usage) {
                this.context.updateTokenUsage(chunk.usage);
              }
              break;
            case 'error':
              this.callbacks.onError(new Error(chunk.content ?? 'Unknown LLM error'));
              this.isRunning = false;
              return;
          }
        }
      } catch (error) {
        this.callbacks.onError(
          error instanceof Error ? error : new Error(String(error)),
        );
        this.isRunning = false;
        return;
      }

      // 2b. Fallback parsing: if model output raw tool JSON text instead of native API tool_calls
      if (toolCalls.length === 0 && responseText.trim()) {
        const fallback = parseToolCallsFromText(
          responseText,
          this.tools.getToolNames(),
        );
        if (fallback.toolCalls.length > 0) {
          toolCalls.push(...fallback.toolCalls);
          responseText = fallback.text;
        }
      }

      // Filter out echoed <tool_response> tags if present in text
      const cleanResponseText = responseText
        .replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, '')
        .trim();

      // If no tool calls were generated, stream the clean conversational text to UI
      if (toolCalls.length === 0 && cleanResponseText) {
        this.callbacks.onStreamText(cleanResponseText);
      }

      // 3. Add assistant message to conversation
      this.context.addMessage({
        role: 'assistant',
        content: cleanResponseText,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      // 4. If no tool calls, we're done
      if (toolCalls.length === 0) {
        this.isRunning = false;
        this.callbacks.onComplete();
        return;
      }

      // 5. Execute each tool call
      for (const toolCall of toolCalls) {
        if (!this.isRunning) break;

        const { name, arguments: args } = toolCall.function;

        // Check if denied
        if (this.permissions.isDenied(name)) {
          this.context.addMessage({
            role: 'tool',
            tool_call_id: toolCall.id,
            name,
            content: `Tool '${name}' is denied by permission policy.`,
          });
          continue;
        }

        // Check if permission needed
        if (!this.permissions.isAutoApproved(name)) {
          this.callbacks.onToolCall(name, args);
          const approved = await this.callbacks.onRequestPermission(name, args);
          if (!approved) {
            this.context.addMessage({
              role: 'tool',
              tool_call_id: toolCall.id,
              name,
              content: 'Permission denied by user.',
            });
            continue;
          }
        } else {
          this.callbacks.onToolCall(name, args);
        }

        // Execute the tool
        const result = await this.tools.execute(name, args);
        this.callbacks.onToolResult(name, result.output, result.success);

        // Add tool result to conversation
        const outputText = result.success ? result.output : `Error: ${result.error}`;
        this.context.addMessage({
          role: 'tool',
          tool_call_id: toolCall.id,
          name,
          content: `Observation from ${name}:\n${outputText}`,
        });
      }

      // Loop continues — LLM will see tool results and decide next action
    }

    if (turnCount >= this.maxTurns) {
      this.callbacks.onError(
        new Error(`Reached maximum turns (${this.maxTurns}). Use /clear to reset.`),
      );
    }

    this.isRunning = false;
  }

  /** Abort the current agent loop. */
  abort(): void {
    this.isRunning = false;
  }

  /** Check if the agent loop is currently running. */
  get running(): boolean {
    return this.isRunning;
  }
}
