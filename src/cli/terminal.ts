const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  cyan: '\u001b[36m'
} as const;

export function paint(text: string, code: keyof typeof ANSI, enabled: boolean): string {
  return enabled ? `${ANSI[code]}${text}${ANSI.reset}` : text;
}

export function visibleLength(text: string): number {
  return text.replace(/\u001b\[[0-9;]*m/g, '').length;
}

export function clip(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text;
  if (width === 1) return '…';
  return `${text.slice(0, width - 1)}…`;
}

export function pad(text: string, width: number): string {
  const missing = Math.max(0, width - visibleLength(text));
  return `${text}${' '.repeat(missing)}`;
}

/** Native Node terminal adapter used only by the interactive dashboard. */
export function createProcessTerminal() {
  return {
    get columns() {
      return process.stdout.columns || 80;
    },
    color: process.stdout.isTTY === true && !('NO_COLOR' in process.env),
    write(text: string) {
      process.stdout.write(text);
    },
    setRawMode(enabled: boolean) {
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(enabled);
      }
      if (enabled) process.stdin.resume();
    },
    onKey(handler: (key: string) => void) {
      const listener = (chunk: Buffer | string): void => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        for (const key of text) handler(key);
      };
      process.stdin.on('data', listener);
      return () => process.stdin.off('data', listener);
    },
    onSignal(handler: () => void) {
      process.once('SIGINT', handler);
      process.once('SIGTERM', handler);
      return () => {
        process.off('SIGINT', handler);
        process.off('SIGTERM', handler);
      };
    }
  };
}
