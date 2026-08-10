const owner = 'titaosahraoui';
const repo = 'CLI_Titao';
const token = process.argv[2] || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!token) {
  console.error('❌ GITHUB_TOKEN is required.');
  console.error('Usage: node scripts/create-issues.js <your_github_token>');
  process.exit(1);
}

const issues = [
  {
    title: '[Feature]: Add Automatic GH_TOKEN Detection from gh CLI Config File',
    body: `### Description
Currently \`src/tools/github.ts\` checks \`process.env.GITHUB_TOKEN\` and runs \`gh issue create\`. If the \`gh\` binary is not added to the global system PATH, Titao checks environment variables.

### Proposed Solution
Add an automatic parser for \`%APPDATA%\\GitHub CLI\\hosts.yml\` (Windows) / \`~/.config/gh/hosts.yml\` (Linux/macOS) so users who ran \`gh auth login\` have their tokens detected automatically even if \`gh.exe\` is missing from system \`PATH\`.

*Discovered by ⚡ Titao CLI Agent Code Review.*`,
    labels: ['enhancement'],
  },
  {
    title: '[UX]: Throttle Terminal Markdown Re-renders During Token Streaming',
    body: `### Description
\`renderTerminalMarkdown\` in \`src/utils/response-formatter.ts\` parses full markdown buffers on every single token chunk received from Ollama streaming.

### Proposed Solution
Add a 50ms throttle buffer for live terminal re-rendering to reduce CPU overhead during long code block generation.

*Discovered by ⚡ Titao CLI Agent Code Review.*`,
    labels: ['performance'],
  },
  {
    title: '[Safety]: Add Exponential Backoff Retry Strategy for HTTP 429 / 503 Errors',
    body: `### Description
\`GenericOpenAIProvider\` in \`src/providers/provider-factory.ts\` connects directly to OpenRouter or OpenAI via \`fetch\`.

### Proposed Solution
Add exponential backoff retries for transient 429 rate limit or 503 service unavailable errors when using cloud LLM providers.

*Discovered by ⚡ Titao CLI Agent Code Review.*`,
    labels: ['bug'],
  },
];

async function createIssues() {
  console.log(`🚀 Creating 3 GitHub Issues on repository ${owner}/${repo}...\n`);

  for (const issue of issues) {
    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Titao-Agent',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(issue),
      });

      const data = await response.json();
      if (response.ok) {
        console.log(`✅ Created Issue #${data.number}: ${data.title}`);
        console.log(`   Link: ${data.html_url}\n`);
      } else {
        console.error(`❌ Failed to create issue '${issue.title}': (${response.status}) ${data.message}`);
      }
    } catch (err) {
      console.error(`❌ Network error creating issue '${issue.title}': ${err.message}`);
    }
  }
}

createIssues();
