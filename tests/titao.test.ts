import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import {
  viewFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  runCommandTool,
  ToolRegistry,
} from '../src/tools/index.js';
import { PermissionManager } from '../src/core/permissions.js';
import { ContextManager } from '../src/core/context-manager.js';
import { UndoManager } from '../src/core/undo-manager.js';
import { HooksEngine } from '../src/hooks/engine.js';
import { generateGitHubWorkflow } from '../src/ci/workflow-generator.js';
import { createProvider } from '../src/providers/provider-factory.js';
import { buildSystemPrompt } from '../src/prompts/system.js';
import { createThrottledMarkdownRenderer } from '../src/utils/response-formatter.js';
import { extractGithubTokenFromHostsYaml } from '../src/tools/github.js';

const TEST_DIR = path.resolve('./temp_test_env');

describe('⚡ Titao Core & Tool System Test Suite', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('Tool System', () => {
    it('ToolRegistry registers and retrieves tool definitions', () => {
      const registry = new ToolRegistry();
      registry.register(viewFileTool);
      registry.register(writeFileTool);

      expect(registry.has('view_file')).toBe(true);
      expect(registry.has('write_file')).toBe(true);
      expect(registry.has('unknown')).toBe(false);

      const defs = registry.getToolDefinitions();
      expect(defs.length).toBe(2);
      expect(defs[0].function.name).toBe('view_file');
    });

    it('write_file creates file and view_file reads it back', async () => {
      const targetFile = path.join(TEST_DIR, 'hello.txt');

      const writeRes = await writeFileTool.execute({
        path: targetFile,
        content: 'Line 1\nLine 2\nLine 3',
      });
      expect(writeRes.success).toBe(true);

      const viewRes = await viewFileTool.execute({
        path: targetFile,
      });
      expect(viewRes.success).toBe(true);
      expect(viewRes.output).toContain('Line 1');
      expect(viewRes.output).toContain('Line 3');
    });

    it('edit_file safely replaces exact matching text', async () => {
      const targetFile = path.join(TEST_DIR, 'code.ts');
      await writeFileTool.execute({
        path: targetFile,
        content: 'const x = 10;\nconst y = 20;',
      });

      const editRes = await editFileTool.execute({
        path: targetFile,
        search: 'const x = 10;',
        replace: 'const x = 99;',
      });
      expect(editRes.success).toBe(true);

      const updated = await readFile(targetFile, 'utf-8');
      expect(updated).toBe('const x = 99;\nconst y = 20;');
    });

    it('list_dir lists directory contents', async () => {
      await writeFileTool.execute({
        path: path.join(TEST_DIR, 'a.txt'),
        content: 'test',
      });

      const listRes = await listDirTool.execute({
        path: TEST_DIR,
      });
      expect(listRes.success).toBe(true);
      expect(listRes.output).toContain('a.txt');
    });

    it('run_command executes shell command', async () => {
      const cmdRes = await runCommandTool.execute({
        command: 'echo "Titao Engine Online"',
      });
      expect(cmdRes.success).toBe(true);
      expect(cmdRes.output).toContain('Titao Engine Online');
    });
  });

  describe('Hooks Engine & Team Styling', () => {
    it('executes pre-edit and post-edit hooks successfully', async () => {
      const engine = new HooksEngine(TEST_DIR);
      engine.registerHook({
        event: 'pre-edit',
        command: 'echo "Pre-Edit Hook Fired"',
      });

      const results = await engine.runHooks('pre-edit');
      expect(results.length).toBe(1);
      expect(results[0].success).toBe(true);
      expect(results[0].output).toContain('Pre-Edit Hook Fired');
    });
  });

  describe('CI/CD Workflow Generator', () => {
    it('generates .github/workflows/titao-ci.yml file', async () => {
      const res = await generateGitHubWorkflow(TEST_DIR);
      expect(res.success).toBe(true);
      expect(existsSync(res.filePath)).toBe(true);

      const content = await readFile(res.filePath, 'utf-8');
      expect(content).toContain('Titao AI Code Review');
    });

    it('installs the checked-out CLI instead of requiring a published npm package', async () => {
      const res = await generateGitHubWorkflow(TEST_DIR);

      const content = await readFile(res.filePath, 'utf-8');
      expect(content).toContain('npm ci');
      expect(content).toContain('npm run build');
      expect(content).toContain('npm install -g .');
      expect(content).not.toContain('npm install -g titao');
    });
  });

  describe('Multi-Provider Factory', () => {
    it('instantiates Ollama and OpenRouter providers', () => {
      const ollama = createProvider({ type: 'ollama', model: 'qwen2.5-coder:7b' });
      expect(ollama).toBeDefined();

      const openrouter = createProvider({ type: 'openrouter', model: 'qwen/qwen-2.5-coder-32b' });
      expect(openrouter).toBeDefined();
    });
  });

  describe('Undo Manager & Safety', () => {
    it('backs up file and restores content on undo()', async () => {
      const targetFile = path.join(TEST_DIR, 'sample.txt');
      await writeFileTool.execute({ path: targetFile, content: 'Original Version' });

      const undoMgr = new UndoManager();
      await undoMgr.backupFile(targetFile);

      await writeFileTool.execute({ path: targetFile, content: 'Modified Version' });
      expect(await readFile(targetFile, 'utf-8')).toBe('Modified Version');

      const undoRes = await undoMgr.undo();
      expect(undoRes.success).toBe(true);
      expect(await readFile(targetFile, 'utf-8')).toBe('Original Version');
    });

    it('deletes newly created files on undo()', async () => {
      const newFile = path.join(TEST_DIR, 'new_file.txt');
      const undoMgr = new UndoManager();

      await undoMgr.backupFile(newFile);
      await writeFileTool.execute({ path: newFile, content: 'Brand New' });

      const undoRes = await undoMgr.undo();
      expect(undoRes.success).toBe(true);
      expect(undoRes.message).toContain('Deleted newly created file');
    });
  });

  describe('Context Manager', () => {
    it('assembles messages and tracks token usage', () => {
      const sysPrompt = buildSystemPrompt({ cwd: '/test', model: 'qwen2.5-coder:32b' });
      const cm = new ContextManager(sysPrompt, 8192);

      cm.addMessage({ role: 'user', content: 'Hello Titao' });
      cm.addMessage({ role: 'assistant', content: 'Ready to assist.' });

      const msgs = cm.assembleMessages();
      expect(msgs.length).toBe(3); // system + user + assistant
      expect(msgs[0].role).toBe('system');
      expect(msgs[0].content).toContain('You are Titao');

      cm.updateTokenUsage({ promptTokens: 100, completionTokens: 50 });
      const usage = cm.getTokenUsage();
      expect(usage.total).toBe(150);
    });
  });

  describe('GitHub Integration', () => {
    it('categorizes GitHub issue tools by read/write behavior', () => {
      const permissions = new PermissionManager();

      expect(permissions.categorize('github_list_issues')).toBe('reads');
      expect(permissions.categorize('github_create_issue')).toBe('writes');
    });

    it('extracts oauth_token from GitHub CLI hosts.yml', () => {
      const hostsYaml = `github.com:
  user: octocat
  oauth_token: "gho_testtoken"
  git_protocol: https
`;

      expect(extractGithubTokenFromHostsYaml(hostsYaml)).toBe('gho_testtoken');
    });

    it('extracts nested oauth_token from GitHub CLI hosts.yml', () => {
      const hostsYaml = `github.com:
  users:
    octocat:
      oauth_token: gho_nestedtoken
`;

      expect(extractGithubTokenFromHostsYaml(hostsYaml)).toBe('gho_nestedtoken');
    });
  });

  describe('Response Formatter', () => {
    it('throttles markdown rendering and flushes latest content', () => {
      vi.useFakeTimers();
      const writes: string[] = [];
      const renderer = createThrottledMarkdownRenderer((text) => writes.push(text), 50);

      renderer.push('first');
      renderer.push('second');
      expect(writes).toHaveLength(0);

      vi.advanceTimersByTime(49);
      expect(writes).toHaveLength(0);

      vi.advanceTimersByTime(1);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain('second');

      renderer.push('third');
      renderer.flush();
      expect(writes).toHaveLength(2);
      expect(writes[1]).toContain('third');

      vi.useRealTimers();
    });
  });
});
