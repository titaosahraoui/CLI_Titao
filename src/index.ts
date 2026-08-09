#!/usr/bin/env node

/**
 * ⚡ Titao — Open-source CLI coding agent for local models via Ollama.
 *
 * Entry point for the CLI application.
 * Parses arguments and delegates to the appropriate handler.
 */

import { program } from './cli.js';

program.parse(process.argv);
