import { spawn } from 'node:child_process';
import { childEnv, findWindowsPowerShell } from '../exec.js';
import type { ComputerClipboardProvider } from '../computer/index.js';

type ClipboardMode = 'read' | 'write';
export type WindowsClipboardRunner = (mode: ClipboardMode, text?: string) => Promise<string>;

const CLIPBOARD_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
if ($env:COMGU_CLIPBOARD_MODE -eq 'read') {
  $text = [Windows.Forms.Clipboard]::GetText()
  [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))
} elseif ($env:COMGU_CLIPBOARD_MODE -eq 'write') {
  $encoded = [Console]::In.ReadToEnd().Trim()
  $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
  [Windows.Forms.Clipboard]::SetText($text)
} else {
  throw 'invalid clipboard mode'
}
`;

export function runWindowsClipboardPowerShell(mode: ClipboardMode, text = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    const powershell = findWindowsPowerShell();
    if (!powershell) {
      reject(new Error('Windows PowerShell is unavailable'));
      return;
    }
    const child = spawn(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', CLIPBOARD_SCRIPT],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: childEnv({ COMGU_CLIPBOARD_MODE: mode })
      }
    );
    const output: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error, value = ''): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Windows clipboard helper timed out'));
    }, 8_000);
    timer.unref?.();
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) {
        child.kill();
        finish(new Error('Windows clipboard helper output exceeded its safety bound'));
        return;
      }
      output.push(chunk);
    });
    child.once('error', () => finish(new Error('Windows clipboard helper failed')));
    child.once('close', (code) => {
      if (code !== 0) {
        finish(new Error('Windows clipboard helper failed'));
        return;
      }
      try {
        const encoded = Buffer.concat(output).toString('utf8').trim();
        finish(undefined, mode === 'read' ? Buffer.from(encoded, 'base64').toString('utf8') : '');
      } catch {
        finish(new Error('Windows clipboard helper returned invalid data'));
      }
    });
    child.stdin.end(mode === 'write' ? Buffer.from(text, 'utf8').toString('base64') : '');
  });
}

export function createWindowsCliClipboard(options: {
  platform?: NodeJS.Platform;
  run?: WindowsClipboardRunner;
} = {}): ComputerClipboardProvider {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runWindowsClipboardPowerShell;
  const assertWindows = (): void => {
    if (platform !== 'win32') throw new Error('Windows clipboard is unavailable on this platform');
  };
  return {
    async readText() {
      assertWindows();
      return run('read');
    },
    async writeText(text) {
      assertWindows();
      await run('write', text);
    }
  };
}
