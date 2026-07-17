import { getApiPluginForAction } from '@/lib/v2/api-plugins/registry';
import { ExecutorContext, ExecutorResult, ExecutorStep, StepExecutor } from './types';

export const apiStepExecutor: StepExecutor = {
  type: 'api',

  async validate(step: ExecutorStep, context: ExecutorContext) {
    try {
      const raw = step.args_json?.__requiredPermissions;
      const required = Array.isArray(raw)
        ? raw.filter((s): s is string => typeof s === 'string')
        : [];
      const plugin = getApiPluginForAction(step.action);
      if (!plugin) {
        return { ok: false, reason: `No API plugin found for action: ${step.action}` };
      }

      return plugin.validate(
        {
          action: step.action,
          args: (step.args_json ?? {}) as Record<string, unknown>,
          requiredPermissions: required,
        },
        { userId: context.userId }
      );
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : 'API step validation failed',
      };
    }
  },

  async execute(step: ExecutorStep, context: ExecutorContext): Promise<ExecutorResult> {
    try {
      const args = { ...(step.args_json ?? {}) };
      delete (args as Record<string, unknown>).__requiredPermissions;
      const raw = step.args_json?.__requiredPermissions;
      const required = Array.isArray(raw)
        ? raw.filter((s): s is string => typeof s === 'string')
        : [];
      const plugin = getApiPluginForAction(step.action);
      if (!plugin) {
        return {
          success: false,
          error: `No API plugin found for action: ${step.action}`,
        };
      }

      const result = await plugin.execute(
        {
          action: step.action,
          args,
          requiredPermissions: required,
        },
        { userId: context.userId }
      );
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'API plugin execution failed',
          artifacts: [
            {
              kind: 'log',
              content: result.error || 'API plugin execution failed',
              metadata: { action: step.action, plugin: plugin.id },
            },
          ],
        };
      }
      const output = result.output ?? {};

      return {
        success: true,
        output,
        artifacts: [
          {
            kind: 'json',
            content: JSON.stringify(output),
            metadata: { action: step.action, plugin: plugin.id },
          },
        ],
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'API execution failed',
        artifacts: [
          {
            kind: 'log',
            content: err instanceof Error ? err.stack || err.message : 'Unknown error',
            metadata: { action: step.action },
          },
        ],
      };
    }
  },
};
