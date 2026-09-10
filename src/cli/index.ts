import { createControlClient } from './control-client.js';
import { defaultComGuProfileDir } from './profile-dir.js';
import { renderPlainStatus } from './commands/status.js';
import type { RuntimeControlMethod } from '../main/runtime/control.js';
import type { ServiceAction } from './service-linux.js';

export interface CliIo {
  writeOut(text: string): void;
  writeErr(text: string): void;
  isTTY: boolean;
  columns: number;
}

export interface CliDependencies {
  profileDir: string;
  request(method: RuntimeControlMethod): Promise<unknown>;
  startOwner(): Promise<void>;
  showDashboard?(): Promise<void>;
  serviceAction?(action: ServiceAction): Promise<string>;
}

function defaultIo(): CliIo {
  return {
    writeOut: (text) => process.stdout.write(text),
    writeErr: (text) => process.stderr.write(text),
    isTTY: process.stdout.isTTY === true,
    columns: process.stdout.columns || 80
  };
}

async function defaultDependencies(): Promise<CliDependencies> {
  const profileDir = defaultComGuProfileDir();
  const client = createControlClient(profileDir);
  return {
    profileDir,
    request: (method) => client.request(method),
    async startOwner() {
      const { startCliOwner } = await import('./owner.js');
      await startCliOwner({ profileDir });
    },
    async showDashboard() {
      const [{ runDashboard }, { createProcessTerminal }] = await Promise.all([
        import('./tui.js'),
        import('./terminal.js')
      ]);
      await runDashboard({ request: (method) => client.request(method), terminal: createProcessTerminal() });
    },
    async serviceAction(action) {
      const executable = process.env['COMGU_CLI_EXECUTABLE'] || process.argv[1] || process.execPath;
      if (process.platform === 'linux') {
        const { runLinuxServiceAction } = await import('./service-linux.js');
        return runLinuxServiceAction(action, { executable, profileDir });
      }
      if (process.platform === 'win32') {
        const { runWindowsServiceAction } = await import('./service-windows.js');
        return runWindowsServiceAction(action, { executable, profileDir });
      }
      throw new Error('ComGu CLI background services support Windows and Linux only');
    }
  };
}

export async function runCli(
  argv: string[],
  dependencies?: CliDependencies,
  io: CliIo = defaultIo()
): Promise<number> {
  const deps = dependencies ?? (await defaultDependencies());
  const [rawCommand, ...args] = argv;
  const command = rawCommand ?? (io.isTTY ? 'dashboard' : 'help');
  const json = args.includes('--json');

  try {
    switch (command) {
      case 'status': {
        const status = await deps.request('status');
        io.writeOut(json ? `${JSON.stringify(status)}\n` : `${renderPlainStatus(status)}\n`);
        return 0;
      }
      case 'connect':
      case 'disconnect': {
        await deps.request(command);
        io.writeOut(`${command === 'connect' ? 'Connect requested.' : 'Disconnected.'}\n`);
        return 0;
      }
      case 'stop':
        await deps.request('shutdown');
        io.writeOut('Stop requested.\n');
        return 0;
      case 'start':
        await deps.startOwner();
        return 0;
      case 'dashboard':
        if (!io.isTTY) {
          io.writeErr('The ComGu dashboard requires an interactive terminal. Use `comgu status` for scripts.\n');
          return 2;
        }
        if (deps.showDashboard) {
          await deps.showDashboard();
        } else {
          const [{ runDashboard }, { createProcessTerminal }] = await Promise.all([
            import('./tui.js'),
            import('./terminal.js')
          ]);
          await runDashboard({ request: deps.request, terminal: createProcessTerminal() });
        }
        return 0;
      case 'service': {
        const action = args[0] as ServiceAction | undefined;
        if (!action || !['install', 'start', 'stop', 'restart', 'status'].includes(action)) {
          io.writeErr('Usage: comgu service <install|start|stop|restart|status>\n');
          return 2;
        }
        if (!deps.serviceAction) throw new Error('Service lifecycle is unavailable');
        const result = await deps.serviceAction(action);
        if (result) io.writeOut(`${result}\n`);
        return 0;
      }
      case 'help':
      case '--help':
      case '-h':
        io.writeOut('Usage: comgu <start|stop|connect|disconnect|status|dashboard|service> [--json]\n');
        return 0;
      default:
        io.writeErr(`Unknown command: ${command}\n`);
        return 2;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.writeErr(`${message}\n`);
    return 1;
  }
}
