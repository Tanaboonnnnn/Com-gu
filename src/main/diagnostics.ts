/**
 * A self-test that answers "where exactly is this broken", one hop at a time.
 *
 * The chain from ChatGPT to a file on this PC has four links, and a failure in any of
 * them looks identical from the outside — ChatGPT just says it cannot use the
 * connector. So each link is checked separately, in order, and reported as its own
 * line: the local MCP server, the tunnel process, the tunnel's route to OpenAI, and
 * whether ChatGPT has ever actually arrived here.
 *
 * Everything is loopback-only. Nothing is sent to OpenAI, and the results contain no
 * secrets: the session token in the local URL is never included.
 */

import { getStatus, isServerRunning, tunnelHealthBase } from './connection.js';

import { effectiveCapabilities, getConfig } from './config.js';
import { logInfo, logWarn } from './logger.js';
import { lastRequestAt, selfTestHeaders } from './mcp/server.js';
import { lastToolCallAt } from './mcp/tools.js';
import {
  ago,
  POLL_FRESH_MS,
  readClientStatus,
  readPollHealth,
  type PollHealth
} from './tunnel/health.js';

import type { Check, Diagnosis } from '../shared/types.js';
import { surfaceIsUseful } from './mcp/surfaces.js';
import { t, type Locale, type MessageKey } from '../shared/i18n/index.js';

function dc(locale: Locale, key: MessageKey, values?: Record<string, string | number>): string {
  return t(locale, key, values);
}

