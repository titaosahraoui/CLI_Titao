export interface CostReport {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
  averageTokensPerSec: number;
}

const PRICING_TABLE: Record<string, { promptPer1k: number; completionPer1k: number }> = {
  'qwen/qwen-2.5-coder-32b': { promptPer1k: 0.0008, completionPer1k: 0.0008 },
  'deepseek/deepseek-r1': { promptPer1k: 0.00055, completionPer1k: 0.00219 },
  'gpt-4o': { promptPer1k: 0.0025, completionPer1k: 0.01 },
  'gpt-4o-mini': { promptPer1k: 0.00015, completionPer1k: 0.0006 },
};

export class CostTracker {
  private startTime = Date.now();

  calculateCost(model: string, provider: string, promptTokens: number, completionTokens: number): CostReport {
    let cost = 0;

    if (provider !== 'ollama' && provider !== 'lmstudio' && provider !== 'vllm') {
      const pricing = PRICING_TABLE[model] ?? { promptPer1k: 0.001, completionPer1k: 0.002 };
      cost = (promptTokens / 1000) * pricing.promptPer1k + (completionTokens / 1000) * pricing.completionPer1k;
    }

    const elapsedSec = (Date.now() - this.startTime) / 1000 || 1;
    const tokensPerSec = completionTokens / elapsedSec;

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCostUSD: cost,
      averageTokensPerSec: Math.round(tokensPerSec * 10) / 10,
    };
  }
}
