import { execFile } from 'child_process';
import { promisify } from 'util';
import { ExecutorContext, ExecutorResult, ExecutorStep, StepExecutor } from './types';

const execFileAsync = promisify(execFile);
const OS_ACTION_ALLOWLIST = new Set(['windows.set_theme']);
const DEFAULT_TIMEOUT_MS = 20_000;

async function runPowerShell(script: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { stdout, stderr } = await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: timeoutMs, windowsHide: true }
  );
  return { stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' };
}

function scriptForStep(step: ExecutorStep): string {
  if (step.action !== 'windows.set_theme') {
    throw new Error(`Unsupported OS action: ${step.action}`);
  }
  const mode = String(step.args_json?.mode ?? 'dark').toLowerCase();
  if (!['dark', 'light'].includes(mode)) {
    throw new Error('windows.set_theme mode must be "dark" or "light"');
  }

  const value = mode === 'dark' ? 0 : 1;
  return [
    '$path = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"',
    `Set-ItemProperty -Path $path -Name "AppsUseLightTheme" -Type DWord -Value ${value}`,
    `Set-ItemProperty -Path $path -Name "SystemUsesLightTheme" -Type DWord -Value ${value}`,
    `Write-Output "Theme set to ${mode}"`,
  ].join('; ');
}

export const osStepExecutor: StepExecutor = {
  type: 'os',

  async validate(step: ExecutorStep, _context: ExecutorContext) {
    if (process.platform !== 'win32') {
      return { ok: false, reason: 'OS executor currently supports Windows only' };
    }
    if (!OS_ACTION_ALLOWLIST.has(step.action)) {
      return { ok: false, reason: `OS action not allowlisted: ${step.action}` };
    }
    try {
      scriptForStep(step);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'Invalid OS step' };
    }
  },

  async execute(step: ExecutorStep, _context: ExecutorContext): Promise<ExecutorResult> {
    try {
      const script = scriptForStep(step);
      const { stdout, stderr } = await runPowerShell(script);
      return {
        success: true,
        output: { stdout, stderr, action: step.action },
        artifacts: [
          { kind: 'log', content: stdout || '(no stdout)', metadata: { stream: 'stdout' } },
          { kind: 'log', content: stderr || '(no stderr)', metadata: { stream: 'stderr' } },
        ],
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'OS execution failed',
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
