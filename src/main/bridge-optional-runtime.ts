import type { SwarmState } from '../shared/session.js';

type AgentsModule = typeof import('./agents.js');
type GoalModule = typeof import('./goal.js');

let agents: AgentsModule | null = null;
let goal: GoalModule | null = null;

export type WorkerRevival = import('./agents.js').WorkerRevival;

export function installBridgeAgentsRuntime(module: AgentsModule | null): void {
  agents = module;
}

export function installBridgeGoalRuntime(module: GoalModule | null): void {
  goal = module;
}

export function resetBridgeOptionalRuntime(): void {
  agents = null;
  goal = null;
}

const emptySwarm = (): SwarmState => ({
  enabled: false,
  running: false,
  runId: null,
  workspaceScope: null,
  selectedWorkspaceScope: null,
  agents: []
});

const unavailable = (feature: string): never => {
  throw new Error(`${feature} runtime is unavailable`);
};

// Goal is a real optional feature for the bridge. Calls that are meaningful while Goal is off
// resolve to the same empty/false values the disabled feature exposes; calls that would create
// work fail loudly if bootstrap forgot to install the enabled adapter.
export const goalObjectiveFor = ((...args: Parameters<GoalModule['goalObjectiveFor']>) =>
  goal?.goalObjectiveFor(...args) ?? '') as GoalModule['goalObjectiveFor'];
export const clearGoalObjective = ((...args: Parameters<GoalModule['clearGoalObjective']>) =>
  goal?.clearGoalObjective(...args)) as GoalModule['clearGoalObjective'];
export const moveGoalObjective = ((...args: Parameters<GoalModule['moveGoalObjective']>) =>
  goal?.moveGoalObjective(...args) ?? false) as GoalModule['moveGoalObjective'];
export const goalKeyPresent = (async (...args: Parameters<GoalModule['goalKeyPresent']>) =>
  goal ? goal.goalKeyPresent(...args) : false) as GoalModule['goalKeyPresent'];
export const goalViewFor = ((...args: Parameters<GoalModule['goalViewFor']>) =>
  goal?.goalViewFor(...args) ?? null) as GoalModule['goalViewFor'];
export const retireGoalDrafts = ((...args: Parameters<GoalModule['retireGoalDrafts']>) =>
  goal?.retireGoalDrafts(...args)) as GoalModule['retireGoalDrafts'];
export const retireGoalDraftsFor = ((...args: Parameters<GoalModule['retireGoalDraftsFor']>) =>
  goal?.retireGoalDraftsFor(...args)) as GoalModule['retireGoalDraftsFor'];
export const ackGoalDraft = ((...args: Parameters<GoalModule['ackGoalDraft']>) =>
  goal?.ackGoalDraft(...args) ?? false) as GoalModule['ackGoalDraft'];
export const startGoalDraft = ((...args: Parameters<GoalModule['startGoalDraft']>) =>
  goal ? goal.startGoalDraft(...args) : unavailable('Goal')) as GoalModule['startGoalDraft'];
export const setGoalObjectiveNow = (async (...args: Parameters<GoalModule['setGoalObjectiveNow']>) =>
  goal ? goal.setGoalObjectiveNow(...args) : unavailable('Goal')) as GoalModule['setGoalObjectiveNow'];
export const draftOpeningMessage = (async (...args: Parameters<GoalModule['draftOpeningMessage']>) =>
  goal ? goal.draftOpeningMessage(...args) : unavailable('Goal')) as GoalModule['draftOpeningMessage'];

// Multi-agent is likewise optional. The bridge still records ordinary chats while this adapter is
// absent, so read-only identity/status queries return their natural "no active run" values. Any
// mutation path that can only be reached while multi-agent is enabled is expected to have the
// real adapter installed first and therefore fails rather than inventing broker state.
export const PRIME_ID = 'prime';
export const swarmState = (() => agents?.swarmState() ?? emptySwarm()) as AgentsModule['swarmState'];
export const currentRunId = (() => agents?.currentRunId() ?? null) as AgentsModule['currentRunId'];
export const currentRunAuthorityGuard = (() =>
  agents?.currentRunAuthorityGuard() ?? { runId: null, scopeFingerprint: null }) as AgentsModule['currentRunAuthorityGuard'];
