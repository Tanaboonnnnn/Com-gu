import { createHash } from 'node:crypto';
import type { MachineIdentity } from './profile.js';

export type MachineSurface = 'core' | 'desktop';

export interface MachineConnectorMetadata {
  serverName: string;
  connectorName: string;
  description: string;
  cardSummary: string;
  machineRef: string;
}

export function stableMachineReference(machineId: string): string {
  return createHash('sha256').update(machineId, 'utf8').digest('hex').slice(0, 12);
}

export function connectorMetadata(
  machine: MachineIdentity,
  surface: MachineSurface,
  legacyMode = !machine.confirmed
): MachineConnectorMetadata {
  const machineRef = stableMachineReference(machine.id);
  if (legacyMode) {
    return surface === 'core'
      ? {
          serverName: 'chat-on-steroids-core',
          connectorName: 'ComGu Core',
          description:
            'Read and edit code and text files on this computer, and run commands in a real terminal.',
          cardSummary: 'Files, patches and the terminal. Required — this is the coding connector.',
          machineRef
        }
      : {
          serverName: 'chat-on-steroids-desktop',
          connectorName: 'ComGu Desktop',
          description: 'See and control this Windows desktop, including its clipboard.',
          cardSummary:
            'Screenshots, windows, mouse/keyboard control and the clipboard. Optional — connect it only if you want desktop automation.',
          machineRef
        };
  }

  if (surface === 'core') {
    return {
      serverName: `comgu-core-${machineRef}`,
      connectorName: `ComGu · ${machine.name} Core`,
      description:
        `Read, edit, search and run commands only on the machine "${machine.name}". ` +
        `Use this connector for file, code, repository, build, test, terminal and process work targeting ${machine.name}. ` +
        'Do not use it for another machine.',
      cardSummary: `Files, patches and terminal on ${machine.name}.`,
      machineRef
    };
  }
  return {
    serverName: `comgu-desktop-${machineRef}`,
    connectorName: `ComGu · ${machine.name} Desktop`,
    description:
      `See and control only the graphical desktop of "${machine.name}". ` +
      `Use this connector for screenshots, windows, mouse, keyboard and clipboard work targeting ${machine.name}. ` +
      'Do not use it for another machine.',
    cardSummary: `Graphical desktop control on ${machine.name}.`,
    machineRef
  };
}
