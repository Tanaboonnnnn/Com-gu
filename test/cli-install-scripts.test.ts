import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('professional CLI install scripts', () => {
  it('keeps the Linux installer fail-closed and user-scoped', () => {
    const source = readFileSync('install.sh', 'utf8');
    expect(source).toContain('set -eu');
    expect(source).toContain('sha256sum');
    expect(source).toContain('SHA256SUMS.txt');
    expect(source).toContain('.local/share/comgu-cli');
    expect(source).toContain('COMGU_BIN_DIR');
    expect(source).toContain('.local/bin');
    expect(source).toContain('COMGU_VERSION');
    expect(source).not.toMatch(/\bsudo\b/);
  });

  it('expands the Windows update exit status after PowerShell runs', () => {
    const source = readFileSync('install.ps1', 'utf8').replace(/\r\n/g, '\n');
    expect(source).toMatch(/^if \/I "%~1"=="update" goto update$/m);
    expect(source).toMatch(/^:update\npowershell\.exe [^\n]+\nexit \/b %ERRORLEVEL%$/m);
  });

  it('extracts verified Windows archives without the newer .NET overwrite overload', () => {
    const powershell = readFileSync('install.ps1', 'utf8');
    const bootstrap = readFileSync('packages/comgu-cli/lib/install.mjs', 'utf8');
    for (const source of [powershell, bootstrap]) {
      expect(source).toContain('Add-Type -AssemblyName System.IO.Compression.FileSystem');
      expect(source).not.toContain('Expand-Archive');
    }
    expect(powershell).toContain('ZipFile]::ExtractToDirectory($archivePath, $stage)');
    expect(bootstrap).toContain("ZipFile]::ExtractToDirectory('${escapedArchive}', '${escapedDestination}')");
    expect(powershell.indexOf('SHA-256 mismatch')).toBeLessThan(powershell.indexOf('ZipFile]::ExtractToDirectory'));
  });

  it('keeps the PowerShell installer fail-closed and user-scoped', () => {
    const source = readFileSync('install.ps1', 'utf8');
    expect(source).toContain("$ErrorActionPreference = 'Stop'");
    expect(source).toContain('[System.Security.Cryptography.SHA256]::Create()');
    expect(source).not.toContain('Get-FileHash');
    expect(source).toContain('SHA256SUMS.txt');
    expect(source).toContain('LOCALAPPDATA');
    expect(source).toContain('ComGu\\bin');
    expect(source).toContain('COMGU_VERSION');
    expect(source).not.toMatch(/Start-Process[^\n]+-Verb\s+RunAs/i);
  });
});
