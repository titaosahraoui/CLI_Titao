# Prioritized GitHub Issue Backlog

These issue bodies were prepared from the 2026-08-11 repository audit. Scores use the project debt formula:

`priority score = (impact + risk) × (6 - effort)`, with each input scored 1–5.

GitHub publication was not possible during the audit because the active `gh` account token is invalid and no `GH_TOKEN`/`GITHUB_TOKEN` is set. Before publishing, list all open/closed issues and deduplicate by title. Existing issues #2 and #4 are handled in the final section.

## Draft 01 — P0: Preserve permission policy in batch and subagent execution

**Labels:** `bug`  
**Score:** impact 5 + risk 5, effort 2 → **40**

### Problem

`runSinglePrompt()` unconditionally creates an auto-approve-all permission manager in `src/app.ts:303-320`, even when the user did not pass `--auto-approve`. `SubagentManager.runSubagent()` does the same in `src/core/subagent-manager.ts:40-41`.

This bypasses Titao's advertised human-in-the-loop boundary. A batch prompt or delegated task can run shell commands, overwrite files, commit, or create external issues without explicit authorization.

### Acceptance criteria

- Non-interactive mode defaults to a read-only policy.
- Writes, commands, git mutations, and external writes require `--auto-approve` or an explicit scoped policy.
- `runSinglePrompt()` uses the policy constructed by `startTitao()` and does not create a broader one.
- Subagents inherit a policy that is equal to or narrower than the parent policy.
- Tests prove that `-p` without `--auto-approve` cannot invoke `write_file`, `run_command`, `git_commit`, or `github_create_issue`.
- Tests prove that adding `--auto-approve` enables the intended actions.

### Verification

Run `npm run build`, the permission/CLI integration tests, and the full Vitest suite.

## Draft 02 — P0: Confine file, search, git, and command tools to the workspace

**Labels:** `bug`  
**Score:** impact 5 + risk 5, effort 3 → **30**

### Problem

Path handling is duplicated and does not enforce a workspace boundary. `view_file`, `write_file`, and `edit_file` allow `..` and Windows drive paths; `list_dir`, `grep_search`, and `run_command.cwd` accept arbitrary locations. Symlink escapes are not checked.

Auto-approved reads can therefore expose user files outside the repository to the model. With auto-approved execution, writes and commands can affect those locations too.

### Acceptance criteria

- Add one canonical `WorkspaceBoundary` service used by every built-in path-consuming tool.
- Deny absolute paths, `..` traversal, different Windows drives, UNC paths, and symlink/junction escapes outside the workspace by default.
- For new write targets, validate the nearest existing ancestor before creating directories.
- Add an explicit configuration mechanism for additional allowed roots; never infer them.
- Insert `--` before user paths passed to git and ripgrep where applicable.
- Add Windows and POSIX tests for valid paths, traversal, absolute paths, symlinks/junctions, and non-existent write targets.

### Verification

Run the new boundary tests on Windows and Linux CI plus the full tool test suite.

## Draft 03 — P0: Add trusted-workspace controls for MCP servers and hooks

**Labels:** `bug`  
**Score:** impact 5 + risk 5, effort 4 → **20**

### Problem

Titao automatically loads `.titao/mcp.json` and spawns configured commands during startup (`src/app.ts:98`, `src/mcp/config-loader.ts:39-44`). Pre-edit hooks run before the user answers the permission question (`src/app.ts:219-269`), and hook failures are ignored. The generated GitHub MCP configuration uses `npx -y`, which may download and execute code.

Opening an untrusted repository with Titao can therefore execute repository-controlled code before meaningful consent.

### Acceptance criteria

- Repositories start untrusted unless their canonical path plus relevant config hashes have been approved by the user.
- Before first MCP/hook execution, show server command, arguments, hook commands, working directory, and environment variable names.
- Untrusted and non-interactive sessions do not start MCP servers or hooks unless an explicit trust/policy flag is supplied.
- Remove implicit `npx -y` from generated configuration or require an exact pinned package/version and approval.
- Pre-hook failure cancels the action; post-edit/post-commit hooks run only after successful actions.
- Trust can be listed and revoked with CLI commands.
- Integration tests prove that startup in an untrusted fixture spawns no process.

