# ComGu 3.1.1 optimization results

This report records the final performance and footprint outcome for the ComGu 3.1.1 optimization plan. The abandoned zvec Smart Search experiment is not part of this result: zvec was fully reverted and ComGu keeps the original exact-search behavior (`find` when command execution is disabled, bundled `rg` through `exec_command` when command execution is enabled).

## Final retained design

The retained changes are deliberately packaging-focused:

- stage only the target MXC architecture instead of shipping both x64 and arm64 payloads;
- omit production `node-pty` PDB debug symbols;
- stage runtime-only `tree-sitter` / `tree-sitter-bash` files and only the target native prebuild;
- preserve broad ASAR unpacking for startup-sensitive native package families;
- keep tunnel, ripgrep, extension, Sharp, PTY, tree-sitter, MXC confinement and all supported release architectures intact;
- keep the startup import audit conservative: optional lazy-load candidates are documented, but no risky lifecycle rewrite was taken merely to remove bundler warnings.

The final `asarUnpack` families are `node-pty`, `@microsoft/mxc-sdk`, `sharp`, `@img`, `tree-sitter`, and `tree-sitter-bash`. Package-size reduction happens before electron-builder through target-specific staging rather than by forcing startup-sensitive JS and metadata back into compressed ASAR.

## Footprint

Baseline source: `docs/performance/2026-09-06-comgu-3.1.1-baseline.md`.

| Metric | Baseline | Final | Delta |
| --- | ---: | ---: | ---: |
| Installer | 165,216,786 B (157.56 MiB) | 155,606,016 B (148.40 MiB) | **-9,610,770 B (-5.82%)** |
| Unpacked directory | 569,896,707 B (543.50 MiB) | 517,031,191 B (493.08 MiB) | **-52,865,516 B (-9.28%)** |
| `resources/app.asar` | 14,488,120 B | 14,454,272 B | -33,848 B |
| `resources/app.asar.unpacked` | 115,251,004 B | 62,418,304 B | **-52,832,700 B (-45.84%)** |
| Other unpacked / extra resources | 440,157,583 B | 440,158,615 B | +1,032 B |
| `resources/tunnel/` | 60,362,394 B | 60,362,394 B | 0 B |

The Windows x64 final package contains only `@microsoft/mxc-sdk/bin/x64/` (38,383,717 B); the arm64 sibling is absent. The tunnel payload is intentionally unchanged because it remains supported runtime functionality.

## Startup and idle RSS

### Why narrow ASAR unpacking was rejected

An attempted Task 7 optimization moved native-package JS/metadata back into compressed ASAR and unpacked only binaries/prebuilds. It reduced unpacked bytes but materially hurt packaged startup:

| Build | Startup median |
| --- | ---: |
| Contemporaneous baseline package | 1,103 ms |
| Narrow-ASAR candidate | **1,415 ms** |
| Broad-ASAR restored, first startup-only confirmation | **1,075 ms** |

The narrow-ASAR candidate was therefore rejected. Broad package unpacking was restored while keeping the dead-payload staging reductions.

### Final measurement and environmental jitter

The historical accepted startup baseline was 958 ms, but it is not reproducible under the machine state used for the final verification. The same baseline package, rebuilt/retained in a detached worktree and measured contemporaneously, has ranged from 1,103 ms to 1,152 ms. Final-candidate repeated 10-launch medians also varied materially (1,061 ms, 1,240 ms), exceeding the plan's 10% repeatability threshold and proving environmental jitter.

The final 10-launch + 5 idle-RSS run recorded:

| Metric | Final |
| --- | ---: |
| Startup min / median / max | 1,064 / **1,229** / 1,456 ms |
| Idle RSS min / median / max | 37,507,072 / **135,770,112** / 147,091,456 B |

One RSS sample (37,507,072 B) is an obvious low outlier, but the median is unaffected. Relative to the original idle RSS baseline of 138,213,376 B, final median RSS is **2,443,264 B lower (-1.77%)**.

