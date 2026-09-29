# ComGu — Feature Gap Spec & แผนงานพัฒนา (ฉบับละเอียด)

| | |
| --- | --- |
| **จัดทำโดย** | **เอเจนต์ Arena.ai (Agent Mode)** — ตรวจเทียบโค้ดกับ issues และเรียบเรียงเอกสารทั้งฉบับ |
| **เกี่ยวกับเอไอที่ทำ** | Arena.ai Agent Mode เป็นระบบที่ใช้โมเดลหลายตัวสลับกัน (เช่น Claude, ChatGPT, Gemini, Grok, Qwen, Kimi ฯลฯ) จึงไม่ระบุโมเดลที่อยู่ใต้ฮู้ดเจาะจง |
| **วันที่จัดทำ** | 2026-09-29 |
| **อ้างอิง** | commit `a3fe6f2` บนสาขา `arena/01a0eece-com-gu` |
| **สถานะเอกสาร** | แผนงาน (ยังไม่มีการแก้ไขโค้ดตามแผน) |

> **ทวนสอบวันที่ 2026-09-29** · อ้างอิงโค้ดจริงที่ commit `a3fe6f2` (branch `arena/01a0eece-com-gu`)
> ขอบเขต: open issues **#1–#7 ทั้งหมด** + โค้ดจริง + กิจกรรม GitHub ล่าสุด
>
> **เอกสารนี้เป็นแผนงานเท่านั้น — ยังไม่มีการแก้ไขโค้ดใด ๆ**
>
> ⚠️ **หมายเหตุเรื่องเลขเวอร์ชัน:** เลข release ที่ปล่อยจริง (3.1.x → 3.3.2) **ไม่ตรง**กับชื่อเวอร์ชันใน roadmap issues อีกต่อไป เพราะมีการเลือกแก้สิ่งที่อยากแก้เองระหว่างทางเยอะ เอกสารนี้จึง **ไม่ใช้เลขเวอร์ชันเป็นหลัก** แต่ใช้ **F-numbers (Feature IDs)** อ้างอิงแทน โดยแผนเวอร์ชันเดิม (#2–#7) ถูกใช้เป็น "รายการสเปกฟีเจอร์" เท่านั้น

---

## 0. วิธีตรวจสอบ (Methodology)

สิ่งที่ตรวจเทียบระหว่าง issue ↔ โค้ดจริง:

- **Source:** `src/main/**` (~40 โมดูล), `src/cli/**`, `extension/**` (content.js 9,027 บรรทัด, chatgpt-dom.js 1,474, fiber.js 1,266), `src/shared/**`
- **Test suite:** 127 ไฟล์ใน `test/` + `test/fixtures/`
- **Docs:** CHANGELOG (3.0.0 → 3.3.2), `docs/superpowers/plans|specs`, ADR, SECURITY.md
- **GitHub:** releases, tags, PRs #9–#28, issues #1–#7

**Legend:** ✅ = มีจริงใช้งานได้ · 🟡 = มีบางส่วน/ต่อยอดได้ · ❌ = ยังไม่มีบนโค้ดเลย

**หลักเกณฑ์ตัดสิน:** ถ้าฟีเจอร์ทำงานได้แม้รูปแบบต่างจากที่ issue เขียน → นับ ✅ (และบันทึกความต่างใน §4) · ถ้ามีแค่ชื่อ/คอมเมนต์/โครงที่ว่าง → ❌ · ถ้าทำงานได้บางกรณี → 🟡

---

## 1. Gap Matrix — ทุกบรรทัดในทุก Issue

### Issue #2 — Safe Workspace Runtime (เดิมชื่อ "3.1")

| ข้อใน issue | สถานะจริง | หลักฐานบนโค้ด |
| --- | --- | --- |
| Run + WorkspaceScope domain (RunId, primary/shared roots, binding ที่ Run ไม่ใช่ tab) | ✅ | `src/main/chat-workspace-scope.ts`, `test/run-scope.test.ts`, `test/chat-workspace-scope.test.ts` |
| Worker scope inheritance (narrow-only, ไม่มี API ขยาย scope) | ✅ | `agents.ts` `setNextRunWorkspaceScope` / `spawnWithWorkspaceScope`, `test/swarm.test.ts` |
| Workspace selection UX | ✅ (ต่างรูปแบบ) | แทนที่ด้วย **enabled-folder ON/OFF allowlist** หน้า Home (PR #18, 3.3.0) — เรียบง่ายกว่าที่ issue ออกแบบ |
| Hard terminal boundary (traversal/symlink/junction/UNC/nested shell/env/redirect/child cwd) | ✅ | `src/main/run/command-sandbox.ts`, `src/main/sandbox.ts`, MXC ProcessContainer, `test/terminal-workspace-security.test.ts`, `test/command-sandbox-contract.test.ts` |
| File/tool parity — authority เดียวใช้ร่วม file tools + terminal | ✅ | `enabledRoots()` ใน `config.ts` เป็น single authority |
| Workspace violation → fail closed + machine-readable error + localized copy | ✅ | ทั่วทั้ง `fsops.ts` / `tools-core.ts` / i18n catalog |
| System Health v1 (6 states × 7 components) | ✅ | `CanonicalHealthState`, `SystemHealthComponentId` ใน `shared/types.ts`, `test/health.test.ts` |
| Recovery Manager v1 (bounded retry, reversible ops only) | ✅ | `src/main/recovery.ts` — 4 operations + **authority fence** (RunId + scope fingerprint ตรวจก่อน/หลังทุก action) |
| Adversarial regression suite ครบ escape classes | 🟡 | ครอบคลุมหลักแล้ว (platform-specific tests มี) แต่ไม่มีหลักฐานว่า **ครบทุกบรรทัดใน test matrix ของ issue** — เคยมี audit docs (`docs/bug-audit-*`) แต่ไม่ได้ทำ acceptance checklist ปิดบัญชี |

**สิ่งที่ยังต้องทำ (เล็ก):** F-0a — เดิน checklist acceptance 11 ข้อของ #2 + test matrix 10 บรรทัด เติม test ที่ขาด (เช่น PowerShell provider path, env-expansion redirect target เฉพาะเคส) แล้วปิด issue

---

### Issue #3 — Durable Runs, Checkpoints & Restart Recovery (เดิมชื่อ "3.2")

| ข้อใน issue | สถานะจริง | หลักฐานบนโค้ด |
| --- | --- | --- |
| Persistent Run Store (RunId, status, scope, identities, goal, pending messages/reports, checkpoint) | 🟡 | `src/main/run/durable-run.ts` เก็บ `id/objective/owner/state/checkpoint/reason/lease/operation` — **ยังไม่มี** field: WorkspaceScope snapshot, worker identities[], browser preference, pending messages/reports แยกส่วน (ตอนนี้ฝังใน swarm snapshot/bridge คนละที่) |
| Run lifecycle (running/paused/interrupted/recovering/completed/failed) | 🟡 | `DurableRunState` = running/waiting/suspended/needs-reconciliation/completed/cancelled — ใกล้เคียงแต่ **ไม่มี `interrupted`/`recovering`** เป็นสถานะถาวร |
| Atomic durable persistence, ไม่ split-brain | ✅ | `durable.ts` write-ahead + `test/durable.test.ts` |
| Checkpoint เฉพาะ meaningful transitions + schema version | 🟡 | `checkpoint: string` เป็นข้อความอิสระ **ไม่ใช่ structured transition set** ตาม issue (Run started / scope changed / worker spawned / report queued / …) — schema version มี (`snapshot.version: 1`) |
| App/bridge restart recovery + UI `[Resume] [Inspect] [Discard]` | 🟡 | Goal runs recover ผ่าน `goal-durable-run.ts` + `bridge.ts` (`goalDurableRuns.recover()`) แต่ **ไม่มี UI เลือก Resume/Inspect/Discard แบบรวมศูนย์** — recover อัตโนมัติเฉพาะ goal run ที่ active |
| Safe reconciliation (browser/tab/conversation/report consume state) | 🟡 | `needs-reconciliation` กัน replay mutation แล้ว + conversation rebind ใน `continuation.ts` — แต่ไม่มี reconciliation checklist ครบชุดตาม issue |
| **Run Timeline แบบ structured** (machine-readable category, correlation/parent IDs, redacted metadata) | 🟡 | Session events ใน `shared/session.ts` มีหลาย kind + `ActivitySummary` + confidence grades (`agent/turn/generation/inferred`) — แต่ **ไม่มี Run Timeline รวมเหตุการณ์ orchestration** (spawn/wake/checkpoint/recovery decision) ที่อ่านเป็นเส้นเรื่องเดียว |
| **Diagnostic bundle export** (`versions/health/run/timeline/browser-state/logs` + redaction + privacy tests) | ❌ | `diagnostics.ts` เป็น **self-test chain 4  hops** ไม่ใช่ exportable bundle — ไม่มี code สร้างไฟล์ zip/json เหล่านี้เลย |
| Migration/versioning + fail-safe เมื่อ data เก่า/ใหม่เกิน | 🟡 | `migration.ts` มีสำหรับ config/session — durable run schema มี `version: 1` แต่ยังไม่มี migration path จริง |

**ฟีเจอร์ที่ต้องสร้างจาก issue นี้:** F-1 Diagnostic Bundle Export · F-2 Run Timeline · F-3 Run Store ขยาย field + lifecycle ครบ · F-4 Startup Run Discovery UI (ย้ายไปทำเต็มในชุด 4.0 ได้)

---

### Issue #4 — Multi-Agent Scheduler, Scope Inheritance & Task DAG (เดิมชื่อ "3.3")

| ข้อใน issue | สถานะจริง | หลักฐานบนโค้ด |
| --- | --- | --- |
| Worker scope inheritance durable ข้าม revival | ✅ | scope narrowing + revival ใน `agents.ts` |
| **Agent roles** (investigator/builder/tester/reviewer) | ❌ | ไม่มี concept ของ role เลย — grep ทั้ง repo ไม่เจอ |
| **Task DAG** (task ID, dependencies, states queued→blocked→ready→running→waiting_report→completed/failed/cancelled) | ❌ | คำว่า "task" ใน `agents.ts` หมายถึง **ข้อความสั่งงาน (`task: string` ใน SpawnInput)** เท่านั้น ไม่มี task object, dependency, หรือ state machine |
| User-controlled resource ceiling | 🟡 | `multiAgent.maxWorkers: 1–8` (`config.ts`) + `freeWorkerSlots()` — เป็น **static slot ceiling** ไม่ใช่ resource-aware |
| **Resource-aware queueing** (CPU/memory/process pressure → recommendation + hysteresis) | ❌ | ไม่มี |
| **Collision awareness** (สอง agent เขียน path เดียวกัน → warning แยกจาก permission) | ❌ | ไม่มี (grep "collision" เจอแค่คนละความหมาย) |
| **Optional execution strategies** (shared tree / isolated worktree / read-only) | ❌ | ไม่มี (และ roadmap ระบุว่าห้ามบังคับ worktree เป็น permission model) |
| Prime orchestration UX (task board: active/queued/blocked, blockers, warnings, reports) | ❌ | UI มีแค่ worker list + message/transfer — ไม่มี task view |
| Recovery interactions (queued/block durable, running→interrupted, no duplicate assignment) | 🟡 | swarm snapshot durable + dedupe wake แล้ว แต่ไม่มี task ให้ recover |

**ฟีเจอร์ที่ต้องสร้างจาก issue นี้ (ชุดใหญ่ F-5–F-11):** Task model+DAG · Roles · Resource-aware scheduler · Collision awareness · Execution strategies · Task Board UX · Scheduler recovery

---

### Issue #5 — ChatGPT Compatibility Layer & Safe Degradation (เดิมชื่อ "3.4")

| ข้อใน issue | สถานะจริง | หลักฐานบนโค้ด |
| --- | --- | --- |
| Central adapter boundary — selector อยู่ที่เดียว | 🟡 **ดีกว่าที่คิด** | `extension/chatgpt-dom.js` เป็น **single-selector-authority** อยู่แล้ว ("the only file allowed to contain a selector", ทุก fn fail-safe คืน empty) + `fiber.js` เป็น code ตัวเดียวที่รันใน page context พร้อม allowlist — แต่ **ฝั่งแอป (`agents.ts`/`bridge.ts`/`goal.ts`) ยังมี ChatGPT assumptions กระจายเอง** และไม่มี interface กลางแบบ `ChatGPTAdapter` ที่ issue วาดไว้ |
| **Runtime capability probe** (per-capability status/version/reason machine-readable) | ❌ | ไม่มี probe — มีแค่ degradation แบบเงียบ ("records nothing new") ไม่มีรายงานสถานะ capability กลับมา |
| **Feature capability dependencies** (feature X ต้องใช้ capability Y) | ❌ | ไม่มี declaration — ฟีเจอร์พังพร้อมกัน/ทำงานบน state ที่ไม่ proven ได้ |
| **Safe degradation policy** (approval unproven → ไม่ overwrite; generating unknown → ไม่ wake; identity ไม่แน่ → ไม่ auto-submit/revive) | 🟡 | มีพฤติกรรมป้องกันกระจัดกระจาย (เช่น ไม่แตะ native approval UI, ไม่ relabel row ที่ไม่แน่ใจ, inferred call ไม่เขียนทับ UI) แต่ **ไม่ใช่ policy engine ที่ประกาศและทดสอบได้** |
| **Compatibility eventing** (`chatgpt.compatibility.changed`, `capability.degraded/recovered`, `feature.disabled_due_to_capability`) | ❌ | ไม่มี event เหล่านี้ใน Health/Timeline |
| SPA resilience (conversation switch/new chat/history/tab restore/hidden tab/DOM replacement) | 🟡 | มี `navigationEpoch`, MutationObserver, register_document, cache ไม่ข้าม navigation — ทำงานจริง แต่ regression coverage ไม่ครบทุก scenario ใน list |
| **Regression fixture/harness** (idle/generating/pending tool/approval modal/hidden tab/missing selector/Fiber unavailable/…) | 🟡 | `test/content-script.test.ts` + `test/fiber.test.ts` สร้าง DOM fixture inline หลายสถานะ (tool relabel, folded rows, ambiguity) — แต่ **ไม่มี fixture ครอบสถานะ approval modal / composer replaced / Fiber unavailable / hidden tab ครบชุด** และไม่มี harness กลางใช้ร่วม |
| **Live compatibility smoke** (non-destructive probe เทียบ live/captured surface) | ❌ | ไม่มี |
| Overwrite permission bug คง regression coverage เสมอ | 🟡 | Overwrite logic มี (`content.js`) + คอมเมนต์ยืนยันว่าไม่แตะ approval UI — แต่ **ไม่มี test ชื่อตรง** pinning "unanswered connector/tool approval ต้องคง native + visible" |

**ฟีเจอร์ที่ต้องสร้างจาก issue นี้ (F-12–F-15):** Capability Probe · Feature Policy matrix · Compatibility eventing · Fixture harness ครบชุด + live smoke

---

### Issue #6 — Safe Autonomous Recovery & Action Replay Policy (เดิมชื่อ "3.5")

| ข้อใน issue | สถานะจริง | หลักฐานบนโค้ด |
| --- | --- | --- |
| **Action safety classification** (`READ_ONLY/IDEMPOTENT/RETRYABLE/AMBIGUOUS/DESTRUCTIVE` + UNKNOWN fallback) | 🟡 **มีจุดเริ่ม** | `DurableRunOperation.retry = 'read-only' \| 'receipt' \| 'mutation'` + `outcome = 'committed' \| 'unknown' \| 'already-applied' \| 'safe-to-retry'` ใน `durable-run.ts` — เป็น taxonomy 3 ชั้นแบบ run-operation ยังไม่ใช่ 5 คลาสตาม issue และยังไม่มี mapping จาก tool/command metadata |
| Recovery decision policy (retry auto / inspect / human / never) | 🟡 | `needs-reconciliation` = หยุดรอคน สำหรับ mutation ที่ไม่แน่ชัด — แต่ไม่มีตาราง policy ครบทุกคลาส + ไม่มี "inspect แล้ว retry" |
| **Action journal** (action ID, RunId/agent/task, class, evidence, retry count, recovery status — durable) | ❌ | ไม่มี ("journal" ที่เจอในโค้ดคือ browser/message journal คนละเรื่อง) |
| **Evidence-based reconciliation** (ตรวจ output/HEAD/registry/temp ก่อนตัดสินใจ) | ❌ | ไม่มี — ตอนนี้ `unknown` outcome ไปจบที่มนุษย์เสมอ ไม่พยายามหา evidence |
| **Human escalation UX** (ข้อความเฉพาะเจาะจง: action อะไร, state อะไร, ปุ่ม Inspect/Mark resolved/Retry after inspection) | ❌ | ไม่มี recovery decision UI — มีแค่ state `needs-reconciliation` ทั่วไป |
| Retry budgets / loop prevention (bounded, backoff, durable counters, no wake-loop) | 🟡 | `RecoveryManager` มี maxAttempts + backoff + `retry-budget-exhausted` แต่ **เฉพาะ 4 connectivity ops** — ยังไม่มี budget ต่อ action class + counter ทน restart |
| Policy visibility (timeline บอก class, เหตุผล retry/ไม่ retry, evidence ที่ตรวจ, retry count) | ❌ | ไม่มี |
| Security invariants ระหว่าง recovery (ไม่ขยาย scope/ไม่ downgrade constraint/ไม่ bypass approval UI/ไม่สลับ browser family/ไม่ replay destructive) | ✅ (เป็นแนวคิดที่วางไว้แล้ว) | authority fence ใน `recovery.ts` + หลัก fail-closed ทั่วไป — ต้องคงไว้ตอนสร้าง F-16–F-21 |
| Fault-injection test matrix (crash ทุกจุด + duplicate recovery + partial output) | 🟡 | มี crash-boundary tests บางส่วน (`durable-run.test.ts`, `mcp-shutdown`, `shutdown`) แต่ไม่ครบ matrix 9 บรรทัดของ issue |

**ฟีเจอร์ที่ต้องสร้างจาก issue นี้ (F-16–F-21):** Safety classification 5 คลาส · Action journal · Evidence reconciliation · Escalation UX · Retry budgets ระดับ action · Policy visibility

---

### Issue #7 — Reboot-Resilient Durable Agent Runtime (เดิมชื่อ "4.0")

| ข้อใน issue | สถานะจริง |
| --- | --- |
| 1. Startup Run discovery (enumerate incomplete runs, แยก interrupted vs ตั้งใจจบ) | ❌ |
| 2. Boot recovery coordinator (stages ตามลำดับ deterministic + idempotent) | ❌ |
| 3. Workspace/security restoration (scope validate ก่อน tool ทำงาน, ห้าม widen) | ❌ |
| 4. Service restoration ตาม dependency order (store→MCP→tunnel→bridge→extension→browser→agents) | 🟡 มี startup phases ใน `index.ts` แต่ไม่ใช่ recovery mode |
| 5. Browser/conversation restoration (proven affinity, ไม่ guess identity) | 🟡 มี rebind logic บางส่วน (`continuation.ts`) แต่ไม่ใช่ boot restore |
| 6. Prime recovery handshake (app-authored nudge ให้ inspect durable status) | ❌ |
| 7. Worker recovery (exact conversation → revive; missing → interrupted; replacement policy) | 🟡 revival มีในระดับ browser-reconnect แต่ไม่ข้าม OS reboot |
| 8. Pending report/message recovery (unread ไม่หาย, consume ไม่ซ้ำ, coalesced wake) | 🟡 idempotency ของ delivery มีในระดับ session — ยังไม่ test ข้าม reboot |
| 9. Interrupted action reconciliation ตาม 5 คลาส (installer/delete/commit ห้าม replay) | ❌ (รอ F-16) |
| 10. Scheduler recovery (DAG frontier, concurrency ceiling restore) | ❌ (รอ F-5) |
| 11. Recovery UX / timeline แบบ stage-by-stage | ❌ |
| 12. Launch-at-login ≠ auto-resume (แยก user control) | 🟡 launch-at-login มีแล้ว — แต่ไม่มี policy แยก "เปิดแอปตอนบูต" กับ "resume run อัตโนมัติ" |
| 13. E2E fault/reboot test harness (12 scenarios) | ❌ |
| 14. Upgrade/rollback durability (3.x → 4.0 schema migration + reboot test) | 🟡 migration infrastructure มี |

**หมายเหตุ:** ถูกต้องตาม dependency แล้วที่ #7 ยังว่าง — ต้องสร้าง F-5/F-16–F-21 ให้ครบก่อน แล้วค่อยทำชุด F-22–F-31

---

## 2. Feature Specs — ของที่ยังไม่มีจริง (สร้างอะไร อย่างไร ที่ไหน)

> เรียงตามลำดับที่แนะนำให้สร้าง ทุกฟีเจอร์มี **ที่มา / นิยามพฤติกรรม / จุดแตะโค้ด / ข้อห้าม / Acceptance**
> ขนาดงาน: **S** ≤ 2 วัน · **M** ≈ 3–7 วัน · **L** ≈ 1–3 สัปดาห์

---

### F-1 · Diagnostic Bundle Export — *M* · จาก issue #3 §6

**ทำไมต้องมี:** ตอนนี้ `diagnostics.ts` ตอบได้แค่ "ท่อลิงก์ไหนขาด" แบบสด ๆ แต่ไม่มีทาง export สถานะทั้งระบบให้คนอื่นช่วยดูบั๊กได้โดยไม่หลุด secret — และ issue ระบุเป็น release requirement ของ durable-run milestone

**สิ่งที่ต้องสร้าง:**
1. Command **Export diagnostic bundle** (ปุ่มในหน้า Diagnostics/Health + `comgu doctor --bundle` ฝั่ง CLI) สร้าง zip:
   ```
   versions.json      ← app/extension/node/os/arch + schema versions ทั้งหมด
   health.json        ← SystemHealthComponent[] + bridge/tunnel/secure-storage status
   run.json           ← durable run snapshots + swarm/agent states (ไม่มี conversation text)
   timeline.json      ← Run Timeline (F-2) ช่วงล่าสุดแบบ bounded
   browser-state.json ← browser family, conversation id hash, capability probe (F-12)
   recent-logs/       ← log แบบ rolling window (จำกัดขนาด)
   ```
2. **Redaction layer กลาง** (`src/main/diagnostics-bundle.ts`): ห้ามหลุด API keys, bearer tokens, credential blobs, env ที่อ่อนไหว, conversation content (ยกเว้น user opt-in), path home → แทนด้วย `~`
3. **Privacy regression tests** ใหม่ (`test/diagnostic-bundle.test.ts`): ป้อน state ที่มี secret จำลองทุกแบบ → assert ว่าไม่มี pattern หลุดรอดในผลลัพธ์ (สานต่อแนวทาง `verify-public-history.mjs`)

**จุดแตะโค้ด:** สร้าง `src/main/diagnostics-bundle.ts` ใหม่ · ต่อ `ipc.ts` + renderer · `src/cli/commands/doctor.ts` · ใช้ `readDurable`/session store เป็นแหล่งข้อมูล

**ข้อห้าม:** bundle ต้องสร้างได้ในโหมด read-only; ห้ามส่งออก network; ห้าม include session text โดย default (issue บังคับ)

**Acceptance:** export สำเร็จบน Win/mac/Linux · ผ่าน privacy tests ทุกเคส · เปิด zip แล้วไม่มี secret pattern เลย · ขนาด bounded (< ~20MB)

---

### F-2 · Run Timeline (structured orchestration events) — *M* · จาก issue #3 §5

**ทำไมต้องมี:** Session log ตอนนี้เล่า "แชตเกิดอะไร" แต่ไม่มีเส้นเรื่องเดียวที่เล่า "ระบบตัดสินใจอะไร" — F-21 (policy visibility) และ 4.0 recovery timeline ต้องใช้สิ่งนี้เป็นฐาน

**สิ่งที่ต้องสร้าง:**
1. Event schema กลาง (ต่อยอด `SessionEvent` ที่มี):
   ```ts
   interface RunTimelineEvent {
     id: string;                // stable event id
     runId: string | null;
     category: 'run' | 'agent' | 'tool' | 'report' | 'wake' | 'checkpoint'
             | 'recovery' | 'compat' | 'policy' | 'schedule';
     kind: string;              // เช่น 'worker_spawned', 'report_queued', 'action_retried'
     agentId?: string;          // prime/worker-N
     correlationId?: string;    // โยง tool call ↔ result ↔ report
     parentEventId?: string;
     time: number;
     display: { title: string; detail?: string; tone: 'neutral'|'good'|'bad'|'warn' };
     data?: Record<string, string | number | boolean>;  // machine-readable เท่านั้น ห้ามมี content
   }
   ```
2. Emitter ทุกจุดตัดสินใจ: spawn/retire/wake/checkpoint/recovery action/needs-reconciliation/scheduler decision (อนาคต) — coalesce เหตุการณ์ซ้ำกัน
3. Query/subscribe API ให้ renderer + diagnostic bundle + `comgu` CLI

**จุดแตะโค้ด:** สร้าง `src/main/run/timeline.ts` · emit จาก `agents.ts`, `bridge.ts`, `recovery.ts`, `run/*` · เก็บผ่าน `durable.ts` แบบ ring buffer · renderer Activity view แท็บใหม่

**ข้อห้าม:** ห้ามเกิน budget พื้นที่ (ring buffer กำหนดจำนวน); ห้ามเก็บ raw user/tool content; ทุก event ต้องระบุ runId หรือ explicit null

**Acceptance:** timeline อ่านย้อนหลังข้าม restart ได้ · ทุก recovery decision มี event อธิบายเหตุผล · correlation ID โยง tool call ↔ report ครบ

---

### F-3 · Run Store ขยาย + Run Lifecycle ครบ — *S–M* · จาก issue #3 §1–2

**สิ่งที่ต้องสร้าง:** ขยาย `DurableRunView` ให้ครบตาม issue: `workspaceScope` (snapshot), `agents[]` (identity + lifecycle), `browserPreference`, `goalRef`, `pendingReports[]`, `pendingMessages[]`, `lastCheckpoint: RunCheckpoint` (structured ไม่ใช่ string) + สถานะ `interrupted`/`recovering` ที่ persist ได้ · checkpoint types ตาม transition list ใน issue (10 ชนิด) + schema version 2 พร้อม migration จาก v1

**Acceptance:** ทุก field ใน issue §1 มีจริงใน snapshot · resume แล้ว scope เท่าเดิมทุกครั้ง · v1 data เปิดบน v2 ได้และ fail-safe เมื่อไม่เข้ากัน

---

### F-4 · Startup Run Discovery UI — *S* · จาก issue #3 §3 / #7 §1

**สิ่งที่ต้องสร้าง:** เมื่อเปิดแอปแล้วพบ incomplete run → dialog:

```
Recovered work
<objective>
Interrupted by system restart · Prime + 4 workers · last active 02:41
[Resume safely] [Inspect] [Leave paused]
```

แยก **ตั้งใจจบ/หยุดเอง** ออกจาก **ถูกขัดจังหวะ** — ห้าม auto-resume run ที่ user เคย discard/complete (issue #7 §1 บังคับ) · โยงกับ policy "auto-resume ต้องเป็น user setting แยกจาก launch-at-login" (F-30)

---

### F-5 · Task Model + Task DAG — *L* · ❤️ ฟีเจอร์ใหญ่แรก · จาก issue #4 §3

**ทำไมต้องมี:** นี่คือชิ้นที่หายไปใหญ่ที่สุดที่ทำให้ multi-agent ตอนนี้เป็นแค่ "เปิดแชตสั่งงานกัน" ไม่ใช่ orchestration และเป็น prerequisite ของ scheduler recovery (4.0) กับ action journal (task linkage)

**สิ่งที่ต้องสร้าง:**
1. **Task object** (durable, อยู่ใน Run store):
   ```ts
   interface RunTask {
     id: string; runId: string;
     title: string; spec: string;              // สิ่งที่ Prime เขียนสั่ง
     assignee: string | null;                  // agentId หรือ null = unassigned
     dependencies: string[];                   // task ids
     state: 'queued' | 'blocked' | 'ready' | 'running'
          | 'waiting_report' | 'completed' | 'failed' | 'cancelled';
     scopeSubset?: WorkspaceScopeView;         // ⊆ PrimeScope
     resultRefs: string[];                     // report/event ids
     retry: { attempts: number; lastError?: string };
     createdAt/updatedAt/startedAt/finishedAt;
   }
   ```
2. **Scheduler rules:** เริ่มเฉพาะ `ready` (dependency ครบ) · dependency failed → downstream `blocked` · task เดิมที่ค้างก่อน restart → `interrupted` (unknown) จนกว่า evidence จะบอกผล (ผูกกับ F-18 ตอนทำ 4.0)
3. **MCP/agents surface:** ให้ Prime สร้าง/ผูก/แก้ task ผ่าน tool (`agents` tool ขยาย หรือ tool ใหม่ `tasks`) — worker เห็นเฉพาะงานที่ assign
4. Dedupe: ทุก transition ต้อง idempotent (task id คงที่, ห้าม double-assign จาก wake ซ้ำ)

**จุดแตะโค้ด:** สร้าง `src/main/run/tasks.ts` · ต่อ `agents.ts` (spawn ผูก task) · `mcp/tools-core.ts` หรือ `mcp/kernel.ts` (tool surface) · `durable.ts` (persist) · renderer task view (F-11)

**ข้อห้าม:** task ไม่ใช่ permission — scope มาจาก Run/agent เสมอ · ห้าม scheduler เริ่มงานที่ dependency ไม่ครบ · ห้าม task assignment สร้าง worker เกิน ceiling

**Acceptance (จาก issue):** Prime ประกาศ dependency ได้ · DAG อยู่รอด restart · downstream ถูก block เมื่อ upstream fail · ไม่มี double-start จาก recovery event ซ้ำ

---

### F-6 · Agent Roles — *S* · จาก issue #4 §2

**สิ่งที่ต้องสร้าง:** field `role: 'investigator' | 'builder' | 'tester' | 'reviewer'` บน agent — ใช้เป็น **policy hint**: investigator/reviewer = read-heavy (mutation ต้องได้ grant ชัด), builder = scoped mutation ปกติ, tester = scoped commands · UI แสดง role badge + default preamble ปรับตาม role

**ข้อห้าม (issue ย้ำ):** role **ไม่ใช่** security boundary — WorkspaceScope ยังเป็น authority เดียว; ห้าม implement role เป็น scope override

---

### F-7 · Resource-Aware Scheduler & Queue — *M* · จาก issue #4 §4

**สิ่งที่ต้องสร้าง:**
1. Inputs: CPU pressure, available memory, จำนวน Electron/browser process, active tool executions, live workers, queue depth
2. Output: `recommendedWorkers ≤ maxWorkers` (user ceiling เด็ดขาด) + hysteresis (ห้าม oscillate — ใช้ threshold สองชั้น + cooldown)
3. Policy: **ห้ามฆ่า worker ที่ทำงานปลอดภัยอยู่** เพื่อตอบ transient recommendation · ทุก decision ลง F-2 timeline
4. แสดงใน UI: `Configured max 8 · Recommended now 3 · Running 3 · Queued 4`

**จุดแตะโค้ด:** สร้าง `src/main/run/resource-monitor.ts` · ต่อ `agents.ts` `freeWorkerSlots()` ให้ใช้ recommendation แทนนับสล็อตเปล่า · platform probes (`process` loadavg/os.freemem)

---

### F-8 · Collision Awareness — *M* · จาก issue #4 §5

**สิ่งที่ต้องสร้าง:** path-ownership ledger ต่อ run:
- บันทึก declared ownership (task ระบุ path/domain) + observed writes (จาก tool calls `apply_patch`/`write`/`exec` ที่แตะ path) + optional `git status/diff`
- เมื่อ ≥2 agents มี write interest ซ้อนกัน → **structured conflict warning ถึง Prime** (ไม่ block อัตโนมัติ — issue แยกให้ชัดว่า *collision ≠ permission*)
- แสดงใน Task Board + timeline event `schedule.collision_detected`

**ข้อห้าม:** ห้ามใช้ collision ตัดสิทธิ์การเข้าถึง (permission จัดการโดย WorkspaceScope เท่านั้น) · ห้าม ledger ใหญ่ไม่จำกัด (bounded, path granularity พอ)

---

### F-9 · Execution Strategies (optional) — *S* · จาก issue #4 §6

**สิ่งที่ต้องสร้าง:** strategy field ต่อ task: `shared-tree` (default) | `read-only` | `git-worktree` (เฉพา task ที่เหมาะ + repo รองรับ) — เลือกอัตโนมัติหรือ Prime สั่ง · worktree ต้องอยู่ใต้ root ที่อนุมัติแล้วเท่านั้น

**ข้อห้าม (issue เด็ดขาด):** worktree ห้ามเป็น requirement/permission model — โฟลเดอร์ที่ไม่ใช่ git ต้องใช้ shared-tree ได้ตามปกติ

---

### F-10 · Prime Orchestration UX (Task Board) — *M* · จาก issue #4 §7

**สิ่งที่ต้องสร้าง:** หน้า/แท็บ orchestration ในแชต Prime: คอลัมน์ queued/blocked/ready/running/waiting_report/completed/failed · การ์ด task แสดง assignee, role badge, blockers, scope subset, result link · banner collision warning + resource recommendation · แถว pending reports

**จุดแตะโค้ด:** `src/renderer/*` (chat.ts/main.ts) + i18n catalog ทั้ง en/th (มี style guide `docs/localization/thai-style.md`)

---

### F-11 · Scheduler Recovery Interaction — *M* · จาก issue #4 §8 (ทำเต็มตอน 4.0 ได้)

Queued/blocked คงเดิม · running → interrupted/unknown จนกว่า evidence จะบอกผล (ผูก F-18/F-23) · ห้าม duplicate assignment จาก recovery event · ceiling + narrowed scope คงข้าม restart

---

### F-12 · ChatGPT Capability Probe — *M* · จาก issue #5 §2

**ทำไมต้องมี:** PR #26 (project URL) เพิ่งพิสูจน์ว่า assumption เปลี่ยนเงียบ ๆ แล้วหลายฟีเจอร์พร้อมกัน — ต้องรู้ว่า "ตอนนี้ proven อะไรได้บ้าง" แบบ machine-readable

**สิ่งที่ต้องสร้าง:**
1. Probe ใน extension (ต่อยอด `chatgpt-dom.js` ที่เป็น single-selector authority อยู่แล้ว) รายงาน per capability:
   ```
   conversationIdentity / composer / turnState / generatingState /
   toolCallState / approvalState / fiberState / navigation
   → { status: 'healthy'|'degraded'|'unknown', reason: string, probeVersion: number }
   ```
2. Probe ตอน attach + เมื่อ SPA navigation/DOM  replacement เกิด + ตาม cadence แบบ coalesce (ห้าม log spam — issue บังคับ)
3. แสดงใน UI แบบ Health:
   ```
   ChatGPT compatibility
   Conversation       Healthy
   Composer           Healthy
   Turn detection     Healthy
   Approval controls  Healthy
   Fiber state        Degraded  (reason: ...)
   ```

**จุดแตะโค้ด:** `extension/chatgpt-dom.js` + `content.js` (probe fn) · `background.js` ส่งผ่าน bridge · `src/main/bridge.ts` รับเข้า health projection (`shared/types.ts` ขยาย component หรือ sub-health)

---

### F-13 · Feature Capability Policy & Safe Degradation — *M* · จาก issue #5 §3–4

**สิ่งที่ต้องสร้าง:**
1. Declaration กลาง:
   ```
   Compact & Resume → conversation + composer + turnState
   Goal loop        → composer + turnState
   Overwrite        → turnState + approvalState + toolCallState
   Worker wake      → conversation + composer + generatingState
   Auto-submit      → composer + conversationIdentity (explicit)
   ```
2. Policy engine: capability ขาด → **disable/degrade เฉพาะ feature นั้น** (ห้ามลากระบบทั้งก้อน) — เรียงลำดับ: คง native behavior → ห้าม accidental submit/overwrite → คง durable state → อธิบายผู้ใช้
3. Rules ตายตัวจาก issue: approval unproven → ไม่ overwrite; generating unknown → ไม่ wake; identity ไม่แน่ → ไม่ auto-submit/revive/compile; ห้าม cross-family browser fallback
4. **Regression test คู่บุญของ Overwrite bug**: unanswered connector/tool approval ต้องคง native + visible เสมอ (issue สั่ง "carry forward permanent coverage")

---

### F-14 · Compatibility Eventing — *S* · จาก issue #5 §5

Event เข้า F-2 timeline/Health: `chatgpt.compatibility.changed`, `chatgpt.capability.degraded/recovered`, `feature.disabled_due_to_capability` — coalesce ซ้ำ + severity mapping

---

### F-15 · Compatibility Fixture Harness + Live Smoke — *M* · จาก issue #5 §6–8

1. **Fixture harness กลาง** (ย้าย DOM fixtures จาก `content-script.test.ts` ให้เป็น reusable states): idle completed · generating · pending tool call · answered tool call · **approval modal** · hidden tab · missing selector · changed wrapper · Fiber unavailable · SPA conversation switch · composer replaced — ใช้ regression ทุกครั้งที่แตะ adapter
2. **Live smoke** (non-destructive): จับ snapshot หน้า ChatGPT จริง/captured แล้ววิ่ง probe เทียบ — รายงาน **capability drift** เท่านั้น ห้ามแตะเนื้อหาผู้ใช้
3. บังคับ architecture: `Adapter` (ถาม/สั่ง UI) ≠ `Capability Probe` (ตอนนี้ proven อะไร) ≠ `Feature Policy` (อนุญาตให้ทำไหม) แยก vrชั้นเสมอ

---

### F-16 · Action Safety Classification (5 คลาส) — *M* · จาก issue #6 §1–2 · **ต่อยอดของที่มี**

**สิ่งที่ต้องสร้าง:**
1. Canonical classes: `READ_ONLY | IDEMPOTENT | RETRYABLE | AMBIGUOUS | DESTRUCTIVE` (+ `UNKNOWN` fallback = ปฏิบัติเหมือน AMBIGUOUS)
2. **Mapping จาก structured metadata** (tool name + operation type) เป็นหลัก ไม่ใช่ regex คำสั่ง (issue บังคับ) — ตัวอย่าง mapping จาก issue:
   ```
   read/find/view_image        → READ_ONLY
   exec ที่รัน test/status     → RETRYABLE (ตรวจ output ก่อน)
   apply_patch (เขียนไฟล์)     → IDEMPOTENT/RETRYABLE ตาม evidence
   exec install/build/package  → AMBIGUOUS/RETRYABLE
   git commit/push, installer  → AMBIGUOUS
   delete/move, registry       → DESTRUCTIVE
   ```
3. **ย้าย `DurableRunOperation.retry` 3 ค่า → taxonomy ใหม่** (migration ภายใน schema v2 จาก F-3) — ของเดิม map: read-only→READ_ONLY, receipt→IDEMPOTENT, mutation→AMBIGUOUS/DESTRUCTIVE ตาม metadata

**ข้อห้าม:** ห้าม command-string regex เป็นแหล่งเดียวเมื่อมี tool metadata · ไม่รู้จัก = AMBIGUOUS เสมอ

---

### F-17 · Action Journal — *M* · จาก issue #6 §3

**สิ่งที่ต้องสร้าง:** record ต่อ mutation-capable action (durable):
```
actionId (correlation), runId, agentId, taskId (ผูก F-5),
class, operation summary (ไม่เก็บ secret/ข้อความผู้ใช้),
startedAt, evidence[] (exit code, output digest, path metadata),
outcome (committed/unknown/already-applied/safe-to-retry),
retryCount, recoveryStatus
```
- เขียน **ก่อน** expose continuation (ทำนองเดียวกับ DurableRun "persist before publication" ที่มีอยู่)
- bounded retention + ไม่มี plaintext secret (issue บังคับ)

**จุดแตะโค้ด:** สรู้ง `src/main/run/action-journal.ts` · hook จาก `mcp/tools-core.ts`/`unified-exec.ts`/`fsops.ts` · persist ผ่าน `durable.ts`

---

### F-18 · Evidence-Based Reconciliation — *L* · จาก issue #6 §4

**สิ่งที่ต้องสร้าง:** ก่อน retry `RETRYABLE/AMBIGUOUS` ต้อง inspect ภายนอกก่อนเสมอ:
- package output มี checksum ตรง → ไม่ rebuild
- git commit ถูกขัด → ตรวจ HEAD/status ก่อนตัดสินใจ
- installer ค้าง → ตรวจ installed version/registry/process
- file write ค้าง → ตรวจ target/temp/atomic-write state
- ผลการ inspect = evidence ลง journal + timeline → ตัดสินใจ retry / mark resolved / escalate

**ข้อห้าม:** ไม่มี evidence เพียงพอ = ถามมนุษย์ (F-19) — **ห้ามเดา**; recovery ห้ามขยาย scope/แตะ approval UI/สลับ browser family (invariant จาก issue §8)

---

### F-19 · Human Escalation UX — *S–M* · จาก issue #6 §5

**สิ่งที่ต้องสร้าง:** recovery decision dialog เฉพาะเจาะจง (ห้าม generic "something went wrong"):
```
Recovery paused
Previous action may have partially modified the system.
Automatic retry was not attempted.

Action: Windows installer
Last known state: interrupted

[Inspect] [Mark resolved] [Retry after inspection]
```
- ปุ่ม Inspect เปิด evidence view (journal entry + output digest) · ตัวเลือก + ผลตัดสินใจลง timeline · รองรับ i18n en/th

---

### F-20 · Retry Budgets & Loop Prevention (action-level) — *S* · จาก issue #6 §6

- budget ต่อ action/class + exponential backoff · counter **ทน restart** (อยู่ใน journal)
- ป้องกัน loop ข้ามระบบ: Prime wake + worker failure + reconnect cycle ห้ามวน (coalesce wake ซ้ำ — บางส่วนมีแล้วใน `agents.ts` ต้องรวมกับ journal counters)
- failure ซ้ำรูปเดิม → component/Run เข้า `degraded` + ขอคน (ห้าม retry ไม่รู้จบ)

---

### F-21 · Policy Visibility — *S* · จาก issue #6 §7

Timeline/ตัวช่วยแก้ปัญหาแสดง: action class · เหตุผลที่ retry/ไม่ retry · evidence ที่ตรวจ · retry count · เหตุผล escalation — แยก raw diagnostics ออกจาก copy ผู้ใช้ (issue บังคับ)

---

### F-22 · Boot Recovery Coordinator — *L* · จาก issue #7 §2 · **เริ่มหลัง F-5, F-16–F-21 พร้อม**

Stage machine ตาม issue (ทุก stage observable + retry-bounded + idempotent):
```
LOAD_RUN → VALIDATE_SCOPE → RESTORE_CORE_SERVICES → RESTORE_TUNNEL →
RESTORE_BROWSER_BRIDGE → PROBE_CHATGPT_COMPATIBILITY → RESOLVE_PRIME →
RESOLVE_WORKERS → RECONCILE_ACTIONS → DELIVER_PENDING_REPORTS → RESUME_SCHEDULER
```
- stage ใดพัง → degrade ชั้นที่ dependent โดย **ไม่ทำให้ durable state เสีย** (issue §4)

---

### F-23 · Scope Restoration & Validation (boot) — *M* · จาก issue #7 §3

Invariant ตายตัว (issue เขียนไว้ครบ ใช้เป็น test assertions ได้เลย):
```
RecoveredRunScope == last approved durable RunScope
Recovery may narrow/disable · may NEVER widen
WorkerScope ⊆ PrimeScope ⊆ RunScope
Terminal access ⊆ effective WorkspaceScope
root หาย/identity เปลี่ยน → pause/revalidate ห้ามแทน path กว้างกว่า
```
WorkspaceScope ต้อง loaded **ก่อน** recovered tool activity ใด ๆ — ต่อกับ `chat-workspace-scope.ts` + F-3 scope snapshot

---

### F-24 · Service Restoration Order — *M* · จาก issue #7 §4

Restore ตาม dependency: durable store → MCP surfaces → tunnel → browser bridge → extension → browser family/context → Prime/Worker conversation bindings · ทุกชั้น fail → degrade ชั้นถัดไปแบบตั้งใจ + รายงานใน F-28

---

### F-25 · Browser/Conversation Restoration — *M* · จาก issue #7 §5

- คง explicit/proven browser-family affinity (ห้าม cross-family fallback เมื่อ policy ห้าม)
- reopen conversation เฉพาะเมื่อ identity **proven** (ผูก F-12 probe) — resolve ไม่ได้ = pause agent + แสดง recovery state ไม่ใช่เดา
- ห้าม auto-submit/wake ถ้า capability probe จาก F-12 ไม่ผ่าน

---

### F-26 · Prime Recovery Handshake — *M* · จาก issue #7 §6

App-authored recovery nudge คงที่ (ไม่ใช่ข้อความอิสระ): บอกเฉพาะ durable facts — run recovered / workers recovered-failed-unresolved / pending reports count / interrupted actions / DAG frontier (ผูก F-5) · **ห้าม**แนบ raw worker report ใน URL หรือ transport field ที่ไม่ปลอดภัย (issue บังคับ)

---

### F-27 · Worker Recovery & Replacement Policy — *M* · จาก issue #7 §7

```
recovery exact conversation → reconnect/revive
missing/unresolvable       → mark interrupted/unresolved
terminal worker            → คงสถานะ ห้าม resurrect มั่ว
replacement worker         → สร้างได้ตาม task recovery policy ชัดเจน + ห้ามซ้ำ side effects/reports
```

---

### F-28 · Pending Report/Message Idempotent Delivery — *M* · จาก issue #7 §8

Durable inbox semantics ข้าม reboot: unread คง unread · consumed ห้าม redeliver · pending Prime wake coalesce · ห้าม wake loop หลัง restart · stable message IDs (ส่วนหนึ่งมีแล้วใน broker ของ `agents.ts` — ต้อง **proof + fault test ข้าม reboot**)

---

### F-29 · Boot Action Reconciliation — *M* · จาก issue #7 §9 · ใช้ F-16 policy ซ้ำ

ตารางเดียวกับ F-16 แต่ในบริบท boot: `READ_ONLY/IDEMPOTENT → retry ได้`, `RETRYABLE → inspect ก่อน`, `AMBIGUOUS → escalate`, `DESTRUCTIVE → ห้าม auto-replay เด็ดขาด` — ตัวอย่างที่ issue ระบุว่า **ห้าม replay แบบตาบอด**: installer, delete/move, registry, git commit/push, action ที่ side effects ไม่แน่ชัด

---

### F-30 · Scheduler/DAG Recovery (boot) — *M* · จาก issue #7 §10

blocked คง blocked · completed คง completed · queued/ready เดินต่อหลัง reconcile · running → interrupted/unknown จนกว่า evidence จะบอก · restore user ceiling **ก่อน** worker ใหม่เริ่ม

---

### F-31 · Recovery Timeline & Observatory — *M* · จาก issue #7 §11

แสดง recovery แบบ stage log (ตัวอย่างใน issue) + สถานะรวม 4 ระดับ: recovered / waiting for user / degraded / unrecoverable — ต่อบน F-2 timeline

---

### F-32 · Launch-at-login ≠ Auto-resume Policy — *S* · จาก issue #7 §12

แยกสอง concept ใน UI/settings: "เปิด ComGu ตอน login" กับ "resume interrupted runs อัตโนมัติ" — auto-resume เป็น opt-in แต่ **security reconciliation บังคับเสมอ** ไม่ว่าจะเลือกแบบไหน (issue บังคับ)

---

### F-33 · Reboot/Upgrade E2E Fault Harness — *L* · จาก issue #7 §13–14

1. Fault scenarios 12 ข้อของ issue (idle+pending report / retry-safe command / lost ack / ambiguous installer / destructive interrupted / browser หาย / extension reconnect / conversation หาย / worker terminal / multi-run เลือก resume / root หาย / corrupt checkpoint)
2. อย่างน้อย process-restart boundary injection ใน CI + real restart-style tests เมื่อ VM อำนวย
3. Release qualification: upgrade จาก 3.x ที่มี durable run + schema migration + reboot + rollback ไม่ทำลาย state เก่า

---

### F-0 · Housekeeping / Quick wins (ทำได้ทันที)

| งาน | รายละเอียด |
| --- | --- |
| **F-0a ปิดบัญชี #2** | เดิน acceptance 11 ข้อ + เติม test ที่ขาด → ปิด issue (ของจริงเสร็จแล้ว ~95%) |
| **F-0b ปล่อย v3.3.2 ที่หาย** | Tag `v3.3.2` มีแล้วแต่ **ไม่มี GitHub Release** → README ลิงก์ตาย (404), `latest` ยังเป็น 3.3.1, npm payload ชี้ไฟล์ที่ไม่มี → re-run `release.yml` จาก tag เดิม แล้วตรวจลิงก์ |
| **F-0c ปิด PR #21** | ถูก #22 แทนที่แล้ว |
| **F-0d Labels + Board** | ติด `enhancement`/`documentation` + บอร์ดตาม F-Group (ด้านล่าง) แทน milestone เวอร์ชัน |
| **F-0e Release guard ใน CI** | ทุก tag ต้องมี release + link checker กัน README 404 (บทเรียนจาก F-0b) |
| **F-0f macOS x64** | ตาราง README เว้น "—" เงียบ ๆ — อย่างน้อยอธิบายเหตุผล |

---

## 3. Dependency Graph & ลำดับสร้าง (ไม่ผูกเลขเวอร์ชัน)

```
กลุ่ม A — เก็บตก (ทำได้เลย)
  F-0a..F-0f  ·  F-1 (bundle)  ·  F-2 (timeline)  ·  F-3 (run store)
        │
กลุ่ม B — Orchestration (ฟีเจอร์ใหญ่)
  F-5 Task DAG ──→ F-6 Roles ──→ F-7 Resource scheduler ──→ F-8 Collision
        └────────→ F-9 Strategies ──→ F-10 Task Board ──→ F-11 Scheduler recovery
        │
กลุ่ม C — Browser Compatibility (ทำคู่ขนาน B ได้ ควรเร่ง)
  F-12 Capability Probe ──→ F-13 Feature Policy ──→ F-14 Events ──→ F-15 Fixtures+Smoke
        │
กลุ่ม D — Action Safety
  F-16 Classification ──→ F-17 Action Journal ──→ F-18 Evidence recon
                                              └─→ F-19 Escalation UX ──→ F-20/21
        │
กลุ่ม E — Reboot Runtime (ต้องรอ B+C+D ครบ)
  F-22 Coordinator ──→ F-23 Scope ──→ F-24 Services ──→ F-25 Browser
        ├─→ F-26 Prime handshake ──→ F-27 Workers ──→ F-28 Inbox
        ├─→ F-29 Boot recon (ใช้ F-16) ──→ F-30 Scheduler recovery (ใช้ F-5)
        ├─→ F-31 Recovery UX ──→ F-32 Policy split
        └─→ F-33 Fault harness + upgrade qualification
```

**ลำดับแนะนำ:** A (สัปดาห์นี้) → **B+C คู่ขนาน** (B คือของใหม่ที่ผู้ใช้เห็นชัดสุด, C คือเกราะกันพัง) → D → E

---

## 4. สิ่งที่โค้ดจริง "ทำต่างจาก/ดีกว่า" ที่ issue เขียน — อัปเดต mindset

1. **Enabled-folder allowlist (3.3.0)** แทน workspace picker ต่อแชต — ง่ายกว่าเดิมและ authority ชัดกว่า → F-5 ต้องอ้าง enabled roots ไม่ใช่ Primary/Shared
2. **`chatgpt-dom.js` เป็น single-selector authority อยู่แล้ว** — F-12/13 ไม่ต้องรื้อ extension ทั้งก้อน (strangler ตาม roadmap) เติม probe + policy รอบ ๆ ของเดิม
3. **`DurableRunOperation` taxonomy 3 ค่า** = รากของ F-16 — ย้าย/ขยาย ไม่ต้องเริ่มใหม่
4. **`RecoveryManager` มี authority fence + retry budget** ใน domain connectivity แล้ว — F-20 ใช้แบบแผนเดียวกันกับ action domain
5. **Session confidence grades (`agent/turn/generation/inferred`)** เป็นหลักฐานวัฒนธรรม "ไม่เดา" ของ repo — ยึดเป็นแนวทางเดียวกับ F-18/25

---

## 5. Release Gates ที่ต้องคงไว้ (จากทุก issue ห้ามละเมิด)

1. #2: terminal หลุด WorkspaceScope = security blocker ห้าม ship
2. #3: recovery ห้าม duplicate worker reports / ห้ามเสีย scope / ห้ามเรียก interrupted mutation ว่า success
3. #4: scheduler ห้ามเกิน ceiling / ห้าม duplicate worker / ห้าม widen WorkerScope
4. #5: ChatGPT state ที่ไม่ proven ห้ามทำให้ auto-submit, overwrite, แตะ approval UI, cross-conversation wake, cross-family fallback
5. #6: crash ต้องไม่ทำให้ destructive/ambiguous mutation ถูก replay เอง
6. #7: ห้ามเรียก 4.0 จนกว่า reboot recovery ผ่าน fault injection และพิสูจน์ว่า ambiguous/destructive ไม่ถูก replay

**Invariant รวม (ใช้เป็น test assertions ได้ทุกฟีเจอร์):**
```
WorkerScope ⊆ PrimeScope ⊆ RunScope
Compact/Recovery/Reboot ไม่เพิ่มสิทธิ์
DESTRUCTIVE ไม่ถูก replay เอง
fail closed เสมอเมื่อไม่พิสูจน์
```

---

## 6. Appendix — Evidence Map

| หัวข้อ | ไฟล์/หลักฐานที่ตรวจ |
| --- | --- |
| Workspace/scope | `src/main/chat-workspace-scope.ts`, `config.ts`, `test/run-scope.test.ts`, `test/workspace.test.ts`, `test/terminal-workspace-security.test.ts` |
| Command sandbox | `src/main/run/command-sandbox.ts`, `src/main/sandbox.ts`, `test/command-sandbox-contract.test.ts`, `test/sandbox.test.ts` |
| Durable run | `src/main/run/durable-run.ts`, `goal-durable-run.ts`, `src/main/durable.ts`, `test/durable*.test.ts` |
| Recovery v1 | `src/main/recovery.ts`, `test/recovery.test.ts` |
| Multi-agent | `src/main/agents.ts` (4,134 บรรทัด), `test/swarm.test.ts`, `test/agents.test.ts` |
| Session/timeline | `src/shared/session.ts`, `src/main/session/recorder.ts` (1,836 บรรทัด), `test/correlation.test.ts` |
| Extension/compat | `extension/chatgpt-dom.js`, `fiber.js`, `content.js`, `test/content-script.test.ts`, `test/fiber.test.ts` |
| Health | `src/shared/types.ts` (`CanonicalHealthState`, 7 components), `test/health.test.ts` |
| Diagnostics | `src/main/diagnostics.ts` (self-test เท่านั้น) |
| Release state | tags `v3.3.2` = `a3fe6f2`, releases: v3.3.1 = latest, PR #28 ล่าสุด (19 ก.ย.) |