### Verification

Run trust-store unit tests, process-spawn integration tests, and the full suite.

## Draft 04 — P0: Replace free-form JSON tool detection with an explicit fallback protocol

**Labels:** `bug`  
**Score:** impact 5 + risk 4, effort 2 → **36**

### Problem

`parseToolCallsFromText()` scans arbitrary model prose for JSON objects and executes any object whose `name`, `function`, `action`, or `tool` matches a registered tool. A quoted example can therefore become an action.

### Acceptance criteria

- Prefer native provider tool calls.
- Allow fallback tool calls only inside an exact delimiter such as `<tool_call>{...}</tool_call>`.
- Parse the delimited payload as one JSON object and validate it through the registered Zod schema before execution.
- Treat all other JSON/code blocks as response text.
- Reject malformed, nested, duplicated, or unknown fallback calls with an observation instead of silently skipping them.
- Add tests showing that a Markdown JSON example naming `run_command` is rendered, not executed.

### Verification

Run parser and `AgentLoop` tests covering native, delimited fallback, prose JSON, malformed input, and unknown tools.

## Draft 05 — P1: Implement true live streaming and honor `--no-stream`

**Labels:** `bug`, `performance`  
**Score:** impact 4 + risk 3, effort 2 → **28**

### Problem

`AgentLoop` accumulates all streamed text chunks and invokes `onStreamText` only after the provider finishes. It also hard-codes `stream: true`, so the resolved `streamingEnabled` option is unused.

### Acceptance criteria

- Add `streamingEnabled` to `AgentLoopOptions` and pass the CLI setting through.
- In streaming mode, forward text deltas as they arrive without duplicating final content.
- In non-streaming mode, request one synchronous response and emit it once.
- Make thinking-block rendering incremental without exposing partial control tags.
- Ensure throttled terminal rendering clears/replaces prior frames safely.
- Add fake-provider tests for chunk order, `--no-stream`, tool-call chunks, abort, and renderer flush/cancel.

### Verification

Run focused streaming tests and a manual smoke test with an Ollama model.

## Draft 06 — P1: Normalize provider tool messages and make provider switching type-safe

**Labels:** `bug`  
**Score:** impact 4 + risk 4, effort 3 → **24**

### Problem

Internal tool-call arguments are objects. `OllamaProvider` serializes them before sending, but `GenericOpenAIProvider` casts internal messages directly to OpenAI message types. Cloud tool follow-ups can therefore send the wrong wire shape. Separately, `/provider` is documented but missing, and `/model` always mutates the current provider into Ollama.

### Acceptance criteria

- Add a shared `formatMessagesForOpenAI()` adapter that serializes assistant tool arguments and preserves `role: tool` with `tool_call_id`.
- Use the adapter in Ollama and every OpenAI-compatible provider.
- Add request-capture tests for assistant tool call → tool result → assistant follow-up.
- Implement `/provider <type>` by constructing a new validated provider instance and updating active session state atomically.
- Make `/model` change the model without changing provider type.
- Reject unsupported provider names and unavailable credentials with actionable errors.

### Verification

Run provider contract tests against mocked OpenAI-compatible HTTP responses and CLI command tests.

## Draft 07 — P1: Make agent-loop execution recoverable and support multi-edit tasks

**Labels:** `bug`  
**Score:** impact 4 + risk 4, effort 3 → **24**

### Problem

The loop terminates when a tool call repeats or a file is edited a second time. It marks paths modified and records undo snapshots before permission/execution. Tool failures often render a blank message because callbacks receive `result.output` instead of `result.error`.

### Acceptance criteria

- Allow multiple edits to one file when each edit has a distinct validated signature.
- Detect exact duplicate calls, return a tool observation, and let the model recover rather than terminate the whole turn.
- Record a file as modified only after a successful write/edit.
- Create undo snapshots only after approval and immediately before execution; discard snapshots for failed actions.
- Send a result for every provider tool-call ID, including malformed/denied/unknown calls.
- Render the actual error message to the user.
- Add a total tool-call budget and per-signature retry limit without forbidding legitimate multi-step work.

