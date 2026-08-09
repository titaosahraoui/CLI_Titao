#!/usr/bin/env node
import readline from 'readline';

/**
 * Example Stdio Model Context Protocol (MCP) Server.
 * Implements JSON-RPC 2.0 stdio protocol for database and GitHub issue tracking tools.
 */

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  if (!line.trim()) return;

  try {
    const req = JSON.parse(line);
    const { id, method, params } = req;

    switch (method) {
      case 'initialize':
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'example-mcp-server', version: '1.0.0' },
        });
        break;

      case 'tools/list':
        sendResponse(id, {
          tools: [
            {
              name: 'get_database_schema',
              description: 'Retrieve database tables and column schemas.',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'query_database',
              description: 'Execute a read-only SQL query against the project database.',
              inputSchema: {
                type: 'object',
                properties: {
                  sql: { type: 'string', description: 'SQL query string' },
                },
                required: ['sql'],
              },
            },
            {
              name: 'create_github_issue',
              description: 'Create a new issue on GitHub repository.',
              inputSchema: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Issue title' },
                  body: { type: 'string', description: 'Issue description' },
                },
                required: ['title'],
              },
            },
          ],
        });
        break;

      case 'tools/call': {
        const toolName = params?.name;
        const args = params?.arguments ?? {};

        if (toolName === 'get_database_schema') {
          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: 'Database Tables:\n- users (id INT, email VARCHAR, role VARCHAR, created_at TIMESTAMP)\n- orders (id INT, user_id INT, amount DECIMAL, status VARCHAR)',
              },
            ],
          });
        } else if (toolName === 'query_database') {
          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: `Executed SQL: ${args.sql}\nResults (2 rows):\n1. { id: 1, email: "admin@titao.dev", role: "admin" }\n2. { id: 2, email: "dev@titao.dev", role: "developer" }`,
              },
            ],
          });
        } else if (toolName === 'create_github_issue') {
          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: `Created GitHub Issue #42: "${args.title}"\nURL: https://github.com/titao/agent/issues/42`,
              },
            ],
          });
        } else {
          sendError(id, -32601, `Unknown MCP tool '${toolName}'`);
        }
        break;
      }

      default:
        sendError(id, -32601, `Method '${method}' not found`);
    }
  } catch (err) {
    // Ignore invalid JSON
  }
});

function sendResponse(id, result) {
  const res = { jsonrpc: '2.0', id, result };
  console.log(JSON.stringify(res));
}

function sendError(id, code, message) {
  const res = { jsonrpc: '2.0', id, error: { code, message } };
  console.log(JSON.stringify(res));
}
