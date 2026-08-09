import { readdirSync } from 'fs';
import path from 'path';

const COMMANDS = [
  '/help',
  '/undo',
  '/diff',
  '/status',
  '/models',
  '/model',
  '/provider',
  '/cost',
  '/clear',
  '/usage',
  '/exit',
];

/**
 * Custom tab completer for Readline REPL supporting slash commands and local paths.
 */
export function completer(line: string): [string[], string] {
  if (line.startsWith('/')) {
    const hits = COMMANDS.filter((c) => c.startsWith(line));
    return [hits.length ? hits : COMMANDS, line];
  }

  try {
    const dir = path.dirname(line) || '.';
    const files = readdirSync(dir);
    const hits = files
      .map((f) => path.join(dir, f).replace(/\\/g, '/'))
      .filter((p) => p.startsWith(line));
    return [hits, line];
  } catch {
    return [[], line];
  }
}
