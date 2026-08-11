import { lstat, realpath } from 'fs/promises';
import path from 'path';

export type WorkspaceAccessMode = 'read' | 'write' | 'cwd';

async function exists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

async function canonicalizeWriteTarget(candidate: string): Promise<string> {
  let ancestor = candidate;
  const suffix: string[] = [];

  while (!(await exists(ancestor))) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      throw new Error(`No existing ancestor for write target: ${candidate}`);
    }
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }

  return path.join(await realpath(ancestor), ...suffix);
}

export async function resolveWithinWorkspace(
  root: string,
  inputPath: string,
  mode: WorkspaceAccessMode,
  additionalRoots: string[] = [],
): Promise<string> {
  if (!inputPath.trim()) throw new Error('Path must not be empty.');

  const canonicalRoots = await Promise.all(
    [root, ...additionalRoots].map((entry) => realpath(path.resolve(entry))),
  );
  const candidate = path.resolve(canonicalRoots[0], inputPath);

  if (!canonicalRoots.some((allowedRoot) => isContained(allowedRoot, candidate))) {
    throw new Error(`Path is outside the approved workspace: ${inputPath}`);
  }

  const canonicalCandidate =
    mode === 'write' ? await canonicalizeWriteTarget(candidate) : await realpath(candidate);

  if (!canonicalRoots.some((allowedRoot) => isContained(allowedRoot, canonicalCandidate))) {
    throw new Error(`Path is outside the approved workspace: ${inputPath}`);
  }

  return canonicalCandidate;
}