### Verification

Run `AgentLoop` integration tests for two edits, denied writes, failed edits, exact duplicates, malformed calls, and max-call exhaustion.

## Draft 08 — P1: Complete MCP protocol, schema, environment, and lifecycle support

**Labels:** `bug`, `enhancement`  
**Score:** impact 4 + risk 4, effort 4 → **16**

### Problem

The client omits the initialized notification, discards advertised input schemas, passes `${VAR}` values literally, does not reject pending requests on child exit, and gives every MCP tool a generic execute classification.

### Acceptance criteria

- Send `notifications/initialized` after a successful initialize response and before `tools/list`.
- Convert each MCP JSON Schema into an enforceable runtime validator while preserving the original schema sent to the model.
- Expand only exact `${ENV_NAME}` placeholders from the parent environment; fail clearly when a required variable is missing and never print secret values.
- Set the server working directory explicitly to the project root.
- Capture bounded stderr for diagnostics.
- Reject every pending request on exit/error, disconnect failed clients, and make `disconnect()` idempotent.
- Support tool annotations or local overrides for read/write/execute permission mapping.
- Add a protocol fixture that verifies handshake order and lifecycle cleanup.

### Verification

Run MCP protocol integration tests against the example server and a failure fixture.

## Draft 09 — P1: Preserve tool-call groups during context pruning and fix usage accounting

**Labels:** `bug`  
**Score:** impact 3 + risk 4, effort 3 → **21**

### Problem

History truncation treats every message independently, which can leave orphan tool messages or assistant calls. Manual compaction replaces history with a fabricated one-line summary. Completion usage is counted once from provider metadata and again via tokenizer estimation.

### Acceptance criteria

- Model conversation history as atomic turns containing user, assistant, and all associated tool results.
- Prune whole turns only; never split an assistant tool call from its results.
- Include tool-call names and arguments in token estimates.
- Prefer provider-reported usage; estimate only when provider usage is absent.
- Replace fabricated compaction with a structured summary containing goal, decisions, changed files, commands/results, blockers, and next action.
- Add invariants/tests for tiny budgets, multi-tool turns, compaction, and exact usage totals.

### Verification

Run context and provider-usage tests with known token/usage fixtures.

## Draft 10 — P1: Replace the generated GitHub Action with a real branch-aware review workflow

**Labels:** `bug`, `enhancement`  
**Score:** impact 5 + risk 4, effort 4 → **18**

### Problem

The generated workflow installs the published global package instead of the checked-out source, pulls a large Ollama model on every run, asks Titao to review uncommitted changes in a clean checkout, and never posts or uploads the resulting review.

### Acceptance criteria

- Add `titao review --base <sha> --head <sha> --format markdown|json --output <path>`.
- Review the explicit base/head diff, including added, modified, renamed, and deleted files.
- In the generated workflow, build/test the checked-out revision with `npm ci` and `npm run build`.
- Choose a documented model strategy with caching or a configured provider; do not run an unpinned remote installer script.
- Upload the report as an artifact and optionally post/update one PR comment with least-privilege `pull-requests: write` permission.
- Avoid executing code from forked PRs with repository secrets or write permissions.
- Add snapshot tests for the workflow and an integration test using a temporary git repository with two commits.

### Verification

Run workflow linting, generator snapshots, and the temporary-repository review test.

## Draft 11 — P1: Add validated configuration profiles and secure secret resolution

**Labels:** `enhancement`  
**Score:** impact 4 + risk 4, effort 3 → **24**

### Problem

Configuration is mostly CLI-only, `TitaoConfig.provider` is hard-coded to `ollama`, invalid provider/context values can reach runtime, and `--api-key` encourages secrets in shell history/process listings. The existing `conf` dependency is not used.

### Acceptance criteria

