import { ExecutorContext, ExecutorResult, ExecutorStep, StepExecutor } from './types';

export const desktopStepExecutor: StepExecutor = {
  type: 'desktop',
  async validate(_step: ExecutorStep, _context: ExecutorContext) {
    return {
      ok: false,
      reason: 'Desktop/RPA executor scaffolded; implementation is milestone 4.',
    };
  },
  async execute(_step: ExecutorStep, _context: ExecutorContext): Promise<ExecutorResult> {
    return {
      success: false,
      error: 'Desktop executor not implemented yet',
    };
  },
};
