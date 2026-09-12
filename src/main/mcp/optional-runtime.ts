import type { SurfaceRegistrar } from './kernel.js';

type AgentsModule = typeof import('../agents.js');
type RecorderModule = typeof import('../session/recorder.js');
type SessionStoreModule = typeof import('../session/store.js');
type ContinuationModule = typeof import('../session/continuation.js');

interface OptionalMcpRuntime {
  agents: AgentsModule | null;
  recorder: RecorderModule | null;
  sessionStore: SessionStoreModule | null;
  continuation: ContinuationModule | null;
  registerSessionTool: ((reg: SurfaceRegistrar) => void) | null;
}

type OptionalMcpBaseRuntime = Omit<OptionalMcpRuntime, 'agents'>;

let runtime: OptionalMcpRuntime = {
  agents: null,
  recorder: null,
  sessionStore: null,
  continuation: null,
  registerSessionTool: null
};

/**
 * Installs the browser/session/agent adapters for the Desktop-app profile. The lightweight CLI
 * deliberately leaves this seam empty: Core continues to work, but no browser-dependent state
 * exists and no import of those implementations is required merely to serve files/commands.
 */
export function installOptionalMcpBaseRuntime(next: OptionalMcpBaseRuntime): void {
  runtime = { ...runtime, ...next };
}

export function installOptionalAgentsRuntime(agents: AgentsModule | null): void {
  runtime.agents = agents;
}

export function optionalAgentsRuntimeInstalled(): boolean {
  return runtime.agents !== null;
}

export function resetOptionalMcpRuntime(): void {
  runtime = { agents: null, recorder: null, sessionStore: null, continuation: null, registerSessionTool: null };
}

export const PRIME_ID = 'prime';

export const swarmRunning = (() => runtime.agents?.swarmRunning() ?? false) as AgentsModule['swarmRunning'];
export const hasRetiredWorkerLeases = (() => runtime.agents?.hasRetiredWorkerLeases() ?? false) as AgentsModule['hasRetiredWorkerLeases'];
export const hasDormantWorkerLeases = (() => runtime.agents?.hasDormantWorkerLeases() ?? false) as AgentsModule['hasDormantWorkerLeases'];
export const sleepSilentDetachedWorkers = ((...args: Parameters<AgentsModule['sleepSilentDetachedWorkers']>) =>
  runtime.agents?.sleepSilentDetachedWorkers(...args) ?? []) as AgentsModule['sleepSilentDetachedWorkers'];
export const noteAgentAlive = ((...args: Parameters<AgentsModule['noteAgentAlive']>) =>
  runtime.agents?.noteAgentAlive(...args) ?? null) as AgentsModule['noteAgentAlive'];
export const agentForCaller = ((...args: Parameters<AgentsModule['agentForCaller']>) =>
  runtime.agents?.agentForCaller(...args) ?? null) as AgentsModule['agentForCaller'];
export const agentForFinishCaller = ((...args: Parameters<AgentsModule['agentForFinishCaller']>) =>
  runtime.agents?.agentForFinishCaller(...args) ?? null) as AgentsModule['agentForFinishCaller'];
export const retiredWorkerForConversation = ((...args: Parameters<AgentsModule['retiredWorkerForConversation']>) =>
  runtime.agents?.retiredWorkerForConversation(...args) ?? null) as AgentsModule['retiredWorkerForConversation'];
export const dormantWorkerNotice = ((...args: Parameters<AgentsModule['dormantWorkerNotice']>) =>
  runtime.agents?.dormantWorkerNotice(...args) ?? null) as AgentsModule['dormantWorkerNotice'];
export const endedWorkerNotice = ((...args: Parameters<AgentsModule['endedWorkerNotice']>) =>
  runtime.agents?.endedWorkerNotice(...args) ?? null) as AgentsModule['endedWorkerNotice'];
export const offerMessages = ((...args: Parameters<AgentsModule['offerMessages']>) =>
  runtime.agents?.offerMessages(...args) ?? []) as AgentsModule['offerMessages'];
export const offerMessagesForConversation = ((...args: Parameters<AgentsModule['offerMessagesForConversation']>) =>
  runtime.agents?.offerMessagesForConversation(...args) ?? null) as AgentsModule['offerMessagesForConversation'];
export const acknowledgeOffers = ((...args: Parameters<AgentsModule['acknowledgeOffers']>) =>
  runtime.agents?.acknowledgeOffers(...args) ?? []) as AgentsModule['acknowledgeOffers'];
export const acknowledgeOffersForConversation = ((...args: Parameters<AgentsModule['acknowledgeOffersForConversation']>) =>
  runtime.agents?.acknowledgeOffersForConversation(...args) ?? null) as AgentsModule['acknowledgeOffersForConversation'];
export const releaseQuiescentRun = ((...args: Parameters<AgentsModule['releaseQuiescentRun']>) =>
  runtime.agents?.releaseQuiescentRun(...args) ?? false) as AgentsModule['releaseQuiescentRun'];
export const requestWorkerRevivals = ((...args: Parameters<AgentsModule['requestWorkerRevivals']>) =>
  runtime.agents?.requestWorkerRevivals(...args) ?? 0) as AgentsModule['requestWorkerRevivals'];
