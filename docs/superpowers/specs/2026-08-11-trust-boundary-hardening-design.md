# Trust-Boundary Hardening Design

## Goal

Make Titao safe to start in an untrusted repository and ensure every tool, hook, MCP server, batch run, and subagent remains within an explicit user policy.

## Approved architecture

Titao will enforce safety at four independent boundaries:

1. A canonical workspace resolver will normalize real paths, validate the nearest existing ancestor for new files, and reject traversal, absolute-path, symlink, junction, drive, and UNC escapes unless an additional root is explicitly allowed.
2. A single execution-policy factory will construct interactive, batch read-only, and explicit auto-approve policies. Batch runs and subagents cannot replace or broaden the parent policy.
3. Repository hooks and MCP definitions will remain inactive until the canonical workspace path and executable configuration bytes match a stored trust fingerprint. Trust never includes expanded secret values.
4. Text fallback tool calls will require an exact `<tool_call>...</tool_call>` envelope. JSON examples and quoted content remain inert prose.

## Data flow

At startup, CLI options are validated and converted into one permission policy. Titao computes workspace trust before loading hooks or spawning MCP processes. Each path-bearing tool resolves its target through the workspace boundary before filesystem or process access. Agent-loop permissions are evaluated before lifecycle hooks, backups, or tool execution. Native provider tool calls are preferred; fallback calls are parsed only from the explicit envelope and then validated by the registered Zod schema.

## Failure behavior

- Boundary violations return a tool error without touching the target.
- Batch mutations without explicit auto-approval are denied.
- Untrusted repository hooks and MCP servers are disabled without a non-interactive prompt.
- A failed pre-hook cancels the tool action; post-hooks run only after successful actions.
- Malformed or prose-embedded fallback JSON is returned as text and never executed.
- Subagent policy escalation throws before the subagent starts.

## Testing strategy

Development follows red-green-refactor. Unit tests cover canonical paths, traversal, symlinks/junctions, policy ordering, fingerprint invalidation, and fallback parsing. Integration tests prove that untrusted startup, read-only batch mode, and narrowed subagents spawn no commands and create no files. The security suite runs on Windows and Linux in CI.

## Scope

This design covers GitHub issues #6 through #9. Provider streaming, MCP protocol completeness, context accounting, CI review behavior, configuration profiles, release packaging, semantic indexing, and the VS Code extension remain separate follow-on issues.
