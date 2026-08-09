import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir, readFile } from 'fs/promises';
import path from 'path';
import {
  viewFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  runCommandTool,
  grepSearchTool,
  ToolRegistry,
} from '../src/tools/index.js';
import { PermissionManager } from '../src/core/permissions.js';
import { ContextManager } from '../src/core/context-manager.js';
import { buildSystemPrompt } from '../src/prompts/system.js';

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

  describe('Permission Manager', () => {
    it('correctly categorizes and applies default permissions', () => {
      const pm = new PermissionManager();
      expect(pm.isAutoApproved('view_file')).toBe(true);
      expect(pm.isAutoApproved('grep_search')).toBe(true);
      expect(pm.isAutoApproved('write_file')).toBe(false);
      expect(pm.isAutoApproved('run_command')).toBe(false);
    });

    it('supports session overrides and auto-approve all', () => {
      const pm = new PermissionManager();
      pm.approveToolForSession('write_file');
      expect(pm.isAutoApproved('write_file')).toBe(true);

      const autoPm = new PermissionManager(PermissionManager.autoApproveAll());
      expect(autoPm.isAutoApproved('run_command')).toBe(true);
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
});
