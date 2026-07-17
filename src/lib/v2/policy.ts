import { supabaseAdmin } from '@/lib/supabase';
import { BUILTIN_CAPABILITIES } from '@/lib/v2/capabilities';
import { ExecutorType } from '@/lib/v2/types';

interface PolicyStep {
  executor_type: ExecutorType;
  action: string;
  args_json: Record<string, unknown> | null;
}

const COMMAND_DENYLIST_PATTERNS = [
  /format\s+/i,
  /rm\s+-rf/i,
  /shutdown/i,
  /restart-computer/i,
  /reg\s+delete/i,
  /set-itemproperty\s+.*\\run/i,
];

function isPotentiallyDangerousPath(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.replace(/\\/g, '/').toLowerCase();
  const sandbox = (process.env.OS_ACTION_SANDBOX_ROOT || '').replace(/\\/g, '/').toLowerCase();
  if (!sandbox) return false;
  return !normalized.startsWith(sandbox);
}

async function capabilityEnabled(
  executorType: ExecutorType,
  action: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('capabilities')
    .select('is_enabled')
    .eq('executor_type', executorType)
    .eq('action', action)
    .maybeSingle();

  if (!error && data) return Boolean(data.is_enabled);

  return BUILTIN_CAPABILITIES.some(
    (c) => c.executorType === executorType && c.action === action
  );
}

export async function validateStepPolicy(step: PolicyStep): Promise<{
  ok: boolean;
  reason?: string;
}> {
  if (!(await capabilityEnabled(step.executor_type, step.action))) {
    return { ok: false, reason: `Capability disabled or unknown: ${step.executor_type}.${step.action}` };
  }

  if (step.executor_type === 'os') {
    const serialized = JSON.stringify(step.args_json ?? {});
    for (const pattern of COMMAND_DENYLIST_PATTERNS) {
      if (pattern.test(`${step.action} ${serialized}`)) {
        return { ok: false, reason: 'Blocked by OS policy denylist' };
      }
    }
    const args = step.args_json ?? {};
    const candidatePaths = [
      (args as Record<string, unknown>).path,
      (args as Record<string, unknown>).sourcePath,
      (args as Record<string, unknown>).targetPath,
    ];
    if (candidatePaths.some(isPotentiallyDangerousPath)) {
      return {
        ok: false,
        reason:
          'OS step references a path outside OS_ACTION_SANDBOX_ROOT',
      };
    }
  }

  return { ok: true };
}
