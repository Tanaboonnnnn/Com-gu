import { CAPABILITIES, WRITE_CAPABILITIES, type Capability, type Config } from './types.js';

/**
 * The only capability checkboxes whose model-facing operation does not need an approved
 * filesystem root. Keeping the exception list here makes a newly-added capability fail closed
 * until somebody deliberately classifies it as rootless.
 *
 * Command is intentionally absent. Run-scoped commands require an approved WorkspaceScope and
 * are OS-confined to its effective roots; without proven confinement they fail closed.
 */
export const ROOTLESS_CAPABILITIES: readonly Capability[] = ['screen', 'control', 'clipboardRead', 'clipboardWrite'];

/** Whether the capabilities that are effective under this config need an approved root. */
export function requiresApprovedFilesystemRoot(
  config: Pick<Config, 'capabilities' | 'readOnly'>
): boolean {
  return CAPABILITIES.some((capability) => {
    if (!config.capabilities[capability]) return false;
    if (config.readOnly && WRITE_CAPABILITIES.includes(capability)) return false;
    return !ROOTLESS_CAPABILITIES.includes(capability);
  });
}
