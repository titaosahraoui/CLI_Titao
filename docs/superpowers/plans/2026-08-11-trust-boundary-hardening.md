# Titao Trust-Boundary Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Titao safe to start in an untrusted repository and ensure no file, command, hook, MCP server, batch run, or subagent can exceed an explicit user policy.

**Architecture:** Introduce one canonical workspace path resolver and one execution-policy factory, then route every side-effect boundary through them. Treat repository hooks and MCP commands as inactive data until a content-hash-based workspace trust decision enables them. Restrict text fallback tool calls to an explicit protocol delimiter so prose cannot become an action.

**Tech Stack:** Node.js 20+, TypeScript 5.6 ESM, Zod, Commander, Conf, Vitest

## Global Constraints

- Preserve strict TypeScript settings and explicit `.js` extensions in source imports.
- Keep Ollama/local execution as the default; cloud providers remain opt-in.
- All tool parameters continue to use Zod schemas.
- Reads may be automatic only inside approved roots; writes, commands, git mutations, hooks, MCP processes, and external writes require policy authorization.
- Windows drive, UNC, junction, and case behavior must be tested alongside POSIX traversal and symlink behavior.
- Secrets may influence child environments but must never appear in prompts, logs, snapshots, error strings, or trust fingerprints.

---

## File structure

- Create `src/core/workspace-boundary.ts`: canonical path/ancestor resolution and allowed-root enforcement.
- Create `src/core/execution-policy.ts`: interactive, batch read-only, and explicit auto-approve policy construction.
- Create `src/core/workspace-trust.ts`: fingerprint repository execution config and persist/revoke trust.
- Create `tests/workspace-boundary.test.ts`: traversal, absolute path, symlink/junction, and write-target cases.
- Create `tests/execution-policy.test.ts`: batch and subagent non-escalation cases.
- Create `tests/workspace-trust.test.ts`: fingerprint invalidation and untrusted startup cases.
- Create `tests/tool-call-parser.test.ts`: explicit fallback protocol cases.
- Create `tests/security-integration.test.ts`: prove untrusted startup and batch mode spawn no side effects.
- Modify `src/tools/view-file.ts`, `write-file.ts`, `edit-file.ts`, `list-dir.ts`, `grep-search.ts`, `run-command.ts`, `git.ts`, and `semantic-search.ts`: consume the workspace resolver.
- Modify `src/core/permissions.ts`, `subagent-manager.ts`, and `agent-loop.ts`: preserve/narrow policies and add safe tool lifecycle callbacks.
- Modify `src/app.ts` and `src/cli.ts`: construct the correct policy, gate repository execution config, and expose trust commands.
- Modify `src/mcp/config-loader.ts`: connect servers only after a trust decision.
- Modify `src/providers/tool-call-parser.ts` and `src/prompts/system.ts`: use the explicit fallback protocol.

---

### Task 1: Canonical workspace path resolver

**Files:**

- Create: `src/core/workspace-boundary.ts`
- Modify: `src/core/index.ts`
- Test: `tests/workspace-boundary.test.ts`

**Interfaces:**

- Consumes: a canonical workspace root, a user-supplied path, and access mode `'read' | 'write' | 'cwd'`.
- Produces: `resolveWithinWorkspace(root: string, inputPath: string, mode: WorkspaceAccessMode, additionalRoots?: string[]): Promise<string>`.

- [ ] **Step 1: Write failing traversal and absolute-path tests**

