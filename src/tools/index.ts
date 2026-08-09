export type { Tool, ToolResult } from './types.js';
export { ToolRegistry } from './registry.js';
export { viewFileTool } from './view-file.js';
export { writeFileTool } from './write-file.js';
export { editFileTool } from './edit-file.js';
export { listDirTool } from './list-dir.js';
export { grepSearchTool } from './grep-search.js';
export { runCommandTool } from './run-command.js';
export { gitStatusTool, gitDiffTool, gitCommitTool } from './git.js';
export { semanticSearchTool } from './semantic-search.js';

import { viewFileTool } from './view-file.js';
import { writeFileTool } from './write-file.js';
import { editFileTool } from './edit-file.js';
import { listDirTool } from './list-dir.js';
import { grepSearchTool } from './grep-search.js';
import { runCommandTool } from './run-command.js';
import { gitStatusTool, gitDiffTool, gitCommitTool } from './git.js';
import { semanticSearchTool } from './semantic-search.js';
import type { Tool } from './types.js';

/** All built-in tools. */
export const allTools: Tool[] = [
  viewFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  grepSearchTool,
  runCommandTool,
  gitStatusTool,
  gitDiffTool,
  gitCommitTool,
  semanticSearchTool,
];