function diagnosticAgo(locale: Locale, atMs: number | null, nowMs = Date.now()): string {
  if (locale === 'en') return ago(atMs, nowMs);
  if (atMs === null) return dc(locale, 'common.never');
  const seconds = Math.max(0, Math.round((nowMs - atMs) / 1000));
  if (seconds < 3) return dc(locale, 'common.justNow');
  if (seconds < 90) return dc(locale, 'common.secondsAgo', { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return dc(locale, 'common.minutesAgo', { count: minutes });
  return dc(locale, 'common.hoursAgo', { count: Math.round(minutes / 60) });
}

async function fetchJson(
  url: string,
  body: unknown,
  timeoutMs = 5000
): Promise<{ status: number; json: unknown; text: string } | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: abort.signal,
      headers: {
        'content-type': 'application/json',
        // Streamable HTTP servers may answer either way; accept both.
        accept: 'application/json, text/event-stream',
        // Identifies these as our own probes, so they are not counted as ChatGPT
        // having reached this app. Otherwise running the self-test would make the
        // one check that proves the connector works pass because of the self-test.
        ...selfTestHeaders()
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    return { status: res.status, json: parseRpc(text), text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Accepts a plain JSON body or an SSE stream carrying one JSON-RPC message. */
export function parseRpc(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  for (const line of trimmed.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      return JSON.parse(line.slice(5).trim());
    } catch {
      /* keep looking */
    }
  }
  return null;
}

const PROTOCOL_VERSION = '2025-06-18';

/**
 * Reports the client → OpenAI link without calling a tunnel that is still starting broken.
 *
 * The first control-plane poll is a long poll with a 30s timeout, so a client that came up
 * four seconds ago genuinely has no completed handshake yet. Reading that as "Not verified"
 * put a red problem on the self-test every single time the app started, for a connection
 * that was about to work — and it contradicted the tunnel supervisor, which already gives
 * the first poll exactly this grace before it will say a word about an outage.
 */
export function describeRoute(
  health: PollHealth | null,
  uptimeSeconds: number | null,
  nowMs = Date.now(),
  locale: Locale = 'en'
): Check {
  const name = dc(locale, 'diagnostics.route');
  if (health === null) return { name, status: 'not-run', ok: null, detail: dc(locale, 'diagnostics.noMetrics') };

  const errors = dc(locale, 'diagnostics.pollErrors', { count: health.errors ?? 0 });
  if (health.lastSuccessMs !== null && nowMs - health.lastSuccessMs <= POLL_FRESH_MS) {
    return {
      name,
      status: 'pass',
      ok: true,
      detail: dc(locale, 'diagnostics.routeVerified', {
        ago: diagnosticAgo(locale, health.lastSuccessMs, nowMs),
        errors
      })
    };
  }
  // Only a client that has *never* polled successfully gets the benefit of the doubt. One
  // that managed it once and then went quiet is a real outage, however young it is.
  if (health.lastSuccessMs === null && uptimeSeconds !== null && uptimeSeconds * 1000 < POLL_FRESH_MS) {
    return {
      name,
      status: 'not-run',
      ok: null,
      detail: dc(locale, 'diagnostics.routeStarting', { errors })
    };
  }
  return {
    name,
    status: 'fail',
    ok: false,
    detail: dc(locale, 'diagnostics.routeNotVerified', {
      ago: diagnosticAgo(locale, health.lastSuccessMs, nowMs),
      errors
    })
  };
}

/** Runs an initialize + tools/list against our own loopback endpoint. */
async function checkLocalServer(url: string, locale: Locale): Promise<Check> {
  const init = await fetchJson(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'self-test', version: '1' }
    }
  });
  if (init === null) {
    return { name: dc(locale, 'diagnostics.localServer'), status: 'fail', ok: false, detail: dc(locale, 'diagnostics.localNoAnswer') };
  }
  const initObj = init.json as { error?: { message?: string } } | null;
  if (init.status >= 400 || initObj?.error) {
    return {
      name: dc(locale, 'diagnostics.localServer'),
      status: 'fail',
      ok: false,
      detail: dc(locale, 'diagnostics.initializeFailed', {
        detail: `HTTP ${init.status} ${initObj?.error?.message ?? init.text.slice(0, 120)}`
      })
    };
  }

  const list = await fetchJson(url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const listObj = list?.json as
    | { result?: { tools?: Array<{ name?: string }> }; error?: { message?: string } }
    | null;
  const tools = listObj?.result?.tools;
  if (!Array.isArray(tools)) {
    return {
      name: dc(locale, 'diagnostics.localServer'),
      status: 'fail',
      ok: false,
      detail: dc(locale, 'diagnostics.toolsListFailed', {
        detail: listObj?.error?.message ?? `HTTP ${list?.status ?? 0}`
      })
    };
  }
  const names = tools.map((t) => t.name).filter(Boolean);
  return {
    name: dc(locale, 'diagnostics.localServer'),
    status: 'pass',
    ok: true,
    detail: dc(locale, 'diagnostics.localAnswers', { count: names.length, tools: names.join(', ') })
  };
}

async function probeText(url: string): Promise<{ status: number; body: string } | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 3000);
  try {
    const res = await fetch(url, { signal: abort.signal });
    return { status: res.status, body: (await res.text()).trim().slice(0, 200) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tells apart "everything works" from the one failure that mimics it.
 *
 * When Developer mode is off in ChatGPT — and a ChatGPT update has been seen to switch
 * it off on its own — the connector still handshakes: this app is asked to initialize
 * and to list its tools, so every other check here goes green, while the model itself
 * is refused with FORBIDDEN and never calls a single tool. Requests arriving with no
 * tool call ever following is that exact fingerprint.
 *
 * It is not proof, because it also describes a connector nobody has used yet, so this
 * never reports a hard failure. It names the suspicion, which is the part that costs
 * an hour to work out from scratch.
 */
function developerMode(seen: number | null, called: number | null, locale: Locale): Check {
  if (called !== null) {
    return {
      name: dc(locale, 'diagnostics.chatgptAllowed'),
      status: 'pass',
      ok: true,
      detail: dc(locale, 'diagnostics.developerYes', { ago: diagnosticAgo(locale, called) })
    };
  }
  if (seen === null) {
    return {
      name: dc(locale, 'diagnostics.chatgptAllowed'),
      status: 'not-run',
      ok: null,
      detail: dc(locale, 'diagnostics.developerUnknown')
    };
  }
  return {
    name: dc(locale, 'diagnostics.chatgptAllowed'),
    status: 'not-run',
    ok: null,
    detail: dc(locale, 'diagnostics.developerCannotTell')
  };
}

export async function runDiagnostics(): Promise<Diagnosis> {
  const checks: Check[] = [];
  const config = getConfig();
  const locale: Locale = config.ui.locale === 'th' ? 'th' : 'en';
  const caps = effectiveCapabilities(config);
  const status = getStatus();

  // 1. Is there anything to serve at all?
  const enabled = Object.entries(caps)
    .filter(([, on]) => on)
    .map(([name]) => name);
  checks.push({
    name: dc(locale, 'diagnostics.permissions'),
    status:
      enabled.length > 0 && (config.roots.length > 0 || surfaceIsUseful('desktop', caps)) ? 'pass' : 'fail',
    ok: enabled.length > 0 && (config.roots.length > 0 || surfaceIsUseful('desktop', caps)),
    detail:
      enabled.length === 0
        ? dc(locale, 'diagnostics.permissionsNone')
        : dc(locale, 'diagnostics.permissionsShared', {
            folders: config.roots.length,
            enabled: enabled.join(', '),
            readOnly: config.readOnly ? dc(locale, 'diagnostics.readOnlySuffix') : ''
          })
  });

  // 2. Our own server, end to end, over the same URL the tunnel uses.
  if (!isServerRunning() || !status.localUrl) {
    checks.push({
      name: dc(locale, 'diagnostics.localServer'),
      status: 'fail',
      ok: false,
      detail: dc(locale, 'diagnostics.localNotRunning')
    });
  } else {
    checks.push(await checkLocalServer(status.localUrl, locale));
  }

  // 3. The tunnel process itself.
  const base = tunnelHealthBase();
  if (config.tunnel.kind !== 'openai') {
    checks.push({
      name: dc(locale, 'diagnostics.tunnel'),
      status: 'skipped',
      ok: null,
      detail: dc(locale, 'diagnostics.tunnelSkipped', { kind: config.tunnel.kind })
    });
  } else if (!base) {
    checks.push({
      name: dc(locale, 'diagnostics.tunnel'),
      status: 'fail',
      ok: false,
      detail: dc(locale, 'diagnostics.tunnelNotRunning')
    });
  } else {
    const ready = await probeText(`${base}/readyz`);
    checks.push({
      name: dc(locale, 'diagnostics.tunnel'),
      status: ready?.status === 200 ? 'pass' : 'fail',
      ok: ready?.status === 200,
      detail:
        ready === null
          ? dc(locale, 'diagnostics.tunnelNoAnswer')
          : ready.status === 200
            ? dc(locale, 'diagnostics.tunnelReady')
            : dc(locale, 'diagnostics.tunnelNotReady', { detail: `HTTP ${ready.status} ${ready.body}` })
    });

    // 4. The link the outage actually breaks: client → OpenAI, and 5. what the tunnel
    //    thinks of us. Read together because the route check needs the client's uptime
    //    to tell "not working" apart from "has not finished starting".
    const [health, client] = await Promise.all([readPollHealth(base), readClientStatus(base)]);
    checks.push(describeRoute(health, client?.uptimeSeconds ?? null, Date.now(), locale));

    if (client) {
      checks.push({
        name: dc(locale, 'diagnostics.tunnelToApp'),
        status: client.probe === null ? 'not-run' : client.probe === 'ok' ? 'pass' : 'fail',
        ok: client.probe === null ? null : client.probe === 'ok',
        detail:
          client.probe === null
            ? dc(locale, 'diagnostics.noProbe')
            : dc(locale, 'diagnostics.probe', { probe: client.probe })
      });
      if (client.metadataError) {
        checks.push({
          name: dc(locale, 'diagnostics.lastTunnelError'),
          status: 'fail',
          ok: false,
          detail: client.metadataError.slice(0, 300)
        });
      }
    }
  }

  // 6. The only end-to-end proof there is.
  const seen = lastRequestAt();
  checks.push({
    name: dc(locale, 'diagnostics.chatgptReaching'),
    status: seen === null ? 'not-run' : 'pass',
    ok: seen === null ? null : true,
    detail:
      seen === null
        ? dc(locale, 'diagnostics.noChatgptRequest')
        : dc(locale, 'diagnostics.lastChatgptRequest', { ago: diagnosticAgo(locale, seen) })
  });

  // 7. The failure that looks exactly like success: ChatGPT connects, this app
  //    answers, and the model is still not allowed to call anything.
  checks.push(developerMode(seen, lastToolCallAt(), locale));

  const broken = checks.filter((c) => c.status === 'fail');
  const incomplete = checks.filter((c) => c.status === 'not-run');
  const summary =
    broken.length > 0
      ? dc(locale, 'diagnostics.summaryProblems', { count: broken.length, names: broken.map((c) => c.name).join(', ') })
      : incomplete.length > 0
        ? dc(locale, 'diagnostics.summaryIncomplete', { count: incomplete.length })
        : dc(locale, 'diagnostics.summaryPassed');

  logInfo(`self-test: ${summary}`);
  for (const check of checks) {
    const line = `self-test ${check.name}: ${check.detail}`;
    if (check.ok === false) logWarn(line);
    else logInfo(line);
  }

  return { checks, summary };
}
