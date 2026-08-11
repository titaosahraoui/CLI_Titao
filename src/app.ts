import chalk from 'chalk';
import readline from 'readline';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import type { CLIOptions } from './cli.js';
import { createProvider, OllamaProvider } from './providers/index.js';
import { ToolRegistry, allTools, gitDiffTool, gitStatusTool } from './tools/index.js';
import { generateDirectoryTree } from './tools/repo-map.js';
import { generateSymbolMap } from './tools/ast-repo-map.js';
import { AgentLoop } from './core/agent-loop.js';
import { ContextManager } from './core/context-manager.js';
import { PermissionManager } from './core/permissions.js';
import { createExecutionPolicy } from './core/execution-policy.js';
import { WorkspaceTrustStore } from './core/workspace-trust.js';
import { UndoManager } from './core/undo-manager.js';
import { HooksEngine } from './hooks/engine.js';
import { loadAndRegisterMcpServers } from './mcp/config-loader.js';
import { resolveConfig, loadProjectMemory } from './core/config.js';
import { buildSystemPrompt } from './prompts/system.js';
import {
  parseThinkingBlocks,
  formatThinkingUI,
  renderTerminalMarkdown,
  createThrottledMarkdownRenderer,
  formatToolCallUI,
  formatToolResultUI,
} from './utils/response-formatter.js';
import { formatDiffPreview } from './utils/diff-preview.js';
import { CostTracker } from './utils/cost-tracker.js';
import { completer } from './utils/completer.js';

/**
 * Main Titao application.
 * Bootstraps all components and runs the interactive agent loop.
 */
