# ComGu outbound data and egress policy

ComGu has no product analytics, advertising telemetry, crash-reporting service, webhook collector, or maintainer-owned telemetry endpoint. Runtime network access is limited to the product features below. Adding a new programmatic runtime destination requires updating this document and the security invariant test in the same change.

| Feature | Destination | Data category | Default |
| --- | --- | --- | --- |
| Update check | `api.github.com` / `Tanaboonnnnn/Com-gu` | app version + normal HTTP metadata | automatic, background |
| Extension recovery | `github.com/Tanaboonnnnn/Com-gu` release asset | browser navigation/download only | user action/recovery |
| OpenAI MCP tunnel | OpenAI `tunnel-client` control plane | MCP traffic + tunnel authentication | when connected |
| Cloudflare quick tunnel | Cloudflare | MCP traffic behind the connector's secret path | only when selected |
| Goal Mode | `openrouter.ai` | authored user messages + final assistant messages used by Goal | OFF by default |

## Local and browser-only traffic

The browser companion talks to the Desktop app only over fixed `127.0.0.1` bridge ports. The MCP server also binds loopback and uses secret paths. ChatGPT, OpenAI Platform, OpenAI developer documentation and OpenRouter settings URLs that appear in the renderer are user-facing navigation targets rather than background telemetry destinations.

The extension opens or focuses `chatgpt.com` / `chat.openai.com` pages as part of normal ChatGPT workflow control. Those browser navigations are distinct from app-managed analytics or data collection.

## Native tunnel trust boundary

OpenAI Secure MCP Tunnel and Cloudflare Quick Tunnel are implemented by pinned native tunnel binaries rather than hard-coded service hostnames in ComGu TypeScript. Their egress is therefore a binary trust boundary. Release packaging verifies pinned tunnel artifacts/checksums separately; this source-literal policy intentionally does not guess transient service hostnames owned by those binaries.

## Goal Mode privacy boundary

Goal Mode remains OFF by default. When enabled and configured with an OpenRouter key, ComGu sends the authored user messages and final assistant messages needed to decide the next Goal action to OpenRouter. Tool arguments, tool results and file contents are not deliberately added to that Goal request. Users should treat text already present in those messages as data leaving the machine when Goal Mode is enabled.

## Review rule

Any change that adds a programmatic runtime destination must, in the same change:

1. explain the destination and data category here;
2. update `test/security-invariants.test.ts` deliberately;
3. state whether the behavior is automatic, user-triggered or opt-in; and
4. preserve the existing loopback, workspace-scope, MXC and credential boundaries.

## v3.1.3 runtime verification

The Windows x64 v3.1.3 candidate was observed at runtime on 2026-09-07. Idle, extension-only, OpenAI tunnel and Goal/OpenRouter observations matched this policy; Cloudflare was not exercised. See docs/security/2026-09-07-v3.1.3-runtime-egress-verification.md for process ownership, endpoints and capture limitations.
