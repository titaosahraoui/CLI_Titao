import type { Message, TokenUsage } from '../providers/types.js';

/**
 * Manages the conversation context within token budget constraints.
 * Assembles the system prompt, project memory, repo map, and message history.
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
   * Strategy: always include system prompt + most recent messages, dropping oldest first.
   */
  assembleMessages(): Message[] {
    const systemContent = this.buildSystemContent();
    const system: Message = { role: 'system', content: systemContent };

    // Token budget calculation
    const systemTokens = this.estimateTokens(systemContent);
    const responseReserve = Math.min(4096, Math.floor(this.maxTokens * 0.25));
    const availableForHistory = this.maxTokens - systemTokens - responseReserve;

    if (availableForHistory <= 0) {
      // System prompt alone exceeds budget — include only most recent message
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

  /** Update token usage tracking. */
  updateTokenUsage(usage: TokenUsage): void {
    this.totalPromptTokens += usage.promptTokens;
    this.totalCompletionTokens += usage.completionTokens;
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

  private buildSystemContent(): string {
    const parts = [this.systemPrompt];

    if (this.projectMemory) {
      parts.push(`\n## Project Memory (from TITAO.md)\n${this.projectMemory}`);
    }

    if (this.repoMap) {
      parts.push(`\n## Repository Structure\n${this.repoMap}`);
    }

    return parts.join('\n');
  }

  /** Rough token estimation (~4 chars per token). */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
