import chalk from 'chalk';
import readline from 'readline';
import type { CLIOptions } from './cli.js';
import { OllamaProvider } from './providers/ollama.js';
import { ToolRegistry, allTools } from './tools/index.js';
import { generateDirectoryTree } from './tools/repo-map.js';
import { AgentLoop } from './core/agent-loop.js';
import { ContextManager } from './core/context-manager.js';
import { PermissionManager, DEFAULT_PERMISSION_POLICY } from './core/permissions.js';
import { resolveConfig, loadProjectMemory } from './core/config.js';
import { buildSystemPrompt } from './prompts/system.js';
import {
  parseThinkingBlocks,
  formatThinkingUI,
  renderTerminalMarkdown,
  formatToolCallUI,
  formatToolResultUI,
} from './utils/response-formatter.js';

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

  // ── Check Ollama availability & query models ────────────────────────
  let provider = new OllamaProvider(config.ollamaHost, config.model, config.contextSize);
  const ollamaReady = await provider.isAvailable();

  if (!ollamaReady) {
    console.error(chalk.red('\n❌ Cannot connect to Ollama.'));
    console.error(chalk.dim(`   Tried: ${config.ollamaHost}`));
    console.error(chalk.dim('   Make sure Ollama is running: ollama serve'));
    console.error(chalk.dim('   Install Ollama: https://ollama.com\n'));
    process.exit(1);
  }

  // Auto-detect available models and select fallback if requested model is not found
  const availableModels = await provider.listModels();
  if (availableModels.length === 0) {
    console.error(chalk.yellow('\n⚠️  No models found in Ollama!'));
    console.error(chalk.dim('   Please pull a model first using Ollama CLI:'));
    console.error(chalk.cyan('   ollama pull qwen2.5-coder:7b'));
    console.error(chalk.dim('   or: ollama pull deepseek-r1:8b\n'));
    process.exit(1);
  }

  // Check if chosen model exists
  const modelExists = availableModels.some(
    (m) => m === config.model || m.split(':')[0] === config.model,
  );

  if (!modelExists) {
    const preferred =
      availableModels.find((m) => m.includes('coder') || m.includes('qwen') || m.includes('deepseek')) ??
      availableModels[0];

    console.log(
      chalk.yellow(`\n⚠️  Model '${config.model}' is not pulled in Ollama.`),
    );
    console.log(
      chalk.green(`   Auto-switching to available model: '${preferred}'\n`),
    );

    config.model = preferred;
    provider = new OllamaProvider(config.ollamaHost, config.model, config.contextSize);
  }

  // ── Print welcome banner ───────────────────────────────────────────
  printBanner(config.model, config.contextSize, availableModels);

  // ── Set up tool registry ───────────────────────────────────────────
  const toolRegistry = new ToolRegistry();
  toolRegistry.registerAll(allTools);

  // ── Set up permissions ─────────────────────────────────────────────
  const permissionPolicy = options.autoApprove
    ? PermissionManager.autoApproveAll()
    : DEFAULT_PERMISSION_POLICY;
  const permissions = new PermissionManager(permissionPolicy);

  // ── Set up context manager ─────────────────────────────────────────
  const systemPrompt = buildSystemPrompt({
    cwd: process.cwd(),
    model: config.model,
  });
  const context = new ContextManager(systemPrompt, config.contextSize);

  // Scan current workspace directory structure and inject into context
  if (config.repoMapEnabled) {
    const dirTree = await generateDirectoryTree(process.cwd());
    if (dirTree) {
      context.setRepoMap(dirTree);
      console.log(chalk.dim('  📁 Workspace structure indexed automatically.'));
    }
  }

  // Load project memory (TITAO.md)
  const memory = await loadProjectMemory(process.cwd(), config.projectMemoryFile);
  if (memory) {
    context.setProjectMemory(memory);
    console.log(chalk.dim(`  📝 Loaded project memory from ${config.projectMemoryFile}`));
  }

  // ── Set up readline for user input ─────────────────────────────────
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // ── Handle single prompt mode ──────────────────────────────────────
  if (options.prompt) {
    await runSinglePrompt(options.prompt, provider, toolRegistry, context, permissions, config);
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
        const handled = await handleSlashCommand(trimmed, context, provider, config, rl);
        if (handled !== 'exit') {
          promptForInput();
        }
        return;
      }

      console.log('');

      let fullStreamedText = '';

      const agentLoop = new AgentLoop({
        provider,
        tools: toolRegistry,
        context,
        permissions,
        maxTurns: config.maxTurns,
        callbacks: {
          onStreamText: (text) => {
            fullStreamedText += text;

            // Process and display thinking blocks dynamically
            const { thinking, content } = parseThinkingBlocks(fullStreamedText);

            if (thinking.length > 0) {
              const latestThink = thinking[thinking.length - 1];
              // Display thinking block cleanly
              process.stdout.write(formatThinkingUI(latestThink));
              fullStreamedText = content; // Keep remaining content
            } else if (content) {
              // Render formatted terminal markdown
              const rendered = renderTerminalMarkdown(content);
              process.stdout.write(`\r${rendered}`);
            }
          },
          onToolCall: (name, args) => {
            console.log(formatToolCallUI(name, args));
          },
          onToolResult: (name, output, success) => {
            console.log(formatToolResultUI(name, output, success));
          },
          onRequestPermission: async (tool, args) => {
            return new Promise((resolve) => {
              const argsStr = Object.entries(args)
                .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                .join(', ');
              rl.question(
                chalk.yellow(`\n  🔒 Permission Request: Allow ${chalk.bold(tool)}(${argsStr})? [y(yes)/n(no)/a(lways)] `),
                (answer) => {
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
          onComplete: () => {
            console.log('');
          },
          onError: (error) => {
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
  provider: OllamaProvider,
  tools: ToolRegistry,
  context: ContextManager,
  permissions: PermissionManager,
  config: ReturnType<typeof resolveConfig>,
): Promise<void> {
  const autoPermissions = new PermissionManager(PermissionManager.autoApproveAll());

  let responseAccumulator = '';

  const agentLoop = new AgentLoop({
    provider,
    tools,
    context,
    permissions: autoPermissions,
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
      onRequestPermission: async () => true,
      onComplete: () => {
        const { thinking, content } = parseThinkingBlocks(responseAccumulator);
        if (thinking.length > 0) {
          console.log(formatThinkingUI(thinking.join('\n')));
        }
        if (content) {
          console.log(renderTerminalMarkdown(content));
        }
      },
      onError: (error) => {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      },
    },
  });

  await agentLoop.processUserMessage(prompt);
}

/**
 * Handle slash commands.
 */
async function handleSlashCommand(
  commandLine: string,
  context: ContextManager,
  provider: OllamaProvider,
  config: ReturnType<typeof resolveConfig>,
  rl: readline.Interface,
): Promise<string> {
  const [cmd, ...args] = commandLine.trim().split(/\s+/);

  switch (cmd.toLowerCase()) {
    case '/help':
      console.log(chalk.dim(`
  ⚡ Titao Commands:
  ──────────────────
  /help            Show this help message
  /models          List available models pulled in Ollama
  /model <name>    Switch active model dynamically
  /clear           Clear conversation history
  /usage           Show token usage statistics
  /exit            Exit Titao
`));
      return 'continue';

    case '/models': {
      const models = await provider.listModels();
      console.log(`\n  ⚡ Available Ollama Models (${models.length}):`);
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
        (m) => m.toLowerCase() === targetModel.toLowerCase() || m.split(':')[0].toLowerCase() === targetModel.toLowerCase(),
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
      console.log(chalk.dim(`
  📊 Token Usage:
  ──────────────
  Prompt:     ${usage.prompt.toLocaleString()} tokens
  Completion: ${usage.completion.toLocaleString()} tokens
  Total:      ${usage.total.toLocaleString()} tokens
  Messages:   ${context.getMessageCount()}
`));
      return 'continue';
    }

    case '/exit':
    case '/quit':
      rl.close();
      return 'exit';

    default:
      console.log(chalk.dim(`  Unknown command: ${commandLine}. Type /help for available commands.\n`));
      return 'continue';
  }
}

/**
 * Print the Titao welcome banner.
 */
function printBanner(model: string, contextSize: number, availableModels: string[]): void {
  console.log('');
  console.log(
    chalk.bold.cyan('  ⚡ Titao') +
    chalk.dim(` v0.1.0 · model:`) +
    chalk.cyan.bold(` ${model}`) +
    chalk.dim(` · ctx:${contextSize.toLocaleString()}`),
  );
  console.log(chalk.dim(`  Connected to Ollama (${availableModels.length} models available locally)`));
  console.log(chalk.dim('  ────────────────────────────────────────────────'));
}
