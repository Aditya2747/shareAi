import crypto from 'crypto';

export type StepHashInput = {
  executor_type: string;
  action: string;
  args_json: unknown;
};

/** Recursively sort object keys so JSON serialization is order-stable. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalize(obj[key]);
  }
  return sorted;
}

/**
 * Hash executor_type + action + args_json using stable JSON.
 * Used to pin an approved step so execution rejects post-approval mutation.
 */
export function computeStepHash(step: StepHashInput): string {
  const payload = stableStringify({
    executor_type: step.executor_type,
    action: step.action,
    args_json: step.args_json ?? {},
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function verifyApprovedStepHash(
  step: StepHashInput,
  approvedStepHash: string | null | undefined
): { ok: true; currentHash: string } | { ok: false; reason: string; currentHash: string } {
  const currentHash = computeStepHash(step);
  if (!approvedStepHash) {
    return {
      ok: false,
      reason: 'Missing approved step hash',
      currentHash,
    };
  }
  if (currentHash !== approvedStepHash) {
    return {
      ok: false,
      reason: 'Step hash mismatch: step was modified after approval',
      currentHash,
    };
  }
  return { ok: true, currentHash };
}
