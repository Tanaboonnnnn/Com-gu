import { clip, pad, paint } from './terminal.js';
import type { RuntimeControlMethod } from '../main/runtime/control.js';

interface SurfaceLike {
  id?: string;
  state?: string;
  available?: boolean;
  detail?: string;
}

interface DashboardStatus {
  runtime?: string;
  mode?: string;
  machine?: { name?: string } | null;
  connection?: {
    state?: string;
    detail?: string;
    surfaces?: SurfaceLike[];
  } | null;
}

function titleCase(value: string): string {
  return value.length === 0 ? 'Unknown' : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function stateGlyph(state: string, available: boolean, color: boolean): string {
  if (!available) return paint('○', 'dim', color);
  if (state === 'connected' || state === 'live' || state === 'ready') return paint('●', 'green', color);
  if (state === 'starting' || state === 'offline') return paint('●', 'yellow', color);
  if (state === 'error' || state === 'failed') return paint('●', 'red', color);
  return paint('○', 'dim', color);
}

function plainState(value: string): string {
  if (value === 'connected') return 'Connected';
  if (value === 'disconnected') return 'Disconnected';
  if (value === 'offline') return 'Offline';
  return titleCase(value || 'unknown');
}

export function renderDashboard(
  value: unknown,
  options: { columns: number; color: boolean }
): string {
  const status = (value && typeof value === 'object' ? value : {}) as DashboardStatus;
  const width = Math.max(36, Math.min(88, Math.floor(options.columns || 80)));
  const inside = width - 4;
  const machine = status.machine?.name || 'unknown-machine';
  const connection = status.connection?.state || 'unknown';
  const surfaces = status.connection?.surfaces ?? [];
  const core = surfaces.find((entry) => entry.id === 'core');
  const desktop = surfaces.find((entry) => entry.id === 'desktop');
  const border = (left: string, fill: string, right: string): string => `${left}${fill.repeat(width - 2)}${right}`;
  const row = (text = ''): string => `│ ${pad(clip(text, inside), inside)} │`;
  const surfaceRow = (label: string, surface: SurfaceLike | undefined): string => {
    const available = surface?.available === true;
    const state = surface?.state || (available ? 'ready' : 'unavailable');
    const detail = surface?.detail?.trim();
    const text = `${stateGlyph(state, available, options.color)} ${label.padEnd(10)} ${available ? plainState(state) : (detail || 'Unavailable')}`;
    return row(text);
  };

  const headerText = ` ComGu · ${clip(machine, Math.max(8, inside - 14))} `;
  const headerPad = Math.max(0, width - 2 - headerText.length);
  const header = `╭${'─'.repeat(Math.floor(headerPad / 2))}${headerText}${'─'.repeat(Math.ceil(headerPad / 2))}╮`;
  const connectionText = `${stateGlyph(connection, connection !== 'disconnected', options.color)} Connection  ${plainState(connection)}`;

  return [
    header,
    row(`${paint('ComGu', 'bold', options.color)} ${paint(status.mode || 'cli', 'dim', options.color)}`),
    row(),
    row(connectionText),
    surfaceRow('Core', core),
    surfaceRow('Desktop', desktop),
    ...(status.connection?.detail?.trim() ? [row(), row(`Status: ${status.connection.detail.trim()}`)] : []),
    row(),
    border('├', '─', '┤'),
    row('[C] Connect  [D] Disconnect  [R] Refresh  [Q] Quit'),
    border('╰', '─', '╯')
  ].join('\n');
}

export interface DashboardTerminal {
  columns: number;
  color: boolean;
  write(text: string): void;
  setRawMode(enabled: boolean): void;
  onKey(handler: (key: string) => void): () => void;
  onSignal?(handler: () => void): () => void;
}

export interface DashboardOptions {
  request(method: RuntimeControlMethod): Promise<unknown>;
  terminal: DashboardTerminal;
  refreshMs?: number;
}

export async function runDashboard(options: DashboardOptions): Promise<void> {
  const refreshMs = Math.max(1_000, options.refreshMs ?? 5_000);
  let closed = false;
  let chain = Promise.resolve();
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const draw = async (): Promise<void> => {
    if (closed) return;
    const status = await options.request('status');
    if (closed) return;
    options.terminal.write(`\u001b[2J\u001b[H${renderDashboard(status, {
      columns: options.terminal.columns,
      color: options.terminal.color
    })}\n`);
  };

  const enqueue = (work: () => Promise<void>): void => {
    chain = chain.then(work);
  };

  let removeKey = (): void => {};
  let removeSignal = (): void => {};
  let timer: ReturnType<typeof setInterval> | null = null;

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
    removeKey();
    removeSignal();
    options.terminal.setRawMode(false);
    options.terminal.write('\u001b[?1049l');
    resolveClosed();
  };

  options.terminal.write('\u001b[?1049h');
  options.terminal.setRawMode(true);
  removeKey = options.terminal.onKey((key) => {
    if (key === '\u0003') {
      cleanup();
      return;
    }
    const normalized = key.toLowerCase();
    if (normalized === 'q') {
      cleanup();
      return;
    }
    if (normalized === 'c') enqueue(async () => { await options.request('connect'); await draw(); });
    if (normalized === 'd') enqueue(async () => { await options.request('disconnect'); await draw(); });
    if (normalized === 'r') enqueue(draw);
  });
  removeSignal = options.terminal.onSignal?.(cleanup) ?? (() => {});

  timer = setInterval(() => enqueue(draw), refreshMs);

  try {
    await draw();
    await closedPromise;
    await chain;
  } finally {
    cleanup();
  }
}
