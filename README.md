# ⚡ Titao

**Open-source CLI coding agent powered by local models via Ollama.**

Titao brings the power of AI coding assistants like Claude Code to your terminal — running entirely on local models with zero cloud dependency, full privacy, and zero cost.

## Features

- 🤖 **Local-first** — Runs on Ollama with models like Qwen 2.5 Coder, DeepSeek, Codestral
- 🔧 **Full tool system** — File read/write/edit, grep search, shell commands, git integration
- 🖥️ **Beautiful terminal UI** — Streaming markdown, syntax highlighting, progress indicators
- 🔒 **Permission system** — Approve file writes and commands, auto-approve reads
- 🗺️ **Smart context** — Tree-sitter repo map gives the model codebase awareness
- 📝 **Project memory** — TITAO.md persists project-specific instructions

## Quick Start

```bash
# Install
npm install -g titao

# Make sure Ollama is running with a coding model
ollama pull qwen2.5-coder:32b

# Start Titao
titao
```

## Usage

```bash
# Interactive mode
titao

# Specify a model
titao --model qwen2.5-coder:14b

# Single prompt (non-interactive)
titao -p "Add error handling to the auth module"

# List available models
titao models

# Initialize project memory
titao init
```

## Requirements

- Node.js >= 20
- [Ollama](https://ollama.com) installed and running
- A coding model (recommended: `qwen2.5-coder:32b` or `devstral:24b`)

## License

MIT
