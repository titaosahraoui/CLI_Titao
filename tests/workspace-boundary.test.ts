import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { resolveWithinWorkspace } from '../src/core/workspace-boundary.js';
import {
  editFileTool,
  gitDiffTool,
  grepSearchTool,
  listDirTool,
  runCommandTool,
  semanticSearchTool,
  ToolRegistry,
  viewFileTool,
  writeFileTool,
} from '../src/tools/index.js';

const temporaryPaths: string[] = [];
const originalCwd = process.cwd();

async function makeTempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(directory);
  return directory;
}

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(
    temporaryPaths.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

describe('bounded path-tool parameters', () => {
  it.each([
    [
      'run_command timeout below minimum',
      runCommandTool,
      { command: 'node --version', timeout: 99 },
    ],
    [
      'run_command timeout above maximum',
      runCommandTool,
      { command: 'node --version', timeout: 300_001 },
    ],
    ['view_file startLine below minimum', viewFileTool, { path: 'README.md', startLine: 0 }],
    ['view_file endLine below minimum', viewFileTool, { path: 'README.md', endLine: 0 }],
    [
      'semantic_search result count below minimum',
      semanticSearchTool,
      { query: 'tools', maxResults: 0 },
    ],
    [
      'semantic_search result count above maximum',
      semanticSearchTool,
      { query: 'tools', maxResults: 51 },
    ],
  ])('rejects %s before execution', async (_name, tool, args) => {
    const registry = new ToolRegistry();
    registry.register(tool);

    const result = await registry.execute(tool.name, args);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid arguments/i);
  });
});

async function expectWorkspaceEscape(result: Awaited<ReturnType<typeof viewFileTool.execute>>) {
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/outside the approved workspace/i);
}

describe('resolveWithinWorkspace', () => {
  it('accepts an existing file inside the workspace', async () => {
    const root = await makeTempDirectory('titao-root-');
    const filePath = path.join(root, 'inside.txt');
    await writeFile(filePath, 'ok');

    await expect(resolveWithinWorkspace(root, 'inside.txt', 'read')).resolves.toBe(filePath);
  });

  it('rejects parent traversal outside the workspace', async () => {
    const root = await makeTempDirectory('titao-root-');
    const outside = await makeTempDirectory('titao-outside-');
    const outsideFile = path.join(outside, 'secret.txt');
    await writeFile(outsideFile, 'secret');
    const traversal = path.relative(root, outsideFile);

    await expect(resolveWithinWorkspace(root, traversal, 'read')).rejects.toThrow(
      /outside the approved workspace/i,
    );
  });

  it('rejects an absolute path outside the workspace', async () => {
    const root = await makeTempDirectory('titao-root-');
    const outside = await makeTempDirectory('titao-outside-');
    const outsideFile = path.join(outside, 'secret.txt');
    await writeFile(outsideFile, 'secret');

    await expect(resolveWithinWorkspace(root, outsideFile, 'read')).rejects.toThrow(
      /outside the approved workspace/i,
    );
  });

  it('rejects a symlink or junction that resolves outside the workspace', async () => {
    const root = await makeTempDirectory('titao-root-');
    const outside = await makeTempDirectory('titao-outside-');
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(
      outside,
      path.join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(resolveWithinWorkspace(root, 'escape/secret.txt', 'read')).rejects.toThrow(
      /outside the approved workspace/i,
    );
  });

  it('validates the nearest existing ancestor for a new write target', async () => {
    const root = await makeTempDirectory('titao-root-');
    await mkdir(path.join(root, 'src'));
    const target = path.join(root, 'src', 'new', 'deep.ts');

    await expect(resolveWithinWorkspace(root, 'src/new/deep.ts', 'write')).resolves.toBe(target);
  });

  it('prevents view_file from reading outside the workspace', async () => {
    const root = await makeTempDirectory('titao-root-');
    const outside = await makeTempDirectory('titao-outside-');
    const outsideFile = path.join(outside, 'secret.txt');
    await writeFile(outsideFile, 'secret');
    process.chdir(root);

    await expectWorkspaceEscape(
      await viewFileTool.execute({ path: path.relative(root, outsideFile) }),
    );
  });

  it('prevents write_file from writing outside the workspace', async () => {
    const root = await makeTempDirectory('titao-root-');
    const outside = await makeTempDirectory('titao-outside-');
    process.chdir(root);

    await expectWorkspaceEscape(
      await writeFileTool.execute({
        path: path.relative(root, path.join(outside, 'created.txt')),
        content: 'unsafe',
      }),
    );
  });

  it('prevents edit_file from editing outside the workspace', async () => {
    const root = await makeTempDirectory('titao-root-');
    const outside = await makeTempDirectory('titao-outside-');
    const outsideFile = path.join(outside, 'secret.txt');
    await writeFile(outsideFile, 'before');
    process.chdir(root);

    await expectWorkspaceEscape(
      await editFileTool.execute({
        path: path.relative(root, outsideFile),
        search: 'before',
        replace: 'after',
      }),
    );
  });

  it('prevents list_dir from listing outside the workspace', async () => {
    const root = await makeTempDirectory('titao-root-');
    const outside = await makeTempDirectory('titao-outside-');
    process.chdir(root);

    await expectWorkspaceEscape(await listDirTool.execute({ path: path.relative(root, outside) }));
  });

  it('prevents run_command from using a working directory outside the workspace', async () => {
    const root = await makeTempDirectory('titao-root-');
    const outside = await makeTempDirectory('titao-outside-');
    process.chdir(root);

    await expectWorkspaceEscape(
      await runCommandTool.execute({
        command: 'node --version',
        cwd: path.relative(root, outside),
      }),
    );
  });

  it('prevents grep_search from searching outside the workspace', async () => {
    const root = await makeTempDirectory('titao-root-');
    const outside = await makeTempDirectory('titao-outside-');
    await writeFile(path.join(outside, 'secret.txt'), 'needle');
    process.chdir(root);

    await expectWorkspaceEscape(
      await grepSearchTool.execute({
        query: 'needle',
        path: path.relative(root, outside),
      }),
    );
  });

  it('prevents git_diff from accepting a path outside the workspace', async () => {
    const outside = await makeTempDirectory('titao-outside-');
    const outsideFile = path.join(outside, 'secret.txt');
    await writeFile(outsideFile, 'secret');

    await expectWorkspaceEscape(await gitDiffTool.execute({ path: outsideFile }));
  });
});
