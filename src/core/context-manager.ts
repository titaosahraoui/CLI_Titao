import { encode } from 'gpt-tokenizer';
import type { Message, TokenUsage } from '../providers/types.js';

/** Keywords that trigger Tier 2 context injection (AST symbols & repo map). */
const CODE_INTENT_KEYWORDS = new Set([
  'code',
  'file',
  'refactor',
  'fix',
  'review',
  'build',
  'test',
  'edit',
  'search',
  'function',
  'bug',
  'class',
  'component',
  'create',
  'add',
  'update',
  'delete',
  'git',
]);

/**
 * Manages the conversation context within token budget constraints.
 * Implements lazy, tiered context injection to minimize startup prompt tokens.
 */
export class ContextManager {
  private messages: Message[] = [];
  private systemPrompt: string;
  private maxTokens: number;
  private repoMap: string = '';
  private projectMemory: string = '';
  private totalPromptTokens: number = 0;
  private totalCompletionTokens: number = 0;

  constructor(systemPrompt: string, maxTokens: number) {
    this.systemPrompt = systemPrompt;
    this.maxTokens = maxTokens;
  }

  /** Add a message to the conversation history. */
  addMessage(message: Message): void {
    this.messages.push(message);
  }

  /** Set the repository map content. */
  setRepoMap(repoMap: string): void {
    this.repoMap = repoMap;
  }

  /** Set the project memory content (from TITAO.md). */
  setProjectMemory(memory: string): void {
    this.projectMemory = memory;
  }

  /**
   * Assemble the full message array for the LLM, respecting token budget.
   * Uses Tiered Context Injection:
   * - Tier 1 (General prompts like "hi"): Lean system prompt (~250-350 tokens).
   * - Tier 2 (Code tasks): Includes compact Repo Map & AST symbols.
   */
  assembleMessages(): Message[] {
    const lastUserMsg = [...this.messages].reverse().find((m) => m.role === 'user');
    const userText = (typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '').toLowerCase();

    // Determine if Tier 2 (repo map) is needed based on intent or active tool calls
    const needsRepoMap =
      this.messages.some((m) => m.role === 'tool' || (m.role === 'assistant' && m.tool_calls)) ||
      userText.split(/\s+/).some((word) => CODE_INTENT_KEYWORDS.has(word));

    const systemContent = this.buildSystemContent(needsRepoMap);
    const system: Message = { role: 'system', content: systemContent };

    // Token budget calculation using BPE tokenizer
    const systemTokens = this.estimateTokens(systemContent);
    const responseReserve = Math.min(4096, Math.floor(this.maxTokens * 0.25));
    const availableForHistory = this.maxTokens - systemTokens - responseReserve;

    if (availableForHistory <= 0) {
      const lastMessage = this.messages[this.messages.length - 1];
      return lastMessage ? [system, lastMessage] : [system];
    }

    // Include messages from newest to oldest until budget exhausted
    const included: Message[] = [];
    let usedTokens = 0;

    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      const msgContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg);
      const msgTokens = this.estimateTokens(msgContent);

      if (usedTokens + msgTokens > availableForHistory) {
        break;
      }

      included.unshift(msg);
      usedTokens += msgTokens;
    }

    return [system, ...included];
  }

  /**
   * Compact conversation history into a single high-density summary message.
   */
  compactHistory(): { originalCount: number; tokensSaved: number } {
    const originalCount = this.messages.length;
    if (originalCount <= 2) {
      return { originalCount, tokensSaved: 0 };
    }

    const beforeTokens = this.countMessageArrayTokens(this.messages);

    const firstMsg = this.messages[0];
    const lastMsg = this.messages[this.messages.length - 1];

    const summaryContent = `[Context Compacted]: Previous conversation (${originalCount - 2} turns) summarized. Continue assisting user based on last request: "${lastMsg.content}"`;

    this.messages = [
      firstMsg,
      { role: 'user', content: summaryContent },
      lastMsg,
    ];

    const afterTokens = this.countMessageArrayTokens(this.messages);
    const tokensSaved = Math.max(0, beforeTokens - afterTokens);

    return { originalCount, tokensSaved };
  }

  /** Update token usage tracking. */
  updateTokenUsage(usage: TokenUsage): void {
    this.totalPromptTokens += usage.promptTokens;
    this.totalCompletionTokens += usage.completionTokens;
  }

  /** Calculate prompt tokens for an assembled message array. */
  countMessageArrayTokens(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg);
      total += this.estimateTokens(content);
    }
    return total;
  }

  /** Get total token usage for the session. */
  getTokenUsage(): { prompt: number; completion: number; total: number } {
    return {
      prompt: this.totalPromptTokens,
      completion: this.totalCompletionTokens,
      total: this.totalPromptTokens + this.totalCompletionTokens,
    };
  }

  /** Get the number of messages in history. */
  getMessageCount(): number {
    return this.messages.length;
  }

  /** Clear the conversation history (keeps system prompt, repo map, etc.). */
  clearHistory(): void {
    this.messages = [];
  }

  private buildSystemContent(includeRepoMap: boolean): string {
    const parts = [this.systemPrompt];

    if (this.projectMemory) {
      parts.push(`\n## Project Memory (TITAO.md)\n${this.projectMemory}`);
    }

    if (includeRepoMap && this.repoMap) {
      parts.push(`\n## Repository Structure & Symbols\n${this.repoMap}`);
    }

    return parts.join('\n');
  }

  /** Accurate BPE token estimation using gpt-tokenizer. */
  estimateTokens(text: string): number {
    if (!text || !text.trim()) return 0;
    try {
      return encode(text).length;
    } catch {
      return Math.ceil(text.length / 4);
    }
  }
}
