import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  inspectWorkspaceExecutionConfig,
  WorkspaceTrustStore,
} from '../src/core/workspace-trust.js';

const temporaryPaths: string[] = [];

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'titao-trust-'));
  temporaryPaths.push(root);
  await mkdir(path.join(root, '.titao'));
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

describe('WorkspaceTrustStore', () => {
  it('invalidates trust when executable repository config changes', async () => {
    const root = await makeWorkspace();
    await writeFile(path.join(root, '.titao', 'hooks.json'), '{"hooks":[]}');
    const store = new WorkspaceTrustStore({ projectName: `test-${path.basename(root)}` });

    await store.trust(root);
    expect(await store.isTrusted(root)).toBe(true);

    await writeFile(
      path.join(root, '.titao', 'hooks.json'),
      '{"hooks":[{"event":"pre-edit","command":"echo changed"}]}',
    );
    expect(await store.isTrusted(root)).toBe(false);
  });

  it('invalidates trust when MCP process configuration changes', async () => {
    const root = await makeWorkspace();
    const mcpFile = path.join(root, '.titao', 'mcp.json');
    await writeFile(mcpFile, '{"mcpServers":{"one":{"command":"node","args":["one.js"]}}}');
    const store = new WorkspaceTrustStore({ projectName: `test-${path.basename(root)}` });

    await store.trust(root);
    await writeFile(mcpFile, '{"mcpServers":{"one":{"command":"node","args":["two.js"]}}}');

    expect(await store.isTrusted(root)).toBe(false);
  });

  it('can list and revoke a trusted canonical workspace', async () => {
    const root = await makeWorkspace();
    const store = new WorkspaceTrustStore({ projectName: `test-${path.basename(root)}` });

    const trusted = await store.trust(root);
    expect(await store.list()).toContainEqual(trusted);

    await store.revoke(root);
    expect(await store.isTrusted(root)).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  it('does not depend on expanded environment secret values', async () => {
    const root = await makeWorkspace();
    await writeFile(
      path.join(root, '.titao', 'mcp.json'),
      '{"mcpServers":{"github":{"command":"node","env":{"TOKEN":"${TITAO_TEST_SECRET}"}}}}',
    );
    const store = new WorkspaceTrustStore({ projectName: `test-${path.basename(root)}` });
    const previous = process.env.TITAO_TEST_SECRET;

    try {
      process.env.TITAO_TEST_SECRET = 'first-secret';
      const first = await store.fingerprint(root);
      process.env.TITAO_TEST_SECRET = 'second-secret';
      const second = await store.fingerprint(root);
      expect(second).toBe(first);
    } finally {
      if (previous === undefined) delete process.env.TITAO_TEST_SECRET;
      else process.env.TITAO_TEST_SECRET = previous;
    }
  });

  it('reports executable metadata without exposing environment values', async () => {
    const root = await makeWorkspace();
    await writeFile(
      path.join(root, '.titao', 'hooks.json'),
      '{"hooks":[{"event":"pre-edit","command":"npm test"}]}',
    );
    await writeFile(
      path.join(root, '.titao', 'mcp.json'),
      '{"mcpServers":{"github":{"command":"node","args":["server.js"],"env":{"TOKEN":"literal-secret"}}}}',
    );

    const metadata = await inspectWorkspaceExecutionConfig(root);

    expect(metadata).toEqual({
      hooks: [{ event: 'pre-edit', command: 'npm test', enabled: true }],
      mcpServers: [
        { name: 'github', command: 'node', args: ['server.js'], environmentVariables: ['TOKEN'] },
      ],
    });
    expect(JSON.stringify(metadata)).not.toContain('literal-secret');
  });
});
