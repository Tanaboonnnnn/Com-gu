import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('desktop helper operation timeouts', () => {
  it('gives Windows UI Automation more than the old 8 second watchdog without relaxing fast metadata calls', () => {
    const source = readFileSync(path.join(root, 'src/main/computer/index.ts'), 'utf8');
    expect(source).toMatch(/case 'find_ui':[\s\S]*?return 15_000;/);
    expect(source).toMatch(/case 'windows':[\s\S]*?return 5_000;/);
  });
});
