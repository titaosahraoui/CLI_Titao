# ⚡ Titao Project Memory

## Project Overview
Titao is an autonomous, open-source CLI coding agent running on local models via Ollama.

## Build & Test Guidelines
- **Build**: `npm run build` (`tsc`)
- **Test**: `npx vitest run`
- **Publish Validation**: `node scripts/publish.js`

## Active Shell Hooks (`.titao/hooks.json`)
- `pre-edit`: Compiles TypeScript project (`npm run build`).
- `post-edit`: Formats source files with Prettier (`npx prettier --write src/`).
- `pre-commit`: Runs test suite (`npx vitest run`) before git commits.

## Active MCP Servers (`.titao/mcp.json`)
- `db_and_github`: External Stdio MCP tool server providing `get_database_schema`, `query_database`, and `create_github_issue`.

## Code Style Conventions
- Use ESM imports with explicit `.js` extensions in TypeScript files (`import ... from './module.js'`).
- Preserve strict null checks and Zod parameter schemas for all tools.
