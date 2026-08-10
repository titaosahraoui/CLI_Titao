import { Command } from 'commander';
import { startTitao } from './app.js';
import { OllamaProvider } from './providers/ollama.js';
import { generateGitHubWorkflow } from './ci/workflow-generator.js';
import type { ProviderType } from './providers/provider-factory.js';

/** CLI options parsed from command-line arguments. */
export interface CLIOptions {
  model: string;
  provider: ProviderType;
  host: string;
  apiKey?: string;
  context: string;
  autoApprove: boolean;
  repoMap: boolean;
  stream: boolean;
  prompt?: string;
}

const program = new Command()
  .name('titao')
  .description('⚡ Titao — Open-source enterprise CLI coding agent')
  .version('0.1.0')
  .option('-m, --model <model>', 'LLM model to use', 'qwen2.5-coder:32b')
  .option('--provider <provider>', 'LLM provider (ollama, openrouter, lmstudio, vllm, openai)', 'ollama')
  .option('--host <url>', 'Provider host URL', 'http://localhost:11434')
  .option('--api-key <key>', 'API key for OpenRouter or OpenAI')
  .option('-c, --context <size>', 'Context window size in tokens', '32768')
  .option('--auto-approve', 'Auto-approve all tool calls (use with caution)', false)
  .option('--no-repo-map', 'Disable repository structure map')
  .option('--no-stream', 'Disable streaming output')
  .option('-p, --prompt <message>', 'Run a single prompt and exit (non-interactive)')
  .action(async (options: CLIOptions) => {
    await startTitao(options);
  });

// Subcommand: list available models
program
  .command('models')
  .description('List available Ollama models')
  .option('--host <url>', 'Ollama host URL', 'http://localhost:11434')
  .action(async (options: { host: string }) => {
    const provider = new OllamaProvider(options.host, '', 0);
    const available = await provider.isAvailable();

    if (!available) {
      console.error('❌ Cannot connect to Ollama. Is it running?');
      console.error(`   Tried: ${options.host}`);
      console.error('   Start it with: ollama serve');
      process.exit(1);
    }

    const models = await provider.listModels();
    if (models.length === 0) {
      console.log('No models found. Pull one with:');
      console.log('  ollama pull qwen2.5-coder:7b');
    } else {
      console.log(`\n⚡ Available Ollama models (${models.length}):\n`);
      for (const model of models) {
        console.log(`  • ${model}`);
      }
      console.log('');
    }
  });

// Subcommand: init project memory
program
  .command('init')
  .description('Initialize Titao in the current project (creates TITAO.md)')
  .action(async () => {
    const { writeFile } = await import('fs/promises');
    const { existsSync } = await import('fs');

    if (existsSync('TITAO.md')) {
      console.log('TITAO.md already exists in this directory.');
      return;
    }

    const template = `# Titao Project Memory

## Project Description
<!-- Describe your project here. Titao will read this for context. -->

## Build Commands
<!-- e.g. npm run build, npm test -->

## Code Style & Rules
<!-- Note any code style preferences, conventions, or patterns. -->
`;

    await writeFile('TITAO.md', template, 'utf-8');
    console.log('✅ Created TITAO.md — edit it to give Titao persistent project memory.');
  });

// Subcommand: MCP server management
program
  .command('mcp [server]')
  .description('Configure MCP tool servers (e.g. titao mcp github)')
  .action(async (server?: string) => {
    const { writeFile, readFile, mkdir } = await import('fs/promises');
    const { existsSync } = await import('fs');
    const path = await import('path');

    const mcpDir = path.join(process.cwd(), '.titao');
    const mcpFile = path.join(mcpDir, 'mcp.json');

    let currentConfig: any = { mcpServers: {} };
    if (existsSync(mcpFile)) {
      try {
        const raw = await readFile(mcpFile, 'utf-8');
        currentConfig = JSON.parse(raw);
        if (!currentConfig.mcpServers) currentConfig.mcpServers = {};
      } catch {
        currentConfig = { mcpServers: {} };
      }
    }

    if (!server || server.toLowerCase() === 'github') {
      currentConfig.mcpServers.github = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}',
        },
      };

      if (!existsSync(mcpDir)) {
        await mkdir(mcpDir, { recursive: true });
      }

      await writeFile(mcpFile, JSON.stringify(currentConfig, null, 2), 'utf-8');
      console.log('\n✅ Configured GitHub MCP Server in .titao/mcp.json:');
      console.log('   Command: npx -y @modelcontextprotocol/server-github');
      console.log('   Token Env: GITHUB_TOKEN or GITHUB_PERSONAL_ACCESS_TOKEN\n');
      console.log('   Make sure GITHUB_TOKEN is set or run gh auth login before running Titao.');
    } else {
      console.log(`Configured MCP servers in ${mcpFile}:`);
      console.log(JSON.stringify(currentConfig.mcpServers, null, 2));
    }
  });

// Subcommand: CI workflow generator
program
  .command('ci')
  .description('Initialize CI/CD pipeline integration')
  .action(async () => {
    const result = await generateGitHubWorkflow();
    if (result.success) {
      console.log(`✅ Created GitHub Actions workflow at: ${result.filePath}`);
    }
  });

export { program };
