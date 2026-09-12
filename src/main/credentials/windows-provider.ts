import { spawn } from 'node:child_process';
import { childEnv, findWindowsPowerShell } from '../exec.js';
import type { CredentialProvider } from './provider.js';

export type DpapiMode = 'protect' | 'unprotect';
export type DpapiRunner = (mode: DpapiMode, data: Buffer) => Promise<Buffer>;

const DPAPI_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputText = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($inputText)
if ($env:COMGU_DPAPI_MODE -eq 'protect') {
  $out = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
} elseif ($env:COMGU_DPAPI_MODE -eq 'unprotect') {
  $out = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
} else {
  throw 'invalid DPAPI mode'
}
[Console]::Out.Write([Convert]::ToBase64String($out))
`;

/**
 * Fixed-script DPAPI helper. The protected/plain master-key bytes travel only over stdin/stdout;
 * argv contains the static script and the child inherits ComGu's scrubbed environment.
 */
export function runDpapiPowerShell(mode: DpapiMode, data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const powershell = findWindowsPowerShell();
    if (!powershell) {
      reject(new Error('Windows PowerShell is unavailable'));
      return;
    }
    const child = spawn(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', DPAPI_SCRIPT],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv({ COMGU_DPAPI_MODE: mode })
      }
    );
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let settled = false;
    const finish = (error?: Error, value?: Buffer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value ?? Buffer.alloc(0));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('DPAPI helper timed out'));
    }, 8_000);
    timer.unref?.();
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= 8_192) stdout.push(chunk);
    });
    // Deliberately do not retain stderr: helper diagnostics can contain OS/user details and are
    // not needed for the caller-facing classification.
    child.stderr.resume();
    child.on('error', () => finish(new Error('DPAPI helper failed')));
    child.on('close', (code) => {
      if (code !== 0 || stdoutBytes > 8_192) {
        finish(new Error('DPAPI helper failed'));
        return;
      }
      try {
        const text = Buffer.concat(stdout).toString('utf8').trim();
        finish(undefined, Buffer.from(text, 'base64'));
      } catch {
        finish(new Error('DPAPI helper returned invalid data'));
      }
    });
    child.stdin.end(data.toString('base64'));
  });
}

export function createWindowsCredentialProvider(options: {
  platform?: NodeJS.Platform;
  run?: DpapiRunner;
} = {}): CredentialProvider {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runDpapiPowerShell;
  const assertWindows = (): void => {
    if (platform !== 'win32') throw new Error('Windows DPAPI credential storage is unavailable');
  };

  return {
    async status() {
      return platform === 'win32'
        ? { available: true as const, reason: 'available' as const, detail: 'dpapi-current-user' }
        : { available: false as const, reason: 'provider_unavailable' as const, detail: 'Windows DPAPI is unavailable on this platform.' };
    },
    async protect(data) {
      assertWindows();
      try {
        return await run('protect', data);
      } catch {
        throw new Error('Windows credential protection failed');
      }
    },
    async unprotect(data) {
      assertWindows();
      try {
        const unprotected = await run('unprotect', data);
        // Electron safeStorage encrypted the vault master key as a base64 *string*, while the
        // CLI DPAPI adapter protects the raw 32 bytes. Accept that one historical payload shape
        // only when it decodes canonically to a 32-byte key, then ask CredentialVault to reseal
        // it in the CLI-native representation after the successful read.
        if (unprotected.length !== 32) {
          const text = unprotected.toString('ascii').trim();
          if (/^[A-Za-z0-9+/]{43}=$/.test(text)) {
            const decoded = Buffer.from(text, 'base64');
            if (decoded.length === 32 && decoded.toString('base64') === text) {
              return { data: decoded, shouldReprotect: true };
            }
          }
        }
        return { data: unprotected, shouldReprotect: false };
      } catch {
        throw new Error('Windows credential protection failed');
      }
    }
  };
}
