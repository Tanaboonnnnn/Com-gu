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