export const persistCriticalSwarmNow = (async (...args: Parameters<AgentsModule['persistCriticalSwarmNow']>) =>
  runtime.agents ? runtime.agents.persistCriticalSwarmNow(...args) : false) as AgentsModule['persistCriticalSwarmNow'];
export const stageQueuedWorkerRevivals = ((...args: Parameters<AgentsModule['stageQueuedWorkerRevivals']>) =>
  runtime.agents?.stageQueuedWorkerRevivals(...args) ?? {
    waking: [],
    commit() {},
    rollback() {}
  }) as AgentsModule['stageQueuedWorkerRevivals'];

export const workspaceScopeForCaller = ((...args: Parameters<AgentsModule['workspaceScopeForCaller']>) => {
  if (!runtime.agents) throw new Error('Multi-agent runtime is unavailable in this profile');
  return runtime.agents.workspaceScopeForCaller(...args);
}) as AgentsModule['workspaceScopeForCaller'];

export const swarmStateForCaller = ((...args: Parameters<AgentsModule['swarmStateForCaller']>) => {
  if (!runtime.agents) throw new Error('Multi-agent runtime is unavailable in this profile');
  return runtime.agents.swarmStateForCaller(...args);
}) as AgentsModule['swarmStateForCaller'];
export const statusForCaller = ((...args: Parameters<AgentsModule['statusForCaller']>) => {
  if (!runtime.agents) throw new Error('Multi-agent runtime is unavailable in this profile');
  return runtime.agents.statusForCaller(...args);
}) as AgentsModule['statusForCaller'];
export const stageSpawn = ((...args: Parameters<AgentsModule['stageSpawn']>) => {
  if (!runtime.agents) throw new Error('Multi-agent runtime is unavailable in this profile');
  return runtime.agents.stageSpawn(...args);
}) as AgentsModule['stageSpawn'];
export const stageMessages = ((...args: Parameters<AgentsModule['stageMessages']>) => {
  if (!runtime.agents) throw new Error('Multi-agent runtime is unavailable in this profile');
  return runtime.agents.stageMessages(...args);
}) as AgentsModule['stageMessages'];
export const stageFinishAgent = ((...args: Parameters<AgentsModule['stageFinishAgent']>) => {
  if (!runtime.agents) throw new Error('Multi-agent runtime is unavailable in this profile');
  return runtime.agents.stageFinishAgent(...args);
}) as AgentsModule['stageFinishAgent'];
export const requestWorkerBootstraps = ((...args: Parameters<AgentsModule['requestWorkerBootstraps']>) =>
  runtime.agents?.requestWorkerBootstraps(...args) ?? 0) as AgentsModule['requestWorkerBootstraps'];
export const noteAgentContextTokens = ((...args: Parameters<AgentsModule['noteAgentContextTokens']>) =>
  runtime.agents?.noteAgentContextTokens(...args)) as AgentsModule['noteAgentContextTokens'];

export function isOptionalRejectedError(error: unknown): boolean {
  return runtime.agents ? error instanceof runtime.agents.AgentError : false;
}

export const freshCallOrigin = ((...args: Parameters<RecorderModule['freshCallOrigin']>) =>
  runtime.recorder?.freshCallOrigin(...args) ?? null) as RecorderModule['freshCallOrigin'];
export const awaitFreshCallOrigin = (async (...args: Parameters<RecorderModule['awaitFreshCallOrigin']>) =>
  runtime.recorder ? runtime.recorder.awaitFreshCallOrigin(...args) : null) as RecorderModule['awaitFreshCallOrigin'];
export const evidenceWindow = ((production: number) => runtime.recorder?.evidenceWindow(production) ?? production) as RecorderModule['evidenceWindow'];
export const recordToolCall = ((...args: Parameters<RecorderModule['recordToolCall']>) =>
  runtime.recorder?.recordToolCall(...args) ?? Promise.resolve(null)) as RecorderModule['recordToolCall'];
export const recordAgentMessage = ((...args: Parameters<RecorderModule['recordAgentMessage']>) =>
  runtime.recorder?.recordAgentMessage(...args) ?? Promise.resolve()) as RecorderModule['recordAgentMessage'];

export const readOverflowText = ((...args: Parameters<SessionStoreModule['readOverflowText']>) =>
  runtime.sessionStore?.readOverflowText(...args) ?? Promise.resolve(null)) as SessionStoreModule['readOverflowText'];
export const findSessionByConversation = ((...args: Parameters<SessionStoreModule['findSessionByConversation']>) =>
  runtime.sessionStore?.findSessionByConversation(...args) ?? Promise.resolve(null)) as SessionStoreModule['findSessionByConversation'];
export const repairPrimeFromResumeShadow = ((...args: Parameters<ContinuationModule['repairPrimeFromResumeShadow']>) =>
  runtime.continuation?.repairPrimeFromResumeShadow(...args) ?? Promise.resolve(false)) as ContinuationModule['repairPrimeFromResumeShadow'];

export function registerOptionalSessionTool(reg: SurfaceRegistrar): void {
  runtime.registerSessionTool?.(reg);
}
