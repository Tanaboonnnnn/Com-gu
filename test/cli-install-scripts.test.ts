import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('professional CLI install scripts', () => {
  it('keeps the Linux installer fail-closed and user-scoped', () => {
    const source = readFileSync('install.sh', 'utf8');
    expect(source).toContain('set -eu');
    expect(source).toContain('sha256sum');
    expect(source).toContain('SHA256SUMS.txt');
    expect(source).toContain('.local/share/comgu-cli');
    expect(source).toContain('.local/bin/comgu');
    expect(source).toContain('COMGU_VERSION');
    expect(source).not.toMatch(/\bsudo\b/);
  });

  it('keeps the PowerShell installer fail-closed and user-scoped', () => {
    const source = readFileSync('install.ps1', 'utf8');
    expect(source).toContain("$ErrorActionPreference = 'Stop'");
    expect(source).toContain('Get-FileHash');
    expect(source).toContain('SHA256SUMS.txt');
    expect(source).toContain('LOCALAPPDATA');
    expect(source).toContain('ComGu\\bin');
    expect(source).toContain('COMGU_VERSION');
    expect(source).not.toMatch(/Start-Process[^\n]+-Verb\s+RunAs/i);
  });
});

