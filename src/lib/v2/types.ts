export type ExecutorType = 'api' | 'os' | 'browser' | 'desktop';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface ExecutionPlanStep {
  stepIndex: number;
  executorType: ExecutorType;
  action: string;
  args: Record<string, unknown>;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  requiredPermissions: string[];
  successCriteria: string;
  fallback?: string;
  /** Deterministic one-line summary for recipient review UI. */
  humanSummary?: string;
}

export interface ExecutionPlan {
  goal: string;
  steps: ExecutionPlanStep[];
  globalRiskSummary: {
    highestRisk: RiskLevel;
    approvalRequiredSteps: number;
    notes: string[];
  };
  blockedReasons: string[];
}

export interface CapabilityDefinition {
  id: string;
  executorType: ExecutorType;
  action: string;
  description: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  metadata?: Record<string, unknown>;
}