export const swarmTransferActive = (() => agents?.swarmTransferActive() ?? false) as AgentsModule['swarmTransferActive'];
export const agentForConversation = ((...args: Parameters<AgentsModule['agentForConversation']>) =>
  agents?.agentForConversation(...args) ?? null) as AgentsModule['agentForConversation'];
export const agentForOwnedConversation = ((...args: Parameters<AgentsModule['agentForOwnedConversation']>) =>
  agents?.agentForOwnedConversation(...args) ?? null) as AgentsModule['agentForOwnedConversation'];
export const beginPrimeTransfer = ((...args: Parameters<AgentsModule['beginPrimeTransfer']>) =>
  agents?.beginPrimeTransfer(...args) ?? false) as AgentsModule['beginPrimeTransfer'];
export const cancelPrimeTransfer = ((...args: Parameters<AgentsModule['cancelPrimeTransfer']>) =>
  agents?.cancelPrimeTransfer(...args)) as AgentsModule['cancelPrimeTransfer'];
export const commitPrimeTransfer = ((...args: Parameters<AgentsModule['commitPrimeTransfer']>) =>
  agents?.commitPrimeTransfer(...args) ?? false) as AgentsModule['commitPrimeTransfer'];
export const freezePrimeTransfer = ((...args: Parameters<AgentsModule['freezePrimeTransfer']>) =>
  agents?.freezePrimeTransfer(...args) ?? 'absent') as AgentsModule['freezePrimeTransfer'];
export const thawPrimeTransfer = ((...args: Parameters<AgentsModule['thawPrimeTransfer']>) =>
  agents?.thawPrimeTransfer(...args)) as AgentsModule['thawPrimeTransfer'];
export const agentInfoForOwnedConversation = ((...args: Parameters<AgentsModule['agentInfoForOwnedConversation']>) =>
  agents?.agentInfoForOwnedConversation(...args) ?? null) as AgentsModule['agentInfoForOwnedConversation'];
export const retiredWorkerForConversation = ((...args: Parameters<AgentsModule['retiredWorkerForConversation']>) =>
  agents?.retiredWorkerForConversation(...args) ?? null) as AgentsModule['retiredWorkerForConversation'];
export const pendingWorkerSpawns = (() => agents?.pendingWorkerSpawns() ?? []) as AgentsModule['pendingWorkerSpawns'];
export const pendingWorkerRevivals = (() => agents?.pendingWorkerRevivals() ?? []) as AgentsModule['pendingWorkerRevivals'];
export const workerRevivalDeliveredSince = ((...args: Parameters<AgentsModule['workerRevivalDeliveredSince']>) =>
  agents?.workerRevivalDeliveredSince(...args) ?? false) as AgentsModule['workerRevivalDeliveredSince'];
export const releaseQuiescentRun = ((...args: Parameters<AgentsModule['releaseQuiescentRun']>) =>
  agents?.releaseQuiescentRun(...args) ?? false) as AgentsModule['releaseQuiescentRun'];
export const sleepSilentDetachedWorkers = ((...args: Parameters<AgentsModule['sleepSilentDetachedWorkers']>) =>
  agents?.sleepSilentDetachedWorkers(...args) ?? []) as AgentsModule['sleepSilentDetachedWorkers'];
export const stageQueuedWorkerRevivals = ((...args: Parameters<AgentsModule['stageQueuedWorkerRevivals']>) =>
  agents?.stageQueuedWorkerRevivals(...args) ?? { waking: [], commit() {}, rollback() {} }) as AgentsModule['stageQueuedWorkerRevivals'];
export const persistCriticalSwarmNow = (async (...args: Parameters<AgentsModule['persistCriticalSwarmNow']>) =>
  agents ? agents.persistCriticalSwarmNow(...args) : false) as AgentsModule['persistCriticalSwarmNow'];

