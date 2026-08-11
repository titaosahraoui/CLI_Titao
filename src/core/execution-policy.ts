import type { PermissionLevel, PermissionPolicy } from './permissions.js';

export interface ExecutionPolicyOptions {
  interactive: boolean;
  autoApprove: boolean;
}

const PERMISSION_POWER: Record<PermissionLevel, number> = {
  deny: 0,
  ask: 1,
  auto: 2,
};

/** Build the effective policy for the current execution mode. */
export function createExecutionPolicy(options: ExecutionPolicyOptions): PermissionPolicy {
  if (options.autoApprove) {
    return { reads: 'auto', writes: 'auto', commands: 'auto', git: 'auto' };
  }

  if (!options.interactive) {
    return { reads: 'auto', writes: 'deny', commands: 'deny', git: 'deny' };
  }

  return { reads: 'auto', writes: 'ask', commands: 'ask', git: 'ask' };
}

/** Return true when a delegated policy grants no more authority than its parent. */
export function isPolicyNarrowerOrEqual(
  child: PermissionPolicy,
  parent: PermissionPolicy,
): boolean {
  return (Object.keys(parent) as Array<keyof PermissionPolicy>).every(
    (category) => PERMISSION_POWER[child[category]] <= PERMISSION_POWER[parent[category]],
  );
}
