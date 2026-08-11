# Titao Codebase Review

**Reviewed:** 2026-08-11  
**Revision:** `4463307` (`main`)  
**Scope:** all tracked source, tests, automation, examples, package metadata, and the live GitHub issue list

## Executive outcome

Titao has a coherent early architecture: provider abstraction, a central tool registry, explicit permission categories, undo snapshots, MCP support, and a small test suite. TypeScript compilation, the 15 current tests, the npm audit, and the package dry-run all complete successfully when run with normal host permissions.

It is not ready for untrusted repositories or unattended use. Three trust-boundary problems should block new feature work:

1. `titao -p` and subagents silently replace the configured permission policy with auto-approve-all.
2. file and command tools accept paths outside the workspace, including absolute paths and `..` traversal.
3. repository-controlled MCP configuration launches subprocesses at startup, while repository-controlled pre-edit hooks run before the permission question is answered.

The advertised streaming, cloud-provider tool loop, MCP interoperability, and CI review workflow also have correctness gaps. The recommended sequence is therefore: secure execution first, make the core loop and provider protocol reliable second, then ship configuration, CI review, indexing, and editor integration features.

## Verification evidence

| Check                                    | Result     | Notes                                                                                                                                |
| ---------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npx tsc --noEmit`                       | Pass       | Strict TypeScript check completed with exit 0.                                                                                       |
| `node scripts/publish.js`                | Pass       | Build, 15 Vitest tests, shebang check, and npm pack dry-run passed outside the sandbox.                                              |
| `npm audit --json`                       | Pass       | 0 known vulnerabilities across 388 resolved dependencies.                                                                            |
| `npm run lint`                           | Fail       | Existing issue [#4](https://github.com/titaosahraoui/CLI_Titao/issues/4): ESLint 9 has no `eslint.config.*`.                         |
| `npx prettier --check src tests scripts` | Fail       | 22 files do not match the checked-in Prettier configuration.                                                                         |
| npm package contents                     | Needs work | 214 files / 464.1 KB unpacked; source, maps, scripts, examples, workflow, `.titao` config, tests, and VS Code metadata are included. |

The first in-sandbox build/test attempt failed with filesystem/spawn `EPERM`. Re-running the repository's validation script with normal host permissions proved those failures were environmental, not compiler or test failures.

## Findings

### Critical security and safety

#### S1. Non-interactive and subagent execution bypass permission policy

- Evidence: `runSinglePrompt()` constructs `PermissionManager.autoApproveAll()` unconditionally in `src/app.ts:303-320`; `SubagentManager` does the same in `src/core/subagent-manager.ts:40-41`.
- Impact: `titao -p "..."` can execute shell commands, overwrite files, commit changes, or create external issues even when `--auto-approve` was not supplied. A delegated subagent has the same unrestricted power.
- Required fix: preserve the caller's policy, default non-interactive execution to deny side effects, and require the explicit `--auto-approve` flag (or a narrowly scoped policy file) for unattended mutations.

#### S2. Tools are not confined to the workspace

- Evidence: `src/tools/view-file.ts:6-8`, `write-file.ts:6-8`, and `edit-file.ts:6-8` strip leading slashes but accept `..` and Windows drive paths; `list-dir.ts:15`, `run-command.ts:22`, and `grep-search.ts:26` resolve arbitrary locations directly.
- Impact: auto-approved reads can exfiltrate files outside the project to a cloud model. Combined with S1, writes and commands can affect any location accessible to the process. Symlink escapes are also unhandled.
- Required fix: centralize canonical path resolution, validate real paths/nearest existing ancestors, deny traversal and symlink escape by default, and make extra roots an explicit user policy.

#### S3. Repository configuration can execute code before trust or approval

- Evidence: `src/app.ts:98` loads MCP configuration on startup; `src/mcp/config-loader.ts:39-44` immediately spawns each configured command. `src/app.ts:219-223` executes pre-edit hooks before the permission prompt at lines 250-269 and ignores hook failures.
- Impact: running Titao inside an untrusted checkout can execute arbitrary repository-supplied commands. The checked-in GitHub MCP template uses `npx -y`, adding a remote package supply-chain path.
- Required fix: introduce per-workspace trust, show the exact commands before first execution, keep hooks/MCP disabled in untrusted or non-interactive sessions, remove implicit `npx -y`, and fail closed when pre-hooks fail.

#### S4. Free-form JSON can be reinterpreted as an executable tool call

- Evidence: `src/providers/tool-call-parser.ts:15-88` scans every JSON object in model text and treats matching `name`/`function` fields as tool calls; `src/core/agent-loop.ts:133-143` executes those parsed calls.
- Impact: a code sample or quoted untrusted content can become an action. The permission prompt limits this interactively, but S1 makes the path dangerous in batch mode.
- Required fix: accept native provider tool calls or an explicit, delimited fallback protocol only; never execute an arbitrary JSON object found in prose.

### High-priority correctness

#### C1. Streaming is buffered until completion and `--no-stream` is ignored

- Evidence: `src/core/agent-loop.ts:90-102` accumulates chunks without invoking the UI callback, then emits once at lines 165-168. The provider request is hard-coded to `stream: true` at line 94. `streamingEnabled` is resolved in `src/app.ts:42` but never passed into `AgentLoop`.
- Impact: the main interaction advertised by the README is not actually live, and the CLI flag has no effect.

#### C2. Cloud-provider tool follow-ups use the wrong wire shape

- Evidence: internal `ToolCall.function.arguments` is an object (`src/providers/types.ts:19-25`). Ollama explicitly serializes it (`src/providers/ollama.ts:16-25`), but `GenericOpenAIProvider` casts internal messages directly to OpenAI messages (`src/providers/provider-factory.ts:100-103`).
- Impact: after a cloud model calls a tool, the next OpenAI-compatible request may send `function.arguments` as an object instead of the required JSON string and fail.

#### C3. Provider/model switching and CLI validation are incomplete

- `/provider` is documented and offered by completion, but `handleSlashCommand()` has no implementation.
- `/model` always mutates the current provider into an `OllamaProvider` (`src/app.ts:447-465`), even for OpenAI/OpenRouter/LM Studio/vLLM sessions.
- Commander accepts an arbitrary provider string even though the TypeScript type is narrower; the factory silently falls back to Ollama.
- `parseInt(options.context, 10)` can produce `NaN`; `--api-key` exposes secrets through shell history and process listings.

#### C4. The agent loop blocks valid multi-step work and mishandles failures

- Evidence: a repeated call or second edit to the same file terminates the entire loop (`src/core/agent-loop.ts:205-217`). Files are marked modified before permission and execution (`:220-223`), and snapshots are recorded before approval (`:225-228`). Failed tools send `result.output`—often empty—to the UI instead of `result.error` (`:260-265`).
- Impact: normal two-edit refactors stop prematurely, transient tool errors cannot be corrected, and users see blank failure messages.

#### C5. Context pruning can break tool-call integrity and usage is double-counted

- Evidence: `ContextManager.assembleMessages()` drops individual messages from the front without preserving assistant/tool-call groups (`src/core/context-manager.ts:93-108`). `compactHistory()` fabricates a one-line summary rather than summarizing state (`:116-139`). Completion usage is added from the provider at `src/core/agent-loop.ts:109-113` and then estimated and added again at `:129-131`.
- Impact: provider requests can contain orphan tool results or missing tool calls; long sessions lose decisions; `/usage` and `/cost` overstate completions.

#### C6. MCP support is incomplete relative to the protocol and advertised feature

- The client never sends `notifications/initialized` after the initialize response.
- MCP input schemas are discarded and replaced with `z.object({}).passthrough()` (`src/mcp/client.ts:79-85`), so the model gets no argument contract and runtime validation is absent.
- `${GITHUB_TOKEN}` from the generated config is passed literally; there is no environment interpolation.
- child exit/close does not reject pending requests, failed connections are not disconnected, stderr is not surfaced, and all MCP tools share a generic execute permission.

#### C7. Generated GitHub Actions review does not review the pull request

- Evidence: the workflow installs the published global `titao` package instead of building the checked-out revision (`.github/workflows/titao-ci.yml:22-28`). The built-in `git_diff` only reports uncommitted changes, while Actions checks out a clean tree. No step posts a review/comment or uploads a structured report.
- Impact: a costly Ollama install/model pull can finish without reviewing the branch diff or publishing feedback.

### Maintainability, release, and performance

#### M1. Quality and release gates are incomplete

- Lint is broken (existing issue #4), formatting fails in 22 files, and the AI workflow does not run build/test/lint.
- `scripts/publish.js` does not check lint, formatting, audit, package contents, or a clean worktree before declaring the package “100% production-ready.”
- `package.json` has no `files` allowlist, repository/homepage/bugs metadata, `prepublishOnly`, or shipped `LICENSE` file.
- Several direct runtime dependencies appear unused: `cli-highlight`, `conf`, `glob`, `ignore`, `ink`, `ora`, and `react`.

#### M2. The tests protect happy paths, not trust boundaries

The 15 tests cover basic tool behavior, one hook, one workflow string, provider construction, undo, context accounting, GitHub token parsing, and renderer throttling. There are no tests for `AgentLoop`, CLI modes, provider wire payloads, workspace escape, MCP handshake/lifecycle, permission denial, hook ordering, Git operations, or the generated workflow's actual behavior.

#### M3. Semantic search performs repeated sequential embedding work

- Evidence: the host/model are hard-coded (`src/tools/semantic-search.ts:30-39`), indexing is rebuilt on every query, and up to 50 chunk embeddings are fetched sequentially (`:107-113`).
- Impact: search latency grows linearly, only an arbitrary early slice of the repository is considered, and custom Ollama hosts do not work.

#### M4. The VS Code extension is a non-functional placeholder

`vscode-extension/package.json:14` declares `./extension.js`, but that file is absent. The package cannot activate. Either complete a minimal terminal-launching extension with tests/package scripts or remove the directory until it is supportable.

## Existing GitHub issue reconciliation

| Issue                                                                         | State              | Audit decision                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1 GH token detection](https://github.com/titaosahraoui/CLI_Titao/issues/1)  | Closed             | Implemented in `src/tools/github.ts`; do not duplicate. Prefer `gh auth token` over parsing credential files in a later security pass.                          |
| [#2 transient retries](https://github.com/titaosahraoui/CLI_Titao/issues/2)   | Open               | The retry implementation now exists in `GenericOpenAIProvider`; add deterministic 429/503 tests, then close or narrow the issue to mid-stream failure behavior. |
| [#3 markdown throttling](https://github.com/titaosahraoui/CLI_Titao/issues/3) | Closed             | Throttler exists and has a unit test; live streaming itself remains broken and needs a separate issue.                                                          |
| [#4 ESLint 9 config](https://github.com/titaosahraoui/CLI_Titao/issues/4)     | Open               | Reproduced; retain and prioritize in the quality-gate phase.                                                                                                    |
| [#5 mojibake](https://github.com/titaosahraoui/CLI_Titao/issues/5)            | Closed/not planned | Current source rendered correctly during this audit; no duplicate.                                                                                              |

## Recommended product roadmap

### Phase 0 — security release blocker

Ship workspace confinement, correct batch/subagent permission inheritance, trusted-workspace controls for MCP/hooks, and an explicit fallback tool protocol. Do not publish a new npm release before these are covered by negative security tests.

### Phase 1 — dependable core agent

Implement true streaming, provider-neutral message serialization, validated provider/model switching, recoverable multi-step edits, atomic undo bookkeeping, conversation-group pruning, and accurate usage accounting.

### Phase 2 — integrations that produce a real outcome

Complete MCP initialization/schema/environment/lifecycle support. Replace the current Actions generator with a branch-aware review command that compares base/head revisions and produces a Markdown/JSON report, then post that report with least-privilege permissions.

### Phase 3 — developer experience and release discipline

Resolve issue #4, enforce build/test/lint/format/audit in CI, narrow npm package contents, ship a license, add config profiles with secure secret lookup, and provide structured diagnostics (`titao doctor`).

### Phase 4 — differentiating features

Add a persistent incremental semantic index, resumable session checkpoints, a machine-readable event/audit log, policy presets (`read-only`, `edit`, `full`), and only then finish the VS Code extension around the stable CLI protocol.

## Important features to add

1. **Workspace trust center:** visible trusted/untrusted status, command previews, per-project hash-based approvals, and revocation.
2. **Policy presets and dry-run plans:** let users review the exact tools, paths, commands, and external writes before an unattended run.
3. **Branch-aware review mode:** `titao review --base <sha> --head <sha> --format markdown|json` for local and CI use.
4. **Validated config profiles:** project/user config layering, provider-specific schemas, environment/keychain secret resolution, and `titao doctor` diagnostics.
5. **Resumable sessions:** persist structured conversation/tool state without storing secrets; restore after interruption.
6. **Incremental semantic index:** cache embeddings by content hash, batch requests, respect ignore files, and expose index status/rebuild controls.
7. **Structured audit log:** record approvals, denials, tool results, changed files, and undo operations for troubleshooting and enterprise use.
8. **Editor bridge:** a thin VS Code client only after the CLI exposes a stable JSON/event interface.

## Detailed issue set and execution plan

- Publication-ready issue bodies: [`docs/issues/2026-08-11-prioritized-backlog.md`](../issues/2026-08-11-prioritized-backlog.md)
- First implementation slice: [`docs/superpowers/plans/2026-08-11-trust-boundary-hardening.md`](../superpowers/plans/2026-08-11-trust-boundary-hardening.md)
