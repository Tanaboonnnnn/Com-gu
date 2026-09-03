# Chat workspace and header controls design

## Goal

Make ComGu's top bar expose the existing Multi-agent switch clearly, fix stale connection copy, and make filesystem/terminal authority an explicit per-ChatGPT-conversation choice instead of a global next-run choice.

## Header

Use this order:

`Update -> Sub-agent switch -> Language -> Theme -> Status -> Power`

The Sub-agent switch is the existing `config.multiAgent.enabled` setting, not a new state. Turning it off keeps the current safe behavior: pause live swarm execution, withdraw worker browser commands, preserve durable worker history, and remove the `agents` tool after the connector refresh boundary.

## Connection status

The header status text must always derive from the latest `ConnectionStatus.state` pushed by the main process and must be translated with the currently selected locale. A connected tunnel must not leave stale `Not connected` / `เนเธกเนเนเธ”เนเน€เธเธทเนเธญเธกเธ•เนเธญ` copy after state or locale changes.

## Per-chat workspace authority

Every ChatGPT conversation that uses filesystem or command tools must have an explicit user-selected WorkspaceScope. The selection is a set of already-approved root identities; the extension and renderer display root names only and never expose native paths.

No selected scope means filesystem/terminal operations fail closed with a user-actionable workspace-required error. Absolute paths do not bypass this rule.

Selections are keyed by exact proven ChatGPT conversation id. A chat may select multiple approved roots. Reducing scope is allowed immediately. Adding a root is an explicit user action only; model arguments never expand chat authority.

## Prime and workers

When a chat becomes Prime, that chat's WorkspaceScope becomes the immutable ceiling of the Run. Workers inherit the Prime scope by default and may be narrowed to a subset. No worker or model-provided spawn argument may add a root outside the Prime scope.

The authority chain is:

`Approved roots -> Chat workspace -> Prime run scope -> Worker scope`

## Extension UX

With the browser extension installed, show a compact workspace pill near the ChatGPT composer. Example: `Workspace: ComGu +2`. Clicking it opens a panel listing approved root names with multi-select checkboxes.

Without the extension, ComGu cannot safely infer a ChatGPT conversation id from the stateless connector. The first unidentified filesystem/terminal call therefore fails closed and opens an explicit Desktop fallback choice. The user must choose approved root names before unidentified file/terminal calls can run. This manual fallback is never inferred from the model, never exposes native paths, is non-durable, applies only while conversation identity is unavailable, and cannot authorize Prime/subagent creation. When exact extension identity returns, per-conversation scope takes precedence and the manual fallback is ignored.

The extension is presentation/input only. The app remains the authority that validates conversation identity, approved roots, scope changes, fallback activation, and tool execution.

## Persistence and continuity

Conversation workspace selections are durable app state keyed by conversation id. Compact & Resume transfers the selection from the old conversation to the new conversation in the same transaction family as session/workspace/swarm identity transfer.

Renaming an approved root changes display copy but does not silently rebind authority to a different path. Removing/re-adding a root with the same name must not resurrect old authority.

## Security invariants

- No native path picker or arbitrary path text field is exposed to the ChatGPT page.
- A model cannot grant itself a workspace.
- Unknown conversation identity cannot use chat-scoped file/command authority.
- No selection means no file/command authority.
- Worker scope is equal to or narrower than Prime scope.
- Existing Run scope remains immutable for its lifetime.
- Tool sessions tied to stale scope continue to fail closed.

## Tests

Cover renderer/header state, IPC validation, conversation-scope persistence, MCP file/command enforcement, Run/worker inheritance and subset enforcement, Compact & Resume transfer, bridge routes, extension navigation/DOM lifecycle, and stale/removed-root identity cases.