- Define a Zod schema for user config, project config, environment overrides, and CLI overrides with documented precedence.
- Store only non-secret provider/profile metadata in config.
- Resolve credentials from provider-specific environment variables or OS keychain integration; deprecate `--api-key` with a warning before removal.
- Add `titao config list|get|set|unset`, `titao provider list`, and `titao doctor` commands.
- Validate provider names, URLs, context sizes, temperatures, and limits before startup.
- Redact credentials and sensitive arguments in permission prompts/logs.
- Add config migration and precedence tests across Windows/POSIX path conventions.

### Verification

Run config schema, precedence, redaction, and CLI tests.

## Draft 12 — P1: Enforce quality/release gates and publish a minimal npm package

**Labels:** `enhancement`  
**Score:** impact 3 + risk 3, effort 2 → **24**

### Problem

Lint is broken (tracked by #4), formatting fails in 22 files, the CI workflow runs no conventional checks, and `npm pack` includes 214 files. The publish script omits lint/format/audit/package assertions but prints a production-ready claim. No `LICENSE` file is shipped.

### Acceptance criteria

- Complete issue #4 with an ESLint 9 TypeScript flat config.
- Add CI jobs for `npm ci`, typecheck/build, tests, lint, Prettier check, audit, and package-content verification.
- Add a `files` allowlist and required npm metadata (`repository`, `bugs`, `homepage`, `engines`, `license`).
- Add the actual MIT `LICENSE` file.
- Remove unused runtime dependencies after verifying imports/bundle behavior.
- Add `prepublishOnly` and make `scripts/publish.js` fail on any quality gate, dirty generated output, unexpected package file, or missing license.
- Replace the absolute “100% production-ready” message with a factual validation summary.

### Verification

Run the full release script and inspect `npm pack --dry-run --json` against an allowlisted file set.

## Draft 13 — P2: Build a persistent incremental semantic-search index

**Labels:** `enhancement`, `performance`  
**Score:** impact 3 + risk 2, effort 4 → **10**

### Problem

Semantic search hard-codes the Ollama host/model, scans the repository on every query, embeds chunks sequentially, and scores only an arbitrary first slice.

### Acceptance criteria

- Use the active configured embedding host/model.
- Respect `.gitignore`, `.ignore`, and binary/size limits.
- Cache chunks and embeddings by normalized path plus content hash in `.titao/cache/` (gitignored).
- Batch or concurrency-limit embedding requests and cancel on abort.
- Incrementally update changed/deleted files and expose `titao index status|build|clear`.
- Bound result count with Zod and report index coverage/staleness.
- Add deterministic tests with a fake embedding provider and performance budgets for unchanged re-query.

### Verification

Run index correctness tests, an unchanged-query cache test, and a medium-repository benchmark.

## Draft 14 — P2: Complete or remove the VS Code extension placeholder

**Labels:** `enhancement`  
**Score:** impact 2 + risk 2, effort 3 → **12**

### Problem

`vscode-extension/package.json` declares `./extension.js`, but the entry file and build/test scripts do not exist. The extension cannot activate.

### Acceptance criteria

- Decide whether the extension is in the supported 0.x scope.
- If supported: add TypeScript source, build/package scripts, activation/deactivation, a terminal-launch command, configuration for executable/profile, tests, README, icon/license, and CI packaging.
- Use a future structured CLI event interface for deeper integration instead of scraping ANSI terminal output.
- If not supported: remove the placeholder directory and move the feature to the roadmap.

### Verification

Run the VS Code extension tests and `vsce package`, or verify the placeholder removal and documentation update.

## Existing issues to update, not duplicate

### Issue #2 — transient HTTP retries

The retry mechanism is now present in `src/providers/provider-factory.ts:23-95` and used for initial chat/model-list requests. Add deterministic tests for 429, 503, jitter/backoff caps, non-retryable 4xx, and max attempts. Then close #2 as completed or narrow it to explicitly supported mid-stream recovery semantics.

### Issue #4 — ESLint 9 flat config

Reproduced on 2026-08-11. Keep #4 open and implement it as part of Draft 12 rather than opening a duplicate.