Because startup medians were noisy, the final decision uses an immediate paired A/B on the same machine state and package layout:

| Paired run | Startup median |
| --- | ---: |
| Baseline package | **1,152 ms** |
| Final optimized package | **1,213 ms** |
| Delta | **+61 ms (+5.3%)** |
| Allowed by plan | baseline + max(100 ms, 5%) = **1,252 ms** |

The paired final candidate is therefore inside the plan's hard startup allowance. This does not claim that ComGu became faster at startup; it establishes that the retained packaging set does not show a material startup regression once the current machine jitter is controlled by an immediate baseline comparison.

## MCP discovery and exact search

Final packaged benchmark, 5 warmups + 30 samples:

| Metric | Baseline | Final | Gate | Result |
| --- | ---: | ---: | ---: | --- |
| Core discovery p50 | 41.97 ms | 10.08 ms | <= 46.17 ms | PASS* |
| Core discovery p95 | 118.01 ms | 16.43 ms | <= 129.81 ms | PASS* |
| Exact search p50 | 74.77 ms | 79.98 ms | <= 82.24 ms | **PASS** |
| Exact search p95 | 107.79 ms | 96.59 ms | <= 118.57 ms | **PASS** |

\* The discovery benchmark client was replaced with the lightweight in-repo `scripts/mcp-http-client.mjs` after the previous script was found to import an undeclared `@modelcontextprotocol/client` dependency. Discovery numbers therefore are not presented as an application-level 4x speedup. Exact-search latency is the more directly comparable workload and stays within both hard gates.

## Packaged runtime verification

The Windows x64 packaged candidate has passed repeated real packaged-runtime smoke coverage for:

- Core MCP initialize + tool discovery;
- `read` and exact `find` behavior with command execution off;
- bundled `rg` through `exec_command` with command execution on;
- `apply_patch`;
- Sharp image decoding / `view_image`;
- PTY creation and interactive `write_stdin`;
- tree-sitter Bash parsing;
- MXC outside-root denial / workspace security;
- durable session recording;
- clean packaged startup/shutdown.

The packaging regression tests explicitly exercise MXC x64/arm64 target staging, node-pty runtime/PDB filtering, tree-sitter runtime-only staging, ASAR contracts and cross-platform electron-builder target declarations. The GitHub release matrix remains the final authority for native packaging on Windows x64/ARM64, macOS x64/ARM64 and Linux x64/ARM64.

## Startup import audit

The audit still reports several modules that participate in both static and dynamic import paths (`agents.ts`, `connection.ts`, `bridge.ts`, `browser.ts`). No production lifecycle change was made solely to silence those warnings. Any future lazy-loading work should be separately scoped and measured because these modules participate in identity, browser-bridge, connection and shutdown behavior.

## Candidate decisions

| Candidate | Decision | Reason |
| --- | --- | --- |
| Target-only MXC staging | KEEP | ~29.65 MB foreign Windows MXC payload removed from x64 package; runtime/security smoke passes |
| node-pty PDB removal | KEEP | Debug-only payload removed at staging; PTY runtime preserved |
| Runtime-only tree-sitter staging | KEEP | Compile/source and foreign-prebuild payload removed; parser/apply-patch smoke passes |
| Narrow native ASAR unpack | **REVERTED** | Startup median regressed to 1,415 ms vs 1,103 ms contemporaneous baseline |
| Broad native ASAR unpack + pruned staging | KEEP | Restores startup behavior while retaining ~50.4 MiB unpacked-size reduction |
| Opportunistic startup lifecycle rewrites | NOT TAKEN | No measured benefit justified changing security/identity-sensitive lifecycles |

## Recommendation

**RECOMMEND SHIP** - correctness/security regressions are not present in the targeted and packaged smoke coverage, final footprint is smaller by 9.16 MiB compressed and 50.42 MiB unpacked, idle RSS is not worse, exact-search latency passes its gates, and the immediate paired startup comparison stays within the plan's 100 ms allowance. Cross-platform release CI must still pass before the branch is merged or published.