```ts
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { resolveWithinWorkspace } from '../src/core/workspace-boundary.js';

describe('resolveWithinWorkspace', () => {
  it('accepts an existing file inside the workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'titao-root-'));
    await writeFile(path.join(root, 'inside.txt'), 'ok');
    await expect(resolveWithinWorkspace(root, 'inside.txt', 'read')).resolves.toBe(
      path.join(root, 'inside.txt'),
    );
    await rm(root, { recursive: true, force: true });
  });

  it('rejects parent traversal and absolute paths outside the workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'titao-root-'));
    const outside = path.join(path.dirname(root), 'outside.txt');
    await writeFile(outside, 'secret');
    await expect(resolveWithinWorkspace(root, '../outside.txt', 'read')).rejects.toThrow(
      /outside the approved workspace/i,
    );
    await expect(resolveWithinWorkspace(root, outside, 'read')).rejects.toThrow(
      /outside the approved workspace/i,
    );
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  });

  it('rejects a symlink or junction that resolves outside the workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'titao-root-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'titao-outside-'));
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(
      outside,
      path.join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(resolveWithinWorkspace(root, 'escape/secret.txt', 'read')).rejects.toThrow(
      /outside the approved workspace/i,
    );
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('validates the nearest existing ancestor for a new write target', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'titao-root-'));
    await mkdir(path.join(root, 'src'));
    await expect(resolveWithinWorkspace(root, 'src/new/deep.ts', 'write')).resolves.toBe(
      path.join(root, 'src', 'new', 'deep.ts'),
    );
    await rm(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the module is absent**

Run: `npx vitest run tests/workspace-boundary.test.ts`

Expected: FAIL with a module resolution error for `src/core/workspace-boundary.ts`.

- [ ] **Step 3: Implement canonical resolution and containment**

```ts
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
    if (parent === ancestor) throw new Error(`No existing ancestor for write target: ${candidate}`);
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
  const candidate = path.resolve(root, inputPath);
  const canonicalCandidate =
    mode === 'write' ? await canonicalizeWriteTarget(candidate) : await realpath(candidate);
  if (!canonicalRoots.some((allowedRoot) => isContained(allowedRoot, canonicalCandidate))) {
    throw new Error(`Path is outside the approved workspace: ${inputPath}`);
  }
  return canonicalCandidate;
}
```

- [ ] **Step 4: Export the resolver and run its tests**

Add to `src/core/index.ts`:

```ts
export { resolveWithinWorkspace } from './workspace-boundary.js';
export type { WorkspaceAccessMode } from './workspace-boundary.js';
```

Run: `npx vitest run tests/workspace-boundary.test.ts`

Expected: 4 tests pass on the current OS.

- [ ] **Step 5: Commit the isolated resolver**

```bash
git add src/core/workspace-boundary.ts src/core/index.ts tests/workspace-boundary.test.ts
git commit -m "security: add canonical workspace path boundary"
```

### Task 2: Route every built-in path through the boundary

**Files:**

- Modify: `src/tools/view-file.ts`
- Modify: `src/tools/write-file.ts`
- Modify: `src/tools/edit-file.ts`
- Modify: `src/tools/list-dir.ts`
- Modify: `src/tools/grep-search.ts`
- Modify: `src/tools/run-command.ts`
- Modify: `src/tools/git.ts`
- Modify: `src/tools/semantic-search.ts`
- Test: `tests/workspace-boundary.test.ts`

**Interfaces:**

- Consumes: `resolveWithinWorkspace()` from Task 1.
- Produces: all built-in path arguments are workspace-confined before filesystem/process access.

- [ ] **Step 1: Add failing tool-level escape tests**

```ts
import { viewFileTool, writeFileTool, listDirTool, runCommandTool } from '../src/tools/index.js';

it.each([
  ['view_file', () => viewFileTool.execute({ path: '../outside.txt' })],
  ['write_file', () => writeFileTool.execute({ path: '../outside.txt', content: 'x' })],
  ['list_dir', () => listDirTool.execute({ path: '..' })],
  ['run_command', () => runCommandTool.execute({ command: 'node --version', cwd: '..' })],
])('%s rejects workspace escape', async (_name, execute) => {
  const result = await execute();
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/outside the approved workspace/i);
});
```

Run: `npx vitest run tests/workspace-boundary.test.ts`

Expected: each new tool-level case fails because current tools permit the path.

- [ ] **Step 2: Replace duplicated path helpers**

In every file tool, import the boundary:

```ts
import { resolveWithinWorkspace } from '../core/workspace-boundary.js';
```

Resolve reads with:

```ts
const filePath = await resolveWithinWorkspace(process.cwd(), args.path as string, 'read');
```

Resolve writes with:

```ts
const filePath = await resolveWithinWorkspace(process.cwd(), args.path as string, 'write');
```

Resolve command working directories with:

```ts
const cwd = await resolveWithinWorkspace(
  process.cwd(),
  (args.cwd as string | undefined) ?? '.',
  'cwd',
);
```

Resolve grep/search roots before building subprocess arguments. In `git_diff`, insert an argument terminator before a user path:

```ts
if (typeof args.path === 'string' && args.path.trim()) {
  const safePath = await resolveWithinWorkspace(process.cwd(), args.path.trim(), 'read');
  options.push('--', path.relative(process.cwd(), safePath));
}
```

- [ ] **Step 3: Bound numeric parameters in Zod**

Use these schemas:

```ts
timeout: z.number().int().min(100).max(300_000).optional();
maxResults: z.number().int().min(1).max(50).optional();
startLine: z.number().int().min(1).optional();
endLine: z.number().int().min(1).optional();
```

- [ ] **Step 4: Run boundary, tool, build, and formatting checks**

Run:

```bash
npx vitest run tests/workspace-boundary.test.ts tests/titao.test.ts
npm run build
npx prettier --check src/core/workspace-boundary.ts src/tools tests/workspace-boundary.test.ts
```

Expected: all tests and build pass; Prettier reports no changes required for touched files.

- [ ] **Step 5: Commit path confinement**

```bash
git add src/tools tests/workspace-boundary.test.ts
git commit -m "security: confine built-in tools to workspace"
```

### Task 3: Non-escalating execution policies

**Files:**

- Create: `src/core/execution-policy.ts`
- Modify: `src/core/permissions.ts`
- Modify: `src/core/subagent-manager.ts`
- Modify: `src/app.ts`
- Test: `tests/execution-policy.test.ts`

**Interfaces:**

- Consumes: `{ interactive: boolean; autoApprove: boolean }`.
- Produces: `createExecutionPolicy(options): PermissionPolicy` and `isPolicyNarrowerOrEqual(child, parent): boolean`.

- [ ] **Step 1: Write failing policy tests**

```ts
import { describe, expect, it } from 'vitest';
import { createExecutionPolicy, isPolicyNarrowerOrEqual } from '../src/core/execution-policy.js';

