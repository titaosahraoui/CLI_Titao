/**
 * Core types for the LLM provider abstraction layer.
 * Designed to be compatible with OpenAI's API format, which Ollama supports.
 */

/** A JSON Schema object used to describe tool parameters. */
export type JsonSchema = Record<string, unknown>;

/** A message in the conversation. */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/** A tool call made by the assistant. */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

/** A tool definition sent to the LLM. */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

/** A chunk of streaming response from the LLM. */
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: ToolCall;
  usage?: TokenUsage;
}

/** Token usage statistics. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/** Chat request parameters. */
export interface ChatParams {
  messages: Message[];
  tools?: ToolDefinition[];
  stream?: boolean;
  temperature?: number;
}

/** Information about a model. */
export interface ModelInfo {
  name: string;
  parameterSize: string;
  contextLength: number;
  supportsToolCalling: boolean;
  family: string;
}

/** Abstract interface for LLM providers. */
export interface LLMProvider {
  /** Send a chat request and get streaming responses. */
  chat(params: ChatParams): AsyncIterable<StreamChunk>;

  /** List available models. */
  listModels(): Promise<string[]>;

  /** Get detailed information about a specific model. */
  getModelInfo(model: string): Promise<ModelInfo>;

  /** Check if the provider is available and reachable. */
  isAvailable(): Promise<boolean>;
}
