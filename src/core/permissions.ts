/** Permission level for tool categories. */
export type PermissionLevel = 'auto' | 'ask' | 'deny';

/** Permission policy mapping tool categories to permission levels. */
export interface PermissionPolicy {
  reads: PermissionLevel;
  writes: PermissionLevel;
  commands: PermissionLevel;
  git: PermissionLevel;
}

/** Default permission policy: auto-approve reads, ask for everything else. */
export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
  reads: 'auto',
  writes: 'ask',
  commands: 'ask',
  git: 'ask',
};

/**
 * Manages tool execution permissions.
 * Supports per-session overrides and configurable policies.
 */
export class PermissionManager {
  private policy: PermissionPolicy;
  private sessionApprovals = new Set<string>();
  private sessionCategoryApprovals = new Set<string>();

  constructor(policy: PermissionPolicy = DEFAULT_PERMISSION_POLICY) {
    this.policy = policy;
  }

  /** Check if a tool is auto-approved (no user prompt needed). */
  isAutoApproved(toolName: string): boolean {
    const category = this.categorize(toolName);
    if (this.sessionCategoryApprovals.has(category)) return true;
    if (this.sessionApprovals.has(toolName)) return true;
    return this.policy[category] === 'auto';
  }

  /** Check if a tool is denied. */
  isDenied(toolName: string): boolean {
    const category = this.categorize(toolName);
    return this.policy[category] === 'deny';
  }

  /** Approve a specific tool for this session. */
  approveToolForSession(toolName: string): void {
    this.sessionApprovals.add(toolName);
  }

  /** Approve an entire category for this session. */
  approveCategoryForSession(category: keyof PermissionPolicy): void {
    this.sessionCategoryApprovals.add(category);
  }

  /** Get the permission category for a tool. */
  categorize(toolName: string): keyof PermissionPolicy {
    switch (toolName) {
      case 'view_file':
      case 'list_dir':
      case 'grep_search':
      case 'repo_map':
        return 'reads';
      case 'write_file':
      case 'edit_file':
        return 'writes';
      case 'run_command':
        return 'commands';
      case 'git_status':
      case 'git_diff':
      case 'git_commit':
        return 'git';
      default:
        return 'commands';
    }
  }

  /** Create a policy that auto-approves everything (for --auto-approve flag). */
  static autoApproveAll(): PermissionPolicy {
    return { reads: 'auto', writes: 'auto', commands: 'auto', git: 'auto' };
  }
}
