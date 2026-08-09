import { readFile } from 'fs/promises';
import path from 'path';

/** Titao configuration. */
export interface TitaoConfig {
  // LLM
  provider: 'ollama';
  model: string;
  ollamaHost: string;
  contextSize: number;
  temperature: number;

  // Agent behavior
  maxToolCalls: number;
  maxTurns: number;
  autoApproveReads: boolean;
  autoApproveWrites: boolean;
  autoApproveCommands: boolean;

  // Context
  repoMapEnabled: boolean;
  repoMapMaxTokens: number;
  projectMemoryFile: string;

  // UI
  theme: 'dark' | 'light' | 'auto';
  showToolCalls: boolean;
  streamingEnabled: boolean;

  // Git
  gitAutoCommit: boolean;
  gitAutoStash: boolean;
}

/** Default configuration values. */
export const DEFAULT_CONFIG: TitaoConfig = {
  provider: 'ollama',
  model: 'qwen2.5-coder:32b',
  ollamaHost: 'http://localhost:11434',
  contextSize: 32768,
  temperature: 0.1,

  maxToolCalls: 25,
  maxTurns: 50,
  autoApproveReads: true,
  autoApproveWrites: false,
  autoApproveCommands: false,

  repoMapEnabled: true,
  repoMapMaxTokens: 4096,
  projectMemoryFile: 'TITAO.md',

  theme: 'dark',
  showToolCalls: true,
  streamingEnabled: true,

  gitAutoCommit: false,
  gitAutoStash: true,
};

/** Load project memory from TITAO.md if it exists. */
export async function loadProjectMemory(cwd: string, filename: string): Promise<string> {
  try {
    const memoryPath = path.join(cwd, filename);
    return await readFile(memoryPath, 'utf-8');
  } catch {
    return '';
  }
}

/** Merge CLI options with defaults. */
export function resolveConfig(cliOptions: Partial<TitaoConfig>): TitaoConfig {
  return { ...DEFAULT_CONFIG, ...cliOptions };
}