export async function startTitao(options: CLIOptions): Promise<void> {
  const config = resolveConfig({
    model: options.model,
    ollamaHost: options.host,
    contextSize: parseInt(options.context, 10),
    autoApproveWrites: options.autoApprove,
    autoApproveCommands: options.autoApprove,
    streamingEnabled: options.stream,
    repoMapEnabled: options.repoMap,
  });

  // Initialize Provider Factory
  let provider = createProvider({
    type: options.provider ?? 'ollama',
    model: config.model,
    host: config.ollamaHost,
    apiKey: options.apiKey,
    contextSize: config.contextSize,
  });

  const providerReady = await provider.isAvailable();

  if (!providerReady && (options.provider === 'ollama' || !options.provider)) {
    console.error(chalk.red('\n❌ Cannot connect to Ollama.'));
    console.error(chalk.dim(`   Tried: ${config.ollamaHost}`));
    console.error(chalk.dim('   Make sure Ollama is running: ollama serve'));
    console.error(chalk.dim('   Install Ollama: https://ollama.com\n'));
    process.exit(1);
  }

  // Auto-detect available models if Ollama
  let availableModels: string[] = [config.model];
  if (options.provider === 'ollama' || !options.provider) {
    availableModels = await provider.listModels();
    if (availableModels.length > 0) {
      const modelExists = availableModels.some(
        (m) => m === config.model || m.split(':')[0] === config.model,
      );

      if (!modelExists) {
        const preferred =
          availableModels.find(
            (m) => m.includes('coder') || m.includes('qwen') || m.includes('deepseek'),
          ) ?? availableModels[0];

        console.log(chalk.yellow(`\n⚠️  Model '${config.model}' is not pulled in Ollama.`));
        console.log(chalk.green(`   Auto-switching to available model: '${preferred}'\n`));

        config.model = preferred;
        provider = new OllamaProvider(config.ollamaHost, config.model, config.contextSize);
      }
    }
  }

  // ── Print welcome banner ───────────────────────────────────────────
  printBanner(config.model, config.contextSize, availableModels, options.provider ?? 'ollama');

  // ── Set up tool registry & load MCP servers ────────────────────────
  const toolRegistry = new ToolRegistry();
  toolRegistry.registerAll(allTools);
  const trustStore = new WorkspaceTrustStore();
  const workspaceTrusted = await trustStore.isTrusted(process.cwd());
  if (!workspaceTrusted) {
    console.log(
      chalk.yellow(
        '  Repository hooks and MCP servers are disabled until this workspace is trusted.',
      ),
    );
  }
  const mcpClients = await loadAndRegisterMcpServers(toolRegistry, process.cwd(), {
    trusted: workspaceTrusted,
  });
  if (mcpClients.length > 0) {
    console.log(chalk.dim(`  🔌 Connected ${mcpClients.length} external MCP tool servers.`));
  }

  // ── Set up permissions, hooks, cost tracker & undo manager ───────
  const permissionPolicy = createExecutionPolicy({
    interactive: !options.prompt,
    autoApprove: options.autoApprove,
  });
  const permissions = new PermissionManager(permissionPolicy);
  const undoManager = new UndoManager();
  const hooksEngine = new HooksEngine(process.cwd());
  const costTracker = new CostTracker();
  if (workspaceTrusted) await hooksEngine.loadHooks();

  // ── Set up context manager ─────────────────────────────────────────
  const systemPrompt = buildSystemPrompt({
    cwd: process.cwd(),
    model: config.model,
  });
  const context = new ContextManager(systemPrompt, config.contextSize);

  // Scan current workspace directory structure & AST symbols into context
  if (config.repoMapEnabled) {
    const [dirTree, symbolMap] = await Promise.all([
      generateDirectoryTree(process.cwd()),
      generateSymbolMap(process.cwd()),
    ]);

    const combinedMap = [
      dirTree ? `### Directory Structure\n${dirTree}` : '',
      symbolMap ? `### Code AST Symbols & Signatures\n${symbolMap}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    if (combinedMap) {
      context.setRepoMap(combinedMap);
      console.log(chalk.dim('  📁 Workspace directory structure & AST symbols indexed.'));
    }
  }

  // Load project memory (TITAO.md)
  const memory = await loadProjectMemory(process.cwd(), config.projectMemoryFile);
  if (memory) {
    context.setProjectMemory(memory);
    console.log(chalk.dim(`  📝 Loaded project memory from ${config.projectMemoryFile}`));
  }

  // ── Set up readline with tab completer for user input ──────────────
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
    terminal: true,
  });

  // ── Handle single prompt mode ──────────────────────────────────────
  if (options.prompt) {
    await runSinglePrompt(
      options.prompt,
      provider,
      toolRegistry,
      context,
      permissions,
      undoManager,
      hooksEngine,
      config,
    );
    rl.close();
    return;
  }

  // ── Interactive loop ───────────────────────────────────────────────
  console.log(chalk.dim('  Type your request, or /help for commands. Ctrl+C to exit.\n'));

  const promptForInput = (): void => {
    rl.question(chalk.cyan.bold('  > '), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        promptForInput();
        return;
      }

      // Handle slash commands
      if (trimmed.startsWith('/')) {
        const handled = await handleSlashCommand(
          trimmed,
          context,
          provider,
          undoManager,
          costTracker,
          config,
          rl,
        );
        if (handled !== 'exit') {
          promptForInput();
        }
        return;
      }

      console.log('');

      let fullStreamedText = '';
      const markdownRenderer = createThrottledMarkdownRenderer(
        (rendered) => process.stdout.write(rendered),
        50,
      );

      const agentLoop = new AgentLoop({
        provider,
        tools: toolRegistry,
        context,
        permissions,
        undoManager,
        maxTurns: config.maxTurns,
        callbacks: {
          onStreamText: (text) => {
            fullStreamedText += text;

            const { thinking, content } = parseThinkingBlocks(fullStreamedText);

            if (thinking.length > 0) {
              const latestThink = thinking[thinking.length - 1];
              markdownRenderer.flush();
              process.stdout.write(formatThinkingUI(latestThink));
              fullStreamedText = content;
            } else if (content) {
              markdownRenderer.push(content);
            }
          },
          onToolCall: (name, args) => {
            console.log(formatToolCallUI(name, args));
          },
          onToolResult: (name, output, success) => {
            console.log(formatToolResultUI(name, output, success));
          },
          onRequestPermission: async (tool, args) => {
            // Show red/green diff preview for write_file and edit_file
            if ((tool === 'write_file' || tool === 'edit_file') && typeof args.path === 'string') {
              const targetPath = path.resolve(args.path);
              let oldContent = '';
              let newContent = '';

              if (existsSync(targetPath)) {
                try {
                  oldContent = await readFile(targetPath, 'utf-8');
                } catch {
                  oldContent = '';
                }
              }

              if (tool === 'write_file' && typeof args.content === 'string') {
                newContent = args.content;
              } else if (
                tool === 'edit_file' &&
                typeof args.search === 'string' &&
                typeof args.replace === 'string'
              ) {
                newContent = oldContent.replace(args.search, args.replace);
              }

              if (oldContent || newContent) {
                console.log(formatDiffPreview(targetPath, oldContent, newContent));
              }
            }

            return new Promise((resolve) => {
              const argsStr = Object.entries(args)
                .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                .join(', ');
              rl.question(
                chalk.yellow(
                  `  🔒 Permission Request: Allow ${chalk.bold(tool)}(${argsStr})? [y(yes)/n(no)/a(lways)] `,
                ),
                async (answer) => {
                  const normalized = answer.trim().toLowerCase();
                  if (normalized === 'a' || normalized === 'always') {
                    permissions.approveToolForSession(tool);
                    console.log(chalk.dim(`     Approved '${tool}' for the rest of this session.`));
                    resolve(true);
                  } else if (normalized === 'y' || normalized === 'yes') {
                    resolve(true);
                  } else {
                    resolve(false);
                  }
                },
              );
            });
          },
          onBeforeToolExecute: (name) => runPreToolHooks(hooksEngine, name),
          onAfterToolExecute: (name, _args, success) =>
            runPostToolHooks(hooksEngine, name, success),
          onComplete: () => {
            markdownRenderer.flush();
            console.log('');
          },
          onError: (error) => {
            markdownRenderer.cancel();
            console.error(chalk.red(`\n  ❌ Error: ${error.message}\n`));
          },
        },
      });

      await agentLoop.processUserMessage(trimmed);
      promptForInput();
    });
  };

  // Handle Ctrl+C
  rl.on('close', () => {
    // Disconnect MCP clients on exit
    mcpClients.forEach((c) => c.disconnect());
    const usage = context.getTokenUsage();
    console.log(chalk.dim(`\n  📊 Session: ${usage.total.toLocaleString()} tokens used`));
    console.log(chalk.dim('  👋 Goodbye!\n'));
    process.exit(0);
  });

  promptForInput();
}

/**
 * Run a single prompt and exit.
 */
async function runSinglePrompt(
  prompt: string,
  provider: ReturnType<typeof createProvider>,
  tools: ToolRegistry,
  context: ContextManager,
  permissions: PermissionManager,
  undoManager: UndoManager,
  hooksEngine: HooksEngine,
  config: ReturnType<typeof resolveConfig>,
): Promise<void> {
  let responseAccumulator = '';

  const agentLoop = new AgentLoop({
    provider,
    tools,
    context,
    permissions,
    undoManager,
    maxTurns: config.maxTurns,
    callbacks: {
      onStreamText: (text) => {
        responseAccumulator += text;
      },
      onToolCall: (name, args) => {
        console.log(formatToolCallUI(name, args));
      },
      onToolResult: (name, output, success) => {
        console.log(formatToolResultUI(name, output, success));
      },
      onRequestPermission: async () => false,
      onBeforeToolExecute: (name) => runPreToolHooks(hooksEngine, name),
      onAfterToolExecute: (name, _args, success) => runPostToolHooks(hooksEngine, name, success),
      onComplete: () => {
        const { thinking, content } = parseThinkingBlocks(responseAccumulator);
        if (thinking.length > 0) {
          console.log(formatThinkingUI(thinking.join('\n')));
        }
        if (content) {
          console.log(renderTerminalMarkdown(content));
        }

        const usage = context.getTokenUsage();
        console.log(
          chalk.dim(
            `\n  📊 Token Usage: Prompt ${usage.prompt.toLocaleString()} | Completion ${usage.completion.toLocaleString()} | Total ${usage.total.toLocaleString()}`,
          ),
        );
      },
      onError: (error) => {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      },
    },
  });

  await agentLoop.processUserMessage(prompt);
}

async function runPreToolHooks(
  hooksEngine: HooksEngine,
  toolName: string,
): Promise<{ allowed: boolean; message?: string }> {
  const event =
    toolName === 'write_file' || toolName === 'edit_file'
      ? 'pre-edit'
      : toolName === 'git_commit'
        ? 'pre-commit'
        : undefined;
  if (!event) return { allowed: true };

  const results = await hooksEngine.runHooks(event, { TITAO_TOOL: toolName });
  const failure = results.find((result) => !result.success);
  if (!failure) return { allowed: true };
  const detail = [failure.error, failure.output].filter(Boolean).join('\n');
  return {
    allowed: false,
    message: `${event} hook '${failure.command}' failed${detail ? `:\n${detail}` : '.'}`,
  };
}

async function runPostToolHooks(
  hooksEngine: HooksEngine,
  toolName: string,
  success: boolean,
): Promise<void> {
  if (!success) return;
  const event =
    toolName === 'write_file' || toolName === 'edit_file'
      ? 'post-edit'
      : toolName === 'git_commit'
        ? 'post-commit'
        : undefined;
  if (!event) return;

  const results = await hooksEngine.runHooks(event, { TITAO_TOOL: toolName });
  const failure = results.find((result) => !result.success);
  if (failure) {
    console.error(
      chalk.yellow(
        `  ${event} hook '${failure.command}' failed: ${failure.error ?? failure.output}`,
      ),
    );
  }
}

/**
 * Handle slash commands.
 */
async function handleSlashCommand(
  commandLine: string,
  context: ContextManager,
  provider: ReturnType<typeof createProvider>,
  undoManager: UndoManager,
  costTracker: CostTracker,
  config: ReturnType<typeof resolveConfig>,
  rl: readline.Interface,
): Promise<string> {
  const [cmd, ...args] = commandLine.trim().split(/\s+/);

  switch (cmd.toLowerCase()) {
    case '/help':
      console.log(
        chalk.dim(`
  ⚡ Titao Commands:
  ──────────────────
  /help            Show this help message
  /compact         Compact conversation history to save tokens
  /undo            Revert the most recent file edit
  /diff            Show uncommitted git changes
  /status          Show git repository status
  /models          List available models
  /model <name>    Switch active model dynamically
  /provider <type> Switch LLM provider (ollama, openrouter, lmstudio, vllm, openai)
  /cost            Show token cost estimation & generation speed metrics
  /clear           Clear conversation history
  /usage           Show token usage statistics
  /exit            Exit Titao
`),
      );
      return 'continue';

    case '/compact': {
      const res = context.compactHistory();
      if (res.tokensSaved > 0) {
        console.log(
          chalk.green(
            `\n  🧹 Compacted ${res.originalCount} messages! Saved ~${res.tokensSaved.toLocaleString()} tokens.\n`,
          ),
        );
      } else {
        console.log(chalk.yellow('\n  Context history is already compact.\n'));
      }
      return 'continue';
    }

    case '/cost': {
      const usage = context.getTokenUsage();
      const report = costTracker.calculateCost(
        config.model,
        config.provider,
        usage.prompt,
        usage.completion,
      );
      console.log(
        chalk.dim(`
  💸 Cost & Speed Metrics:
  ────────────────────────
  Estimated Cost: $${report.estimatedCostUSD.toFixed(5)} USD
  Tokens / Sec:   ${report.averageTokensPerSec} t/s
  Prompt Tokens:  ${report.promptTokens.toLocaleString()}
  Completion:     ${report.completionTokens.toLocaleString()}
`),
      );
      return 'continue';
    }

    case '/undo': {
      const result = await undoManager.undo();
      if (result.success) {
        console.log(chalk.green(`\n  ↩️  ${result.message}\n`));
      } else {
        console.log(chalk.yellow(`\n  ⚠️  ${result.message}\n`));
      }
      return 'continue';
    }

    case '/diff': {
      const res = await gitDiffTool.execute({});
      console.log(`\n  📊 Uncommitted Git Diff:\n${res.output}\n`);
      return 'continue';
    }

    case '/status': {
      const res = await gitStatusTool.execute({});
      console.log(`\n  🌿 Git Repository Status:\n${res.output}\n`);
      return 'continue';
    }

    case '/models': {
      const models = await provider.listModels();
      console.log(`\n  ⚡ Available Models (${models.length}):`);
      for (const m of models) {
        const activeMarker = m === config.model ? chalk.cyan(' (active)') : '';
        console.log(`    • ${m}${activeMarker}`);
      }
      console.log(chalk.dim(`\n  Use /model <name> to switch models.\n`));
      return 'continue';
    }

    case '/model': {
      const targetModel = args.join(' ').trim();
      if (!targetModel) {
        console.log(chalk.yellow(`  Current model: ${config.model}`));
        console.log(chalk.dim(`  Usage: /model <model-name> (e.g. /model qwen2.5-coder:7b)\n`));
        return 'continue';
      }

      const models = await provider.listModels();
      const match = models.find(
        (m) =>
          m.toLowerCase() === targetModel.toLowerCase() ||
          m.split(':')[0].toLowerCase() === targetModel.toLowerCase(),
      );

      const newModel = match ?? targetModel;
      config.model = newModel;

      Object.assign(provider, new OllamaProvider(config.ollamaHost, newModel, config.contextSize));

      console.log(chalk.green(`  ✅ Switched active model to: '${newModel}'\n`));
      return 'continue';
    }

    case '/clear':
      context.clearHistory();
      console.log(chalk.dim('  🗑️  Conversation cleared.\n'));
      return 'continue';

    case '/usage': {
      const usage = context.getTokenUsage();
      console.log(
        chalk.dim(`
  📊 Token Usage:
  ──────────────
  Prompt:     ${usage.prompt.toLocaleString()} tokens
  Completion: ${usage.completion.toLocaleString()} tokens
  Total:      ${usage.total.toLocaleString()} tokens
  Messages:   ${context.getMessageCount()}
`),
      );
      return 'continue';
    }

    case '/exit':
    case '/quit':
      rl.close();
      return 'exit';

    default:
      console.log(
        chalk.dim(`  Unknown command: ${commandLine}. Type /help for available commands.\n`),
      );
      return 'continue';
  }
}

/**
 * Print the Titao welcome banner.
 */
function printBanner(
  model: string,
  contextSize: number,
  availableModels: string[],
  providerName: string,
): void {
  console.log('');
  console.log(
    chalk.bold.cyan('  ⚡ Titao') +
      chalk.dim(` v0.1.0 · provider:`) +
      chalk.cyan.bold(` ${providerName}`) +
      chalk.dim(` · model:`) +
      chalk.cyan.bold(` ${model}`) +
      chalk.dim(` · ctx:${contextSize.toLocaleString()}`),
  );
  console.log(
    chalk.dim(`  Connected to ${providerName} (${availableModels.length} models available)`),
  );
  console.log(chalk.dim('  ────────────────────────────────────────────────'));
}
