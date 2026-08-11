import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { resolveWithinWorkspace } from '../src/core/workspace-boundary.js';

const temporaryPaths: string[] = [];

async function makeTempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

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
});
