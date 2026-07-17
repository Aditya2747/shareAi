import { StepExecutor } from './types';
import { apiStepExecutor } from './api';
import { osStepExecutor } from './os';
import { browserStepExecutor } from './browser';
import { desktopStepExecutor } from './desktop';

const EXECUTORS: Record<string, StepExecutor> = {
  api: apiStepExecutor,
  os: osStepExecutor,
  browser: browserStepExecutor,
  desktop: desktopStepExecutor,
};

export function getExecutor(executorType: string): StepExecutor | null {
  return EXECUTORS[executorType] ?? null;
}
