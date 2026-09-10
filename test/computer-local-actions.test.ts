import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(() => {
    throw new Error('desktop helper must not start');
  }),
  readText: vi.fn(() => 'clipboard-value'),
  writeText: vi.fn()
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('electron', () => ({
  clipboard: {
    readText: mocks.readText,
    writeText: mocks.writeText
  }
}));

import { act, configureComputerClipboard } from '../src/main/computer/index.js';

describe('desktop local-only action path', () => {
  beforeEach(() => {
    mocks.spawn.mockClear();
    mocks.readText.mockClear();
    mocks.writeText.mockClear();
    configureComputerClipboard({ readText: mocks.readText, writeText: mocks.writeText });
  });

  afterEach(() => configureComputerClipboard(null));

  it('runs clipboard-only work without starting the PowerShell desktop helper', async () => {
    const result = await act([
      { type: 'write_clipboard', text: 'next' },
      { type: 'wait', ms: 0 },
      { type: 'read_clipboard' }
    ]);

    expect(mocks.writeText).toHaveBeenCalledWith('next');
    expect(result.clipboard).toEqual(['clipboard-value']);
    expect(result.cursor).toBeNull();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('preflights semantic refs before an earlier clipboard action can mutate state', async () => {
    await expect(
      act([
        { type: 'write_clipboard', text: 'must-not-land' },
        { type: 'click_ref', ref: 'g999_e999_999' }
      ])
    ).rejects.toThrow(/UNKNOWN_UI_REF|STALE_REF/);

    expect(mocks.writeText).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
