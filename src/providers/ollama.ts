import OpenAI from 'openai';
import type {
  LLMProvider,
  StreamChunk,
  ChatParams,
  ModelInfo,
  Message,
} from './types.js';

function formatMessagesForOllama(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      return {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments:
              typeof tc.function.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments ?? {}),
          },
        })),
      } as OpenAI.ChatCompletionAssistantMessageParam;
    }

    if (msg.role === 'tool') {
      return {
        role: 'user',
        content: `[Tool Execution Result for '${msg.name || 'tool'}']:\n${msg.content}`,
      } as OpenAI.ChatCompletionUserMessageParam;
    }

    return msg as unknown as OpenAI.ChatCompletionMessageParam;
  });
}

/**
 * Ollama LLM provider using the OpenAI-compatible API.
 * Connects to Ollama's /v1 endpoint for chat completions.
 */
export class OllamaProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  private contextSize: number;
  private host: string;

  constructor(host: string, model: string, contextSize: number) {
    this.host = host;
    this.client = new OpenAI({
      baseURL: `${host}/v1`,
      apiKey: 'ollama', // Ollama doesn't require an API key
    });
    this.model = model;
    this.contextSize = contextSize;
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const shouldStream = params.stream ?? true;

    try {
      if (shouldStream) {
        yield* this.chatStream(params);
      } else {
        yield* this.chatSync(params);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: 'error', content: `LLM request failed: ${message}` };
    }
  }

  private async *chatStream(params: ChatParams): AsyncIterable<StreamChunk> {
    const formattedMessages = formatMessagesForOllama(params.messages);

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: formattedMessages,
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
  }

  private async *chatSync(params: ChatParams): AsyncIterable<StreamChunk> {
    const formattedMessages = formatMessagesForOllama(params.messages);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: formattedMessages,
      tools: params.tools?.length
        ? (params.tools as OpenAI.ChatCompletionTool[])
        : undefined,
      stream: false,
      temperature: params.temperature ?? 0.1,
    });

    const choice = response.choices[0];
    if (!choice) {
      yield { type: 'error', content: 'No response from model' };
      return;
    }

    if (choice.message.content) {
      yield { type: 'text', content: choice.message.content };
    }

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          parsedArgs = { _raw: tc.function.arguments };
        }

        yield {
          type: 'tool_call',
          toolCall: {
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: parsedArgs,
            },
          },
        };
      }
    }

    yield {
      type: 'done',
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.models.list();
      return response.data.map((m) => m.id).sort();
    } catch {
      return [];
    }
  }

  async getModelInfo(model: string): Promise<ModelInfo> {
    try {
      const resp = await fetch(`${this.host}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data = (await resp.json()) as Record<string, any>;
      return {
        name: model,
        parameterSize: data.details?.parameter_size ?? 'unknown',
        contextLength:
          data.model_info?.['general.context_length'] ??
          data.model_info?.context_length ??
          4096,
        supportsToolCalling: true,
        family: data.details?.family ?? 'unknown',
      };
    } catch {
      return {
        name: model,
        parameterSize: 'unknown',
        contextLength: 4096,
        supportsToolCalling: true,
        family: 'unknown',
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.host}/api/version`, {
        signal: AbortSignal.timeout(3000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
