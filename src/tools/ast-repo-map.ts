import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { encode } from 'gpt-tokenizer';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
]);

const CODE_EXTENSIONS = new Set(['.ts', '.js', '.jsx', '.tsx', '.py', '.go', '.rs']);

export interface CodeSymbol {
  kind: 'class' | 'interface' | 'function' | 'type' | 'export';
  name: string;
  signature: string;
  line: number;
}

/**
 * Parses code files and extracts top-level AST symbols (classes, methods, interfaces, types),
 * capped to a tight token budget (~400 tokens max).
 */
export async function generateSymbolMap(
  dirPath: string,
  maxFiles = 15,
  maxTokens = 400,
): Promise<string> {
  const filePaths: string[] = [];

  async function collectFiles(currentDir: string): Promise<void> {
    if (filePaths.length >= maxFiles) return;

    try {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (filePaths.length >= maxFiles) break;
        if (IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await collectFiles(fullPath);
        } else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
          filePaths.push(fullPath);
        }
      }
    } catch {
      // Ignore unreadable dirs
    }
  }

  await collectFiles(dirPath);

  const fileSymbolMaps: string[] = [];
  let currentTokenCount = 0;

  for (const filePath of filePaths) {
    if (currentTokenCount >= maxTokens) break;

    try {
      const content = await readFile(filePath, 'utf-8');
      const symbols = extractSymbolsFromContent(content);
      if (symbols.length > 0) {
        const relativePath = path.relative(dirPath, filePath).replace(/\\/g, '/');
        const symbolLines = symbols.slice(0, 5).map((s) => `  L${s.line}: ${s.signature}`).join('\n');
        const entryStr = `📄 ${relativePath}\n${symbolLines}`;
        const entryTokens = encode(entryStr).length;

        if (currentTokenCount + entryTokens > maxTokens) break;

        fileSymbolMaps.push(entryStr);
        currentTokenCount += entryTokens;
      }
    } catch {
      // Ignore file read errors
    }
  }

  if (fileSymbolMaps.length === 0) return '';

  return fileSymbolMaps.join('\n');
}

/**
 * Extracts top-level class, interface, function, and type signatures.
 */
function extractSymbolsFromContent(content: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = content.split('\n');

  const classPattern = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/;
  const interfacePattern = /^\s*(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/;
  const typePattern = /^\s*(?:export\s+)?type\s+([A-Za-z0-9_$]+)/;
  const functionPattern = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    let match = line.match(classPattern);
    if (match) {
      symbols.push({ kind: 'class', name: match[1], signature: line.trim(), line: i + 1 });
      continue;
    }

    match = line.match(interfacePattern);
    if (match) {
      symbols.push({ kind: 'interface', name: match[1], signature: line.trim(), line: i + 1 });
      continue;
    }

    match = line.match(typePattern);
    if (match) {
      symbols.push({ kind: 'type', name: match[1], signature: line.trim(), line: i + 1 });
      continue;
    }

    match = line.match(functionPattern);
    if (match) {
      symbols.push({ kind: 'function', name: match[1], signature: line.trim(), line: i + 1 });
    }
  }

  return symbols;
}
