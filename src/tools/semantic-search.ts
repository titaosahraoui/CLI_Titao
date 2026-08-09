import { z } from 'zod';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import type { Tool, ToolResult } from './types.js';

interface CodeChunk {
  filePath: string;
  startLine: number;
  content: string;
}

/**
 * Computes cosine similarity between two numeric vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/**
 * Fetch embedding vector from Ollama API.
 */
async function fetchEmbedding(text: string, host = 'http://localhost:11434'): Promise<number[] | null> {
  try {
    const resp = await fetch(`${host}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: text,
      }),
    });

    if (!resp.ok) return null;
    const data = (await resp.json()) as { embedding: number[] };
    return data.embedding ?? null;
  } catch {
    return null;
  }
}

export const semanticSearchTool: Tool = {
  name: 'semantic_search',
  description: 'Perform semantic vector similarity search across workspace code using local embeddings.',
  parameters: z.object({
    query: z.string().describe('Natural language query describing what code concept to search for'),
    maxResults: z.number().optional().describe('Maximum number of matching snippets to return (default: 5)'),
  }),
  permission: 'read',

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const query = args.query as string;
    const maxResults = (args.maxResults as number) ?? 5;

    try {
      // 1. Get embedding for search query
      const queryVec = await fetchEmbedding(query);
      if (!queryVec) {
        return {
          success: false,
          output: '',
          error: 'Local embedding model nomic-embed-text not available in Ollama. Run: ollama pull nomic-embed-text',
        };
      }

      // 2. Collect files & chunk content
      const chunks: CodeChunk[] = [];
      const cwd = process.cwd();

      async function scanDir(dir: string): Promise<void> {
        if (chunks.length >= 200) return;
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else if (entry.isFile() && /\.(ts|js|py|json|md)$/.test(entry.name)) {
            const content = await readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i += 20) {
              const chunkLines = lines.slice(i, i + 25).join('\n');
              if (chunkLines.trim()) {
                chunks.push({
                  filePath: path.relative(cwd, fullPath).replace(/\\/g, '/'),
                  startLine: i + 1,
                  content: chunkLines,
                });
              }
            }
          }
        }
      }

      await scanDir(cwd);

      // 3. Score chunks
      const scored: Array<{ chunk: CodeChunk; score: number }> = [];

      for (const chunk of chunks.slice(0, 50)) {
        const vec = await fetchEmbedding(chunk.content);
        if (vec) {
          const score = cosineSimilarity(queryVec, vec);
          scored.push({ chunk, score });
        }
      }

      scored.sort((a, b) => b.score - a.score);

      const topMatches = scored.slice(0, maxResults);
      if (topMatches.length === 0) {
        return { success: true, output: `No semantic matches found for query: "${query}"` };
      }

      const results = topMatches
        .map(
          (m, idx) =>
            `Match #${idx + 1} (Score: ${(m.score * 100).toFixed(1)}%)\n📄 ${m.chunk.filePath} (Line ${m.chunk.startLine}):\n${m.chunk.content.slice(0, 300)}...`,
        )
        .join('\n\n');

      return { success: true, output: results };
    } catch (err: any) {
      return { success: false, output: '', error: `Semantic search failed: ${err.message}` };
    }
  },
};