describe('execution policy', () => {
  it('makes batch mode read-only without explicit auto-approve', () => {
    expect(createExecutionPolicy({ interactive: false, autoApprove: false })).toEqual({
      reads: 'auto',
      writes: 'deny',
      commands: 'deny',
      git: 'deny',
    });
  });

  it('allows explicit auto-approve', () => {
    expect(createExecutionPolicy({ interactive: false, autoApprove: true })).toEqual({
      reads: 'auto',
      writes: 'auto',
      commands: 'auto',
      git: 'auto',
    });
  });

  it('rejects a child policy broader than its parent', () => {
    const parent = { reads: 'auto', writes: 'ask', commands: 'deny', git: 'deny' } as const;
    const child = { reads: 'auto', writes: 'auto', commands: 'deny', git: 'deny' } as const;
    expect(isPolicyNarrowerOrEqual(child, parent)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement the policy factory and ordering**

```ts
import type { PermissionLevel, PermissionPolicy } from './permissions.js';

const POWER: Record<PermissionLevel, number> = { deny: 0, ask: 1, auto: 2 };

export function createExecutionPolicy(options: {
  interactive: boolean;
  autoApprove: boolean;
}): PermissionPolicy {
  if (options.autoApprove) return { reads: 'auto', writes: 'auto', commands: 'auto', git: 'auto' };
  if (!options.interactive) return { reads: 'auto', writes: 'deny', commands: 'deny', git: 'deny' };
  return { reads: 'auto', writes: 'ask', commands: 'ask', git: 'ask' };
}

export function isPolicyNarrowerOrEqual(
  child: PermissionPolicy,
  parent: PermissionPolicy,
): boolean {
  return (Object.keys(parent) as Array<keyof PermissionPolicy>).every(
    (key) => POWER[child[key]] <= POWER[parent[key]],
  );
}
```

- [ ] **Step 3: Preserve the policy in batch mode**

In `startTitao()`, construct the manager once:

```ts
const permissionPolicy = createExecutionPolicy({
  interactive: !options.prompt,
  autoApprove: options.autoApprove,
});
const permissions = new PermissionManager(permissionPolicy);
```

Delete `const autoPermissions = new PermissionManager(PermissionManager.autoApproveAll())` from `runSinglePrompt()` and pass its `permissions` parameter into `AgentLoop`.

- [ ] **Step 4: Require a parent policy for subagents**

Add `permissionPolicy: PermissionPolicy` to `SubagentOptions`, construct the subagent manager from that exact policy, and remove `autoApproveAll()`. Any future child override must pass `isPolicyNarrowerOrEqual()` or throw `Subagent permission policy exceeds parent policy.`

- [ ] **Step 5: Run policy and full tests**

Run:

```bash
npx vitest run tests/execution-policy.test.ts tests/titao.test.ts
npm run build
```

Expected: policy tests and existing tests pass; TypeScript reports no errors.

- [ ] **Step 6: Commit permission hardening**

```bash
git add src/core/execution-policy.ts src/core/permissions.ts src/core/subagent-manager.ts src/app.ts tests/execution-policy.test.ts
git commit -m "security: preserve permissions in batch and subagents"
```

### Task 4: Content-hash-based workspace trust for hooks and MCP

**Files:**

- Create: `src/core/workspace-trust.ts`
- Modify: `src/cli.ts`
- Modify: `src/app.ts`
- Modify: `src/mcp/config-loader.ts`
- Modify: `src/core/agent-loop.ts`
- Test: `tests/workspace-trust.test.ts`

**Interfaces:**

- Consumes: canonical workspace path plus `.titao/hooks.json` and `.titao/mcp.json` bytes.
- Produces: `WorkspaceTrustStore.fingerprint()`, `.isTrusted()`, `.trust()`, `.revoke()`, and `.list()`.

- [ ] **Step 1: Write failing fingerprint and invalidation tests**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { WorkspaceTrustStore } from '../src/core/workspace-trust.js';

describe('WorkspaceTrustStore', () => {
  it('invalidates trust when executable repository config changes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'titao-trust-'));
    await mkdir(path.join(root, '.titao'));
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
});
```

- [ ] **Step 2: Implement fingerprinting without secrets**

Hash the canonical root and raw bytes of only `.titao/hooks.json` and `.titao/mcp.json`:

```ts
const fingerprint = createHash('sha256')
  .update(canonicalRoot)
  .update('\0hooks\0')
  .update(hooksBytes)
  .update('\0mcp\0')
  .update(mcpBytes)
  .digest('hex');
```

Persist `{ canonicalRoot, fingerprint, trustedAt }` using `conf`. Do not expand or hash environment values, because secrets must not enter the store.

- [ ] **Step 3: Gate startup process creation**

Before `loadAndRegisterMcpServers()` and before enabling hooks:

```ts
const trusted = await trustStore.isTrusted(process.cwd());
if (!trusted) {
  console.log(
    chalk.yellow(
      '  Repository hooks and MCP servers are disabled until this workspace is trusted.',
    ),
  );
}
const mcpClients = trusted ? await loadAndRegisterMcpServers(toolRegistry, process.cwd()) : [];
if (trusted) await hooksEngine.loadHooks();
```

Non-interactive mode must not prompt. It remains untrusted unless a matching stored fingerprint exists or a separate explicit `--trust-workspace` flag is supplied with `--auto-approve`.

- [ ] **Step 4: Add trust CLI commands**

Implement:

```text
titao trust                 # print current status and exact hook/MCP command metadata
titao trust --grant         # store current fingerprint after confirmation
titao trust --revoke        # delete current root entry
titao trust --list          # list canonical roots and timestamps, never secrets
```

Commander actions must use `WorkspaceTrustStore`; `--grant` prints commands/arguments and environment variable names before asking.

- [ ] **Step 5: Move hook execution after approval and make failure authoritative**

Add callbacks to `AgentCallbacks`:

```ts
onBeforeToolExecute?: (name: string, args: Record<string, unknown>) => Promise<{ allowed: boolean; message?: string }>;
onAfterToolExecute?: (name: string, args: Record<string, unknown>, success: boolean) => Promise<void>;
```

Call `onBeforeToolExecute` after permission approval and immediately before backup/execution. For write/edit, return `{ allowed: false, message: preHook.error }` when any pre-edit hook fails. Call post-edit only after a successful write/edit. Wire pre/post-commit around `git_commit` the same way.

- [ ] **Step 6: Run trust and lifecycle tests**

Run:

```bash
npx vitest run tests/workspace-trust.test.ts tests/security-integration.test.ts
npm run build
```

Expected: changing executable config invalidates trust, untrusted startup spawns no child, and a failed pre-hook prevents the target tool.

- [ ] **Step 7: Commit trusted-workspace controls**

```bash
git add src/core/workspace-trust.ts src/cli.ts src/app.ts src/mcp/config-loader.ts src/core/agent-loop.ts tests/workspace-trust.test.ts tests/security-integration.test.ts
git commit -m "security: gate repository hooks and MCP behind trust"
```

### Task 5: Explicit text fallback tool protocol

**Files:**

- Modify: `src/providers/tool-call-parser.ts`
- Modify: `src/prompts/system.ts`
- Test: `tests/tool-call-parser.test.ts`

**Interfaces:**

- Consumes: native tool calls first; otherwise exact `<tool_call>JSON</tool_call>` blocks.
- Produces: parsed calls plus untouched prose; arbitrary JSON in Markdown never becomes executable.

- [ ] **Step 1: Write failing parser safety tests**

````ts
import { describe, expect, it } from 'vitest';
import { parseToolCallsFromText } from '../src/providers/tool-call-parser.js';

describe('parseToolCallsFromText', () => {
  it('does not execute JSON examples in prose', () => {
    const text =
      'Example:\n```json\n{"name":"run_command","arguments":{"command":"echo unsafe"}}\n```';
    const parsed = parseToolCallsFromText(text, ['run_command']);
    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.text).toContain('run_command');
  });

  it('parses one explicitly delimited fallback call', () => {
    const parsed = parseToolCallsFromText(
      '<tool_call>{"name":"view_file","arguments":{"path":"README.md"}}</tool_call>',
      ['view_file'],
    );
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].function).toEqual({
      name: 'view_file',
      arguments: { path: 'README.md' },
    });
    expect(parsed.text).toBe('');
  });
});
````

- [ ] **Step 2: Replace balanced free-form scanning with delimiter parsing**

Use a global, non-greedy delimiter regex:

```ts
const TOOL_CALL_BLOCK = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
```

For every match, require an object with a string `name` and object `arguments`, verify `availableTools.includes(name)`, and leave invalid blocks in response text with no tool call. Remove only successfully parsed blocks.

- [ ] **Step 3: Update the system prompt contract**

Add one exact instruction for local models without native tool calling:

```text
If native tool calling is unavailable, emit exactly one fallback block as <tool_call>{"name":"tool_name","arguments":{...}}</tool_call>. Never place examples or explanatory prose inside a tool_call block.
```

- [ ] **Step 4: Run parser and build checks**

Run:

```bash
npx vitest run tests/tool-call-parser.test.ts
npm run build
```

Expected: prose JSON remains text; an explicit valid block produces one call.

- [ ] **Step 5: Commit the protocol change**

```bash
git add src/providers/tool-call-parser.ts src/prompts/system.ts tests/tool-call-parser.test.ts
git commit -m "security: require explicit fallback tool-call blocks"
```

### Task 6: End-to-end security regression gate

**Files:**

- Modify: `tests/security-integration.test.ts`
- Modify: `package.json`
- Create: `.github/workflows/quality.yml`

**Interfaces:**

- Consumes: Tasks 1–5.
- Produces: one repeatable command and CI job proving the trust boundary on Windows and Linux.

- [ ] **Step 1: Add end-to-end denial cases**

Use a fake provider that emits `write_file`, `run_command`, and fallback-prose JSON calls. Assert:

```ts
expect(outsideFileExists).toBe(false);
expect(spawnedCommands).toEqual([]);
expect(mcpProcessStarted).toBe(false);
expect(hookProcessStarted).toBe(false);
expect(toolObservations).toContainEqual(expect.stringMatching(/denied|outside|untrusted/i));
```

Cover these scenarios independently:

1. `-p` without `--auto-approve` requests a write.
2. an auto-approved write targets `../outside.txt`.
3. an untrusted repository contains hook and MCP commands.
4. normal response prose contains a `run_command` JSON example.
5. a subagent receives a read-only parent policy and requests a command.

- [ ] **Step 2: Add a dedicated local security command**

Add to `package.json`:

```json
"test:security": "vitest run tests/workspace-boundary.test.ts tests/execution-policy.test.ts tests/workspace-trust.test.ts tests/tool-call-parser.test.ts tests/security-integration.test.ts"
```

- [ ] **Step 3: Add the cross-platform quality workflow**

```yaml
name: Quality
on:
  pull_request:
  push:
    branches: [main]
jobs:
  security:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm run test:security
      - run: npm run test:run
```

- [ ] **Step 4: Run the complete verification gate locally**

Run:

```bash
npm run build
npm run test:security
npm run test:run
npm audit --audit-level=high
git diff --check
```

Expected: every command exits 0, all security scenarios pass, and `git diff --check` prints no whitespace errors.

- [ ] **Step 5: Commit the security gate**

```bash
git add tests/security-integration.test.ts package.json .github/workflows/quality.yml
git commit -m "test: enforce trust boundary across platforms"
```

## Self-review

- **Spec coverage:** Tasks 1–2 cover workspace escape; Task 3 covers batch/subagent policy; Task 4 covers repository hooks/MCP trust and hook ordering; Task 5 covers prose-to-action ambiguity; Task 6 makes the boundaries a release gate.
- **Deferred on purpose:** provider streaming/wire format, MCP protocol completeness, context integrity, branch-aware review, configuration profiles, release packaging, semantic index, and VS Code work are independent follow-on plans listed in the audit backlog.
- **Type consistency:** `resolveWithinWorkspace`, `createExecutionPolicy`, `isPolicyNarrowerOrEqual`, and `WorkspaceTrustStore` names are used consistently throughout the plan.
- **Placeholder scan:** implementation steps contain concrete interfaces, code, commands, and expected outcomes; no unresolved implementation placeholders remain.
