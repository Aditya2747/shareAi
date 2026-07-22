import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import { ExecutorContext, ExecutorResult, ExecutorStep, StepExecutor } from './types';

const execFileAsync = promisify(execFile);
const OS_ACTION_ALLOWLIST = new Set(['windows.set_theme', 'windows.screenshot']);
const DEFAULT_TIMEOUT_MS = 20_000;

async function runPowerShell(script: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { stdout, stderr } = await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: timeoutMs, windowsHide: true }
  );
  return { stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' };
}

function themeScript(step: ExecutorStep): string {
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

/** Capture primary screen to a temp PNG and print the path. */
function screenshotScript(): string {
  return [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
    '$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height',
    '$graphics = [System.Drawing.Graphics]::FromImage($bmp)',
    '$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)',
    '$path = Join-Path $env:TEMP ("shareai_shot_" + [guid]::NewGuid().ToString("N") + ".png")',
    '$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)',
    '$graphics.Dispose()',
    '$bmp.Dispose()',
    'Write-Output $path',
  ].join('; ');
}

function scriptForStep(step: ExecutorStep): string {
  switch (step.action) {
    case 'windows.set_theme':
      return themeScript(step);
    case 'windows.screenshot':
      return screenshotScript();
    default:
      throw new Error(`Unsupported OS action: ${step.action}`);
  }
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

      if (step.action === 'windows.screenshot') {
        const filePath = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
        if (!filePath) {
          return {
            success: false,
            error: 'Screenshot captured but no file path was returned',
            artifacts: [
              { kind: 'log', content: stdout || '(no stdout)', metadata: { stream: 'stdout' } },
              { kind: 'log', content: stderr || '(no stderr)', metadata: { stream: 'stderr' } },
            ],
          };
        }

        try {
          const bytes = await fs.readFile(filePath);
          const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
          await fs.unlink(filePath).catch(() => undefined);
          return {
            success: true,
            output: {
              action: step.action,
              widthHint: 'primary-screen',
              bytes: bytes.length,
            },
            artifacts: [
              {
                kind: 'screenshot',
                content: dataUrl,
                metadata: { action: step.action, path: filePath },
              },
              {
                kind: 'log',
                content: `Screenshot saved (${bytes.length} bytes)`,
                metadata: { action: step.action },
              },
            ],
          };
        } catch (readErr) {
          return {
            success: false,
            error:
              readErr instanceof Error
                ? `Failed to read screenshot file: ${readErr.message}`
                : 'Failed to read screenshot file',
            artifacts: [
              { kind: 'log', content: stdout || '(no stdout)', metadata: { stream: 'stdout' } },
              { kind: 'log', content: stderr || '(no stderr)', metadata: { stream: 'stderr' } },
            ],
          };
        }
      }

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
