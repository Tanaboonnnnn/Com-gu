import { describe, expect, it, vi } from 'vitest';
import { createWindowsCliClipboard } from '../src/main/desktop/windows-clipboard.js';

describe('Windows CLI clipboard provider', () => {
  it('keeps clipboard data behind the provider seam', async () => {
    const run = vi.fn(async (mode: 'read' | 'write', text?: string) => mode === 'read' ? 'from clipboard' : text ?? '');
    const clipboard = createWindowsCliClipboard({ platform: 'win32', run });
    expect(await clipboard.readText()).toBe('from clipboard');
    await clipboard.writeText('private text');
    expect(run).toHaveBeenNthCalledWith(1, 'read');
    expect(run).toHaveBeenNthCalledWith(2, 'write', 'private text');
  });

  it('refuses use on another platform', async () => {
    const clipboard = createWindowsCliClipboard({ platform: 'linux', run: vi.fn() });
    await expect(clipboard.readText()).rejects.toThrow(/unavailable/i);
  });
});
