import { ExecutorType } from '@/lib/v2/types';

export interface ExecutorContext {
  userId: string;
  runId: string;
  stepId: string;
}

export interface ExecutorStep {
  executor_type: ExecutorType;
  action: string;
  args_json: Record<string, unknown> | null;
}

export interface ExecutorResult {
  success: boolean;
  output?: Record<string, unknown>;
  artifacts?: Array<{
    kind: 'screenshot' | 'log' | 'json';
    content: string;
    metadata?: Record<string, unknown>;
  }>;
  error?: string;
}

export interface StepExecutor {
  readonly type: ExecutorType;
  validate(step: ExecutorStep, context: ExecutorContext): Promise<{ ok: boolean; reason?: string }>;
  execute(step: ExecutorStep, context: ExecutorContext): Promise<ExecutorResult>;
  rollback?(
    _step: ExecutorStep,
    _context: ExecutorContext
  ): Promise<{ ok: boolean; reason?: string }>;
}
