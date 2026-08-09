# ⚡ Titao

**Enterprise Open-Source CLI Coding Agent Powered by Local Models & Ollama**

Titao brings the autonomous coding experience of **Claude Code** and **Antigravity CLI** directly to your terminal. It runs 100% locally with zero telemetry, complete human-in-the-loop safety, Model Context Protocol (MCP) support, shell-script hook execution, AST symbol indexing, git safety rollback, and CI/CD GitHub Action integration.

---

## 🌟 Key Features

- 🤖 **Local-First & Multi-Provider**: Connects to **Ollama** (`qwen2.5-coder`, `deepseek-r1`), **OpenRouter**, **LM Studio**, **vLLM**, or **OpenAI**.
- 💭 **Reasoning & Thinking UI**: Visualizes `<think>...</think>` step-by-step reasoning in a styled terminal tree view.
- 🎨 **Red/Green Diff Preview**: Renders colorful unified diff previews before you approve any file edits.
- 🛡️ **Human-in-the-Loop & /undo**: Auto-approves safe reads; prompts `[y/n/a(lways)]` for writes and commands. Use **`/undo`** to revert file edits instantly.
- 🌳 **AST Symbol & Directory Repo Map**: Indexes workspace structure and extracts TypeScript/JavaScript/Python class, function, and type signatures automatically.
- 🔌 **Model Context Protocol (MCP)**: Connects external MCP tool servers (PostgreSQL, GitHub/GitLab issue trackers) via JSON-RPC stdio.
- 🪝 **Shell Hooks Engine**: Executes `.titao/hooks.json` scripts (`pre-edit`, `post-edit`, `pre-commit`) to enforce team linting and formatting rules.
- 🤖 **Agent Teams & Subagents**: Spawns secondary background sub-agents for isolated research, test generation, or log analysis.
- 🚀 **CI/CD Integration**: Run `titao ci` to generate `.github/workflows/titao-ci.yml` for automated PR reviews.
- 📝 **Persistent Project Memory**: Reads `TITAO.md` across sessions for project-specific instructions and code style.

---

## 🚀 Quick Start

```bash
# Clone & install dependencies
cd titao
npm install

# Build & link binary globally
npm run build
npm link

# Run Titao globally from any directory
titao
```

---

## 💻 CLI Usage & Commands

```bash
# Interactive REPL mode
titao

# Use a specific model
titao --model qwen2.5-coder:7b

# Connect to cloud OpenRouter
titao --provider openrouter --model qwen/qwen-2.5-coder-32b

# Single batch prompt (non-interactive)
titao -p "Review git status and summarize uncommitted changes"

# Auto-approve mode (non-interactive CI)
titao -p "Run unit tests" --auto-approve

# List available Ollama models
titao models

# Initialize TITAO.md project memory
titao init

# Initialize GitHub Actions CI workflow
titao ci
```

---

## 💬 Slash Commands Reference

Inside interactive mode:

| Command | Description |
|---|---|
| `/help` | Show command help menu |
| `/undo` | Revert the most recent file edit |
| `/diff` | Show uncommitted git changes |
| `/status` | Show git repository working tree status |
| `/models` | List available models |
| `/model <name>` | Switch active model dynamically |
| `/provider <type>` | Switch LLM provider (`ollama`, `openrouter`, `lmstudio`, `vllm`, `openai`) |
| `/clear` | Clear conversation context history |
| `/usage` | Show token usage statistics |
| `/exit` | Exit Titao REPL |

---

## 🧪 Testing

Run the Vitest test suite:

```bash
npm run test:run
```

---

## 📄 License

MIT
