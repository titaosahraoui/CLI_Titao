import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

/**
 * Generates GitHub Actions CI/CD workflow for automated Titao PR reviews & bug fixing.
 */
export async function generateGitHubWorkflow(
  cwd: string = process.cwd(),
): Promise<{ success: boolean; filePath: string }> {
  const workflowDir = path.join(cwd, '.github', 'workflows');
  const workflowFile = path.join(workflowDir, 'titao-ci.yml');

  if (existsSync(workflowFile)) {
    return { success: true, filePath: workflowFile };
  }

  const yamlContent = `# ⚡ Titao CI/CD Automated PR Review Workflow
name: Titao AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  titao-review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Ollama & Titao
        run: |
          curl -fsSL https://ollama.com/install.sh | sh
          ollama serve &
          sleep 5
          ollama pull qwen2.5-coder:7b
          npm ci
          npm run build
          npm install -g .

      - name: Run Titao PR Code Review
        run: |
          titao -p "Review all git uncommitted/branch changes and generate PR feedback" --auto-approve
`;

  await mkdir(workflowDir, { recursive: true });
  await writeFile(workflowFile, yamlContent, 'utf-8');

  return { success: true, filePath: workflowFile };
}