export const bindConversation = ((...args: Parameters<AgentsModule['bindConversation']>) =>
  agents ? agents.bindConversation(...args) : false) as AgentsModule['bindConversation'];
export const noteAgentAlive = ((...args: Parameters<AgentsModule['noteAgentAlive']>) =>
  agents?.noteAgentAlive(...args) ?? false) as AgentsModule['noteAgentAlive'];
export const noteAgentContextTokens = ((...args: Parameters<AgentsModule['noteAgentContextTokens']>) =>
  agents?.noteAgentContextTokens(...args)) as AgentsModule['noteAgentContextTokens'];
export const primeConversationGone = ((...args: Parameters<AgentsModule['primeConversationGone']>) =>
  agents?.primeConversationGone(...args) ?? false) as AgentsModule['primeConversationGone'];
export const workerConversationGone = ((...args: Parameters<AgentsModule['workerConversationGone']>) =>
  agents?.workerConversationGone(...args) ?? false) as AgentsModule['workerConversationGone'];

export const finishWorkerConversation = ((...args: Parameters<AgentsModule['finishWorkerConversation']>) =>
  agents ? agents.finishWorkerConversation(...args) : false) as AgentsModule['finishWorkerConversation'];
export const stageWorkerConversationFinish = ((...args: Parameters<AgentsModule['stageWorkerConversationFinish']>) =>
  agents ? agents.stageWorkerConversationFinish(...args) : null) as AgentsModule['stageWorkerConversationFinish'];
export const noteWorkerRevived = ((...args: Parameters<AgentsModule['noteWorkerRevived']>) =>
  agents?.noteWorkerRevived(...args) ?? false) as AgentsModule['noteWorkerRevived'];
export const claimWorkerRevival = ((...args: Parameters<AgentsModule['claimWorkerRevival']>) =>
  agents?.claimWorkerRevival(...args) ?? false) as AgentsModule['claimWorkerRevival'];
export const rollbackWorkerRevivalClaim = ((...args: Parameters<AgentsModule['rollbackWorkerRevivalClaim']>) =>
  agents?.rollbackWorkerRevivalClaim(...args) ?? false) as AgentsModule['rollbackWorkerRevivalClaim'];
export const failWorkerRevival = ((...args: Parameters<AgentsModule['failWorkerRevival']>) =>
  agents?.failWorkerRevival(...args)) as AgentsModule['failWorkerRevival'];
export const failAgent = ((...args: Parameters<AgentsModule['failAgent']>) =>
  agents?.failAgent(...args)) as AgentsModule['failAgent'];
export const sleepWorker = ((...args: Parameters<AgentsModule['sleepWorker']>) =>
  agents ? agents.sleepWorker(...args) : false) as AgentsModule['sleepWorker'];
export const requestWorkerRevivals = ((...args: Parameters<AgentsModule['requestWorkerRevivals']>) =>
  agents?.requestWorkerRevivals(...args) ?? 0) as AgentsModule['requestWorkerRevivals'];

const noListener = (): (() => void) => () => {};
export const onSpawnRequest = ((...args: Parameters<AgentsModule['onSpawnRequest']>) =>
  agents ? agents.onSpawnRequest(...args) : noListener()) as AgentsModule['onSpawnRequest'];
export const onReviveRequest = ((...args: Parameters<AgentsModule['onReviveRequest']>) =>
  agents ? agents.onReviveRequest(...args) : noListener()) as AgentsModule['onReviveRequest'];
export const onPrimeWakeRequest = ((...args: Parameters<AgentsModule['onPrimeWakeRequest']>) =>
  agents ? agents.onPrimeWakeRequest(...args) : noListener()) as AgentsModule['onPrimeWakeRequest'];
export const onSwarmEnd = ((...args: Parameters<AgentsModule['onSwarmEnd']>) =>
  agents ? agents.onSwarmEnd(...args) : noListener()) as AgentsModule['onSwarmEnd'];
