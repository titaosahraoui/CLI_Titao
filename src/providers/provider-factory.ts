import OpenAI from 'openai';
import type { LLMProvider, StreamChunk, ChatParams, ModelInfo } from './types.js';
import { OllamaProvider } from './ollama.js';

export type ProviderType = 'ollama' | 'openrouter' | 'lmstudio' | 'vllm' | 'openai';

export interface ProviderOptions {
  type: ProviderType;
  model: string;
  host?: string;
  apiKey?: string;
  contextSize?: number;
}

/**
 * Generic OpenAI-compatible provider for OpenRouter, LM Studio, vLLM, and OpenAI endpoints.
 */
export class GenericOpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  private contextSize: number;
  private providerName: string;

  constructor(options: {
    baseURL: string;
    apiKey?: string;
    model: string;
    contextSize?: number;
    providerName: string;
  }) {
    this.model = options.model;
    this.contextSize = options.contextSize ?? 32768;
    this.providerName = options.providerName;
    this.client = new OpenAI({
      baseURL: options.baseURL,
      apiKey: options.apiKey || 'dummy-key',
    });
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: params.messages as OpenAI.ChatCompletionMessageParam[],
        tools: params.tools?.length
          ? (params.tools as OpenAI.ChatCompletionTool[])
          : undefined,
        stream: true,
        temperature: params.temperature ?? 0.1,
      });

      const toolCallAccumulator = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        if (delta?.content) {
          yield { type: 'text', content: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallAccumulator.has(idx)) {
              toolCallAccumulator.set(idx, {
                id: tc.id ?? `call_${Date.now()}_${idx}`,
                name: tc.function?.name ?? '',
                arguments: '',
              });
            }
            const acc = toolCallAccumulator.get(idx)!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.arguments += tc.function.arguments;
          }
        }

        if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
          for (const [, acc] of toolCallAccumulator) {
            if (acc.name) {
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = JSON.parse(acc.arguments || '{}');
              } catch {
                parsedArgs = { _raw: acc.arguments };
              }

              yield {
                type: 'tool_call',
                toolCall: {
                  id: acc.id,
                  type: 'function',
                  function: {
                    name: acc.name,
                    arguments: parsedArgs,
                  },
                },
              };
            }
          }

          yield {
            type: 'done',
            usage: chunk.usage
              ? {
                  promptTokens: chunk.usage.prompt_tokens,
                  completionTokens: chunk.usage.completion_tokens,
                }
              : undefined,
          };
        }
      }
    } catch (err: any) {
      yield { type: 'error', content: `${this.providerName} request failed: ${err.message}` };
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const resp = await this.client.models.list();
      return resp.data.map((m) => m.id).sort();
    } catch {
      return [this.model];
    }
  }

  async getModelInfo(model: string): Promise<ModelInfo> {
    return {
      name: model,
      parameterSize: 'unknown',
      contextLength: this.contextSize,
      supportsToolCalling: true,
      family: this.providerName,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Creates an LLMProvider instance based on provider type.
 */
export function createProvider(options: ProviderOptions): LLMProvider {
  switch (options.type) {
    case 'ollama':
      return new OllamaProvider(
        options.host ?? 'http://localhost:11434',
        options.model,
        options.contextSize ?? 32768,
      );

    case 'openrouter':
      return new GenericOpenAIProvider({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: options.apiKey ?? process.env.OPENROUTER_API_KEY,
        model: options.model,
        contextSize: options.contextSize ?? 128000,
        providerName: 'OpenRouter',
      });

    case 'lmstudio':
      return new GenericOpenAIProvider({
        baseURL: options.host ?? 'http://localhost:1234/v1',
        model: options.model,
        contextSize: options.contextSize ?? 32768,
        providerName: 'LM Studio',
      });

    case 'vllm':
      return new GenericOpenAIProvider({
        baseURL: options.host ?? 'http://localhost:8000/v1',
        model: options.model,
        contextSize: options.contextSize ?? 32768,
        providerName: 'vLLM',
      });

    case 'openai':
      return new GenericOpenAIProvider({
        baseURL: 'https://api.openai.com/v1',
        apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
        model: options.model,
        contextSize: options.contextSize ?? 128000,
        providerName: 'OpenAI',
      });

    default:
      return new OllamaProvider(
        options.host ?? 'http://localhost:11434',
        options.model,
        options.contextSize ?? 32768,
      );
  }
}
