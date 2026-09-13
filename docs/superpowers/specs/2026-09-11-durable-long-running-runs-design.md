# Durable Long-Running Runs Design

## Goal

Allow ComGu to carry a user-requested job for hours across ChatGPT turn completion, browser reconnects, and ComGu restarts without replaying ambiguous mutations, while keeping both CLI and Desktop baseline startup and memory costs low.

## Chosen architecture

The design combines two deepening opportunities that were selected together:

1. A **Durable Run module** owns long-running work state, checkpointing, leases, suspension, recovery, and reconciliation decisions behind one small interface.
2. A **runtime feature-loader seam** keeps optional browser, Goal, session, agent, and Desktop machinery lazily loaded. Runtime profiles define what may load; current configuration determines what actually loads.

The two choices are coupled deliberately. Durable Run state belongs to a small Node-only module so the CLI can persist and inspect runs without importing browser or Electron code. Desktop adapters may attach richer continuation and browser behaviour only when enabled.

## Durable Run module

### Interface

Callers should need only four operations:

- `open(objective, owner)` creates or returns the active run for that logical objective.
- `observe(runId)` returns an immutable view suitable for CLI/Desktop status surfaces.
- `advance(runId, event)` commits one verified state transition and its durable checkpoint.
- `recover()` restores non-terminal runs and returns the work that is safe to resume.

The interface hides persistence format, lease renewal, deduplication, expiry, retry classification, and reconciliation bookkeeping. Tests cross this same seam.

### States

A Durable Run moves through these product states:

- `running`: an actor currently owns a valid lease and is advancing work.
- `waiting`: the run is waiting for ChatGPT/browser/provider progress that is expected to continue.
- `suspended`: no actor currently owns the run, but recovery is safe.
- `needs-reconciliation`: the previous operation may have mutated state, but its outcome is not proven.
- `completed`: the objective is durably recorded as complete.
- `cancelled`: the user explicitly stopped the run.

There is no generic `failed` terminal state for transport loss. Recoverable infrastructure failures suspend the run instead of discarding it.

### Lease semantics

- A live actor renews a short lease while it is actively advancing a run.
- Lease expiry changes `running`/`waiting` to `suspended`; it never deletes the run.
- Runs remain recoverable for at least 24 hours unless explicitly completed or cancelled.
- Recovery may acquire a new lease only after durable state has been loaded and ownership is re-established.
- Timers are advisory wake-up mechanisms. Durable timestamps are the source of truth after restart.

### Checkpoints

Each accepted transition writes one durable record before publishing the new in-memory view. The record contains:

- run identity and objective
- current state and owning principal
- last completed phase/checkpoint
- continuation intent, if any
- operation receipt metadata for the latest externally visible action
- timestamps needed to recover leases and retention

Checkpoint data must stay compact. It stores control state and references, not duplicated transcripts, tool outputs, screenshots, or file contents already owned by existing stores.

## Safe continuation and reconciliation

Operations are classified by retry semantics at the Durable Run seam:

- Read-only observations can be retried after transport loss.
- Operations with an existing idempotency/receipt contract can be retried only through that contract.
- Mutations with an ambiguous outcome enter `needs-reconciliation`.

Examples of ambiguous mutations include an `apply_patch` call whose response was lost or an arbitrary command that may have changed external state. Recovery must first inspect current state. It may then record `already-applied`, `safe-to-retry`, or remain blocked for user/agent review.

The Durable Run module never replays an arbitrary mutation solely because a lease or HTTP request expired.

## Relationship to existing Goal and Compact & Resume behaviour

Durable Run does not replace session recording or Compact & Resume. Existing session storage remains authoritative for conversation history, and the continuation transaction remains authoritative for moving a local session between ChatGPT chats.

Goal becomes an optional continuation adapter: after a settled turn, it may propose the next user message for a Durable Run. The Durable Run module decides whether a continuation is still allowed and records the transition before browser delivery.

This removes long-run lifecycle knowledge from `goal.ts` and `bridge.ts` over time without duplicating their browser/protocol rules inside the new module.

## Runtime feature-loader seam

### Policy

`RuntimeProfile` remains the policy authority for which feature families are allowed. A new loader interprets that profile plus live configuration and dynamically imports only required adapters.

The core lifecycle must remain importable without Electron, browser, Goal, session, agent, or platform Desktop implementations.

### CLI

The CLI baseline loads:

- configuration and machine identity
- credential vault
- MCP Core/runtime lifecycle
- Durable Run core only when long-run commands/status need it
- Desktop driver only when the configured CLI permissions and platform require it

The CLI must not import Goal, browser bridge, session recording, agents, or Electron through static or unconditional dynamic edges.

### Desktop

Desktop may support all feature families, but support does not imply eager loading. Browser/Goal/session/agents are loaded when enabled or when a user action needs them. Platform Desktop adapters are loaded according to platform and granted capability.

Electron bootstrap remains an adapter at the runtime seam rather than a dependency of shared Core modules.

## Performance constraints

The feature must not regress the lightweight work already completed for the CLI.

Acceptance checks:

- CLI `status --json` and admin commands do not import Durable Run browser adapters, Goal, sessions, agents, or Electron.
- CLI packaged smoke still starts the owner and answers status successfully.
- Desktop startup does not eagerly import disabled Goal/agent machinery.
- No periodic busy loop is introduced. Timers exist only for lease wake-ups/housekeeping and sleep while no relevant run exists.
- Durable Run snapshots remain bounded and do not duplicate large session payloads.
- Startup/RSS measurements are recorded before and after implementation; a meaningful regression requires investigation rather than being accepted silently.

## Recovery scenarios

### ChatGPT turn ends but objective is unfinished

The settled turn is recorded. Durable Run transitions to `waiting`, a continuation adapter derives the next turn, and browser delivery is queued through the existing durable bridge command machinery. Completion produces `completed`, not another continuation.

### Browser reloads or reconnects

No new run is created. The replacement page re-establishes its existing identity, claims only the durable command intended for it, and renews the run lease after the existing identity checks succeed.

### ComGu restarts

Startup loads compact Durable Run state before continuation is attempted. Expired leases become `suspended`. Safe read-only work may resume; ambiguous mutations become `needs-reconciliation`.

### Provider or network outage

Provider failure suspends/waits with bounded backoff. It does not consume the run, create duplicate user turns, or extend an in-flight HTTP request for hours.

### User stops the run

Cancellation is durable and prevents future continuations. It does not kill unrelated user processes merely because the run previously observed them.

## Error handling

- Persistence failure: do not publish the transition; leave the previous durable state authoritative.
- Lost acknowledgement: deduplicate by transition/operation receipt rather than repeating the side effect.
- Lost identity: suspend/fail closed until identity is proven again.
- Reconciliation cannot prove outcome: remain `needs-reconciliation` and surface the reason.
- Corrupt durable run record: quarantine that run record, leave existing session/config stores untouched, and surface a diagnostic rather than guessing.

## Test seams

The public Durable Run interface is the primary behavioural test seam. Required scenarios include:

- open/advance/complete persists atomically
- expired lease suspends and can be recovered
- restart restores a waiting run without duplicating a continuation
- read-only retry is allowed after loss
- ambiguous mutation becomes `needs-reconciliation`
- completion/cancellation cannot be resurrected by stale recovery
- lost identity cannot acquire or renew a lease

Runtime-loader tests verify import graphs and observable startup behaviour rather than implementation internals:

- CLI core/admin graph excludes browser/Goal/session/agent/Electron modules
- Desktop with Goal/agents disabled does not load them before use
- enabling a feature loads exactly its adapter and preserves existing behaviour
- packaged CLI smoke and existing Desktop build remain green

## Migration strategy

Implementation proceeds in vertical slices. Existing Goal, continuation, and bridge state machines are not rewritten wholesale. First introduce Durable Run for one long-run path, then route existing continuation decisions through it while preserving old protocol and durability invariants. Static imports are removed only when a lazy adapter is proven by tests.

This is a replace-not-layer migration: when the Durable Run module becomes authoritative for a lifecycle decision, the corresponding duplicated decision is removed from the caller rather than left in parallel.

## Non-goals

- Keeping a single ChatGPT generation or HTTP request open for hours.
- Automatic replay of arbitrary mutation tool calls.
- Enabling browser/session/Goal/agent machinery in the standalone CLI.
- A second session transcript store.
- Replacing Compact & Resume or existing workspace/security ownership rules.
- General refactoring of unrelated large files solely to reduce line counts.

## Acceptance criteria

The work is complete when a Durable Run can survive turn completion, browser reconnect, and ComGu restart; resumes only work whose retry semantics are proven safe; exposes reconciliation when mutation outcome is ambiguous; preserves caller/workspace security; and passes the existing full verification/build/package gates without a material CLI or Desktop baseline performance regression.
