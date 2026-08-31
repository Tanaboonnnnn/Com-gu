# Thai Localization v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a polished English/Thai language switch to the Com-gu desktop app and companion Chrome extension, with the desktop app as the single locale authority and natural Thai copy aimed at Thai users.

**Architecture:** Store `locale: 'en' | 'th'` in the existing `config.ui` object so persistence, validation, renderer state, and settings-save concurrency keep using the current config pipeline. The Electron renderer gets a small typed i18n layer; the extension gets an equivalent plain-JavaScript layer because it intentionally has no build step. The existing bridge projects the locale through `/activity` and `/settings`, so ChatGPT-page UI follows the desktop setting without granting the browser any new write authority.

**Tech Stack:** TypeScript 7, Electron 43, electron-vite/Vite, Zod 4, Vitest 4, Chrome MV3 plain JavaScript, existing loopback browser bridge.

---

## Scope and invariants

This first localization pass is intentionally presentation/config only. Do not change MCP tool behavior, filesystem containment, command execution, identity/correlation, agent routing, tunnel authentication, or permission semantics.

The following are user-facing copy and should be localized when they appear in Com-gu UI:

- Desktop navigation, headings, labels, buttons, setup instructions, hints, known statuses, known warnings, permission descriptions, session/settings UI, Goal UI, and locally generated toast text.
- Extension popup labels/statuses/actions.
- Com-gu UI injected into ChatGPT by `extension/content.js`: activity rows, context meter copy, Goal/compaction settings, worker/status labels, and Com-gu-owned aria labels/tooltips.

The following are protocol/data and must **not** be translated:

- MCP tool names such as `read`, `view_image`, `apply_patch`, `exec_command`, `write_stdin`, `session`, `agents`, `observe`, and `computer`.
- Error/status codes exchanged between processes, such as `bad_request`, `stale_document`, `no_api_key`, and `worker_compaction_disabled`.
- API field names, connector ids, request ids, conversation ids, tunnel ids, model ids, URLs, filesystem paths, and command output.
- `NO_REPLY` and editable Goal prompt contents.
- ChatGPT DOM selectors and page-owned aria text in `extension/chatgpt-dom.js` and `extension/fiber.js`. Those strings describe ChatGPT's DOM, not Com-gu's UI; translating them can break observation.
- Raw third-party/OS error text for which the app has no stable semantic code. Keep it verbatim rather than guessing a Thai translation that could hide diagnostic information.

Thai copy uses a concise neutral app register: no `ครับ/ค่ะ` in controls or status text, no literal English-shaped translation when Thai wording can state the action more directly, and technical terms that Thai developers normally use in English stay in English. Examples: `API key`, `MCP`, `Tunnel`, `OpenRouter`, `Developer mode`, `ChatGPT`, and `Sub-agent`.

The locale selector should be visible in the top header, beside the theme control, rather than buried in an English-only setup page. Its options are language-independent labels `EN` and `ไทย`, so a Thai user can find the switch before understanding the rest of the interface.

---

### Task 1: Add the typed desktop i18n core

**Files:**
- Create: `src/shared/i18n/types.ts`
- Create: `src/shared/i18n/catalog.ts`
- Create: `src/shared/i18n/index.ts`
- Create: `src/renderer/i18n.ts`
- Create: `test/i18n.test.ts`

- [ ] **Step 1: Write the failing locale-core tests**

Create `test/i18n.test.ts` with the behavior contract first:

```ts
import { describe, expect, it } from 'vitest';
import { EN, TH, normalizeLocale, t } from '../src/shared/i18n/index.js';

describe('i18n', () => {
  it('accepts only supported persisted locales', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('th')).toBe('th');
    expect(normalizeLocale('TH')).toBe('en');
    expect(normalizeLocale('')).toBe('en');
    expect(normalizeLocale(null)).toBe('en');
  });

  it('keeps the Thai catalogue key-for-key with English', () => {
    expect(Object.keys(TH).sort()).toEqual(Object.keys(EN).sort());
  });

  it('interpolates named values without evaluating HTML', () => {
    expect(t('en', 'common.count', { count: 3 })).toBe('3 items');
    expect(t('th', 'common.count', { count: 3 })).toBe('3 รายการ');
    expect(t('th', 'common.named', { name: '<b>Core</b>' })).toBe('<b>Core</b>');
  });

  it('falls back to English when a runtime catalogue entry is unavailable', () => {
    expect(t('th', 'common.connect')).toBe('เชื่อมต่อ');
    expect(t('en', 'common.connect')).toBe('Connect');
  });
});
```

- [ ] **Step 2: Run the new test and confirm it fails before implementation**

Run:

```sh
npm test -- --run test/i18n.test.ts
```

Expected: FAIL because `src/shared/i18n/index.ts` does not exist yet.

- [ ] **Step 3: Add locale types and normalization**

Create `src/shared/i18n/types.ts`:

```ts
export const SUPPORTED_LOCALES = ['en', 'th'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export function normalizeLocale(value: unknown): Locale {
  return value === 'th' ? 'th' : 'en';
}
```

- [ ] **Step 4: Add the initial typed catalog and translator**

Create `src/shared/i18n/catalog.ts` with the first stable keys. These keys establish naming and interpolation; later tasks extend this same object rather than inventing a second translation API.

```ts
import type { Locale } from './types.js';

export const EN = {
  'common.connect': 'Connect',
  'common.disconnect': 'Disconnect',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.clear': 'Clear',
  'common.close': 'Close',
  'common.copy': 'Copy',
  'common.refresh': 'Refresh',
  'common.loading': 'Loading…',
  'common.count': '{count} items',
  'common.named': '{name}',
  'language.label': 'Language',
  'status.notConnected': 'Not connected',
  'status.connected': 'Connected',
  'status.offline': 'Offline',
  'home.permissions': 'Permissions',
  'home.folders': 'Folders',
  'home.health': 'Health',
  'home.activity': 'Activity',
  'home.runChecks': 'Run checks',
  'home.readOnly': 'Read-only'
} as const;

export type MessageKey = keyof typeof EN;

export const TH: Record<MessageKey, string> = {
  'common.connect': 'เชื่อมต่อ',
  'common.disconnect': 'ตัดการเชื่อมต่อ',
  'common.save': 'บันทึก',
  'common.cancel': 'ยกเลิก',
  'common.clear': 'ล้าง',
  'common.close': 'ปิด',
  'common.copy': 'คัดลอก',
  'common.refresh': 'รีเฟรช',
  'common.loading': 'กำลังโหลด…',
  'common.count': '{count} รายการ',
  'common.named': '{name}',
  'language.label': 'ภาษา',
  'status.notConnected': 'ยังไม่ได้เชื่อมต่อ',
  'status.connected': 'เชื่อมต่อแล้ว',
  'status.offline': 'ออฟไลน์',
  'home.permissions': 'สิทธิ์การเข้าถึง',
  'home.folders': 'โฟลเดอร์',
  'home.health': 'สถานะการเชื่อมต่อ',
  'home.activity': 'กิจกรรม',
  'home.runChecks': 'ตรวจสอบการเชื่อมต่อ',
  'home.readOnly': 'อ่านอย่างเดียว'
};

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { en: EN, th: TH };

export function translate(locale: Locale, key: MessageKey, values: Record<string, string | number> = {}): string {
  const template = CATALOGS[locale][key] ?? EN[key];
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  );
}
```

Create `src/shared/i18n/index.ts`:

```ts
export { EN, TH, translate as t } from './catalog.js';
export type { MessageKey } from './catalog.js';
export { SUPPORTED_LOCALES, normalizeLocale } from './types.js';
export type { Locale } from './types.js';
```

- [ ] **Step 5: Add the DOM-only translation helper**

Create `src/renderer/i18n.ts`:

```ts
import { t, type Locale, type MessageKey } from '../shared/i18n/index.js';

function keyOf(value: string | undefined): MessageKey | null {
  return value ? (value as MessageKey) : null;
}

export function applyStaticTranslations(root: ParentNode, locale: Locale): void {
  if (root instanceof Document) root.documentElement.lang = locale;

  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = keyOf(node.dataset.i18n);
    if (key) node.textContent = t(locale, key);
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const key = keyOf(node.dataset.i18nTitle);
    if (key) node.title = t(locale, key);
  }
  for (const node of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-placeholder]')) {
    const key = keyOf(node.dataset.i18nPlaceholder);
    if (key) node.placeholder = t(locale, key);
  }
}
```

Do not use `innerHTML` for translations. Translation values are text only; existing markup such as icons, `<code>`, and `<strong>` remains structural HTML owned by the template.

- [ ] **Step 6: Run the focused test**

Run:

```sh
npm test -- --run test/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the i18n primitive**

```sh
git add src/shared/i18n src/renderer/i18n.ts test/i18n.test.ts
git commit -m "feat: add localization core"
```

---

### Task 2: Persist locale through the existing config and settings-save pipeline

**Files:**
- Modify: `src/shared/types.ts:118-125`
- Modify: `src/main/config.ts:226-234, 323-337`
- Modify: `src/main/ipc.ts:79-138, 152-213`
- Modify: `src/renderer/main.ts:346-425`
- Test: `test/config.test.ts`
- Test: `test/ipc.test.ts`

- [ ] **Step 1: Add failing config migration tests**

Extend the existing `settings migration` block in `test/config.test.ts`:

```ts
it('defaults older configs with no locale to English without changing other UI prefs', async () => {
  const old = defaultConfig() as unknown as { ui: Record<string, unknown> } & Record<string, unknown>;
  const { locale: _locale, ...oldUi } = old.ui;
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify({ ...old, ui: oldUi }), 'utf8');

  const loaded = await loadConfig();
  expect(loaded.ui.locale).toBe('en');
  expect(loaded.ui.theme).toBe(defaultConfig().ui.theme);
});

it('preserves a stored Thai locale', async () => {
  await saveConfig({ ...defaultConfig(), ui: { ...defaultConfig().ui, locale: 'th' } });
  expect((await loadConfig()).ui.locale).toBe('th');
});
```

- [ ] **Step 2: Run the config test and verify the new assertions fail**

```sh
npm test -- --run test/config.test.ts
```

Expected: FAIL because `UiPrefs` has no `locale` and old configs do not gain one.

- [ ] **Step 3: Add locale to the shared config type and Zod schema**

In `src/shared/types.ts`, import the type and extend `UiPrefs`:

```ts
import type { Locale } from './i18n/types.js';

export interface UiPrefs {
  minimizeToTray: boolean;
  autoConnect: boolean;
  privacyScreenshots: boolean;
  theme: 'light' | 'dark';
  locale: Locale;
}
```

In `src/main/config.ts`, extend the existing `ui` schema without rejecting pre-localization config files:

```ts
ui: z.object({
  minimizeToTray: z.boolean(),
  autoConnect: z.boolean(),
  privacyScreenshots: z.boolean().optional().default(false),
  theme: z.enum(['light', 'dark']).optional().default('dark'),
  locale: z.enum(['en', 'th']).optional().default('en').catch('en')
}),
```

And change the `defaultConfig()` UI object to:

```ts
ui: {
  minimizeToTray: true,
  autoConnect: false,
  privacyScreenshots: false,
  theme: 'dark',
  locale: 'en'
},
```

An invalid hand-edited locale falls back to English instead of forcing the entire config through conservative recovery. Locale is presentation only and must never cause permission settings to be discarded.

- [ ] **Step 4: Add failing settings-merge coverage**

In `test/ipc.test.ts`, beside the current theme three-way-merge tests, add:

```ts
it('saves locale through the normal three-way settings merge', async () => {
  const base = defaultConfig();
  await saveConfig(base);
  const wanted = { ...base, ui: { ...base.ui, locale: 'th' as const } };

  const reply = await saveSettings(wanted, base);

  expect(reply.ok).toBe(true);
  expect(getConfig().ui.locale).toBe('th');
});

it('does not overwrite a newer locale when an unrelated stale settings snapshot is saved', async () => {
  const stale = defaultConfig();
  await saveConfig({ ...stale, ui: { ...stale.ui, locale: 'th' } });
  const unrelated = { ...stale, ui: { ...stale.ui, theme: 'light' as const } };

  await saveSettings(unrelated, stale);

  expect(getConfig().ui.locale).toBe('th');
  expect(getConfig().ui.theme).toBe('light');
});
```

- [ ] **Step 5: Extend the validated IPC settings snapshot and merge**

In `src/main/ipc.ts`, add locale to the existing `ui` Zod object:

```ts
ui: z.object({
  minimizeToTray: z.boolean(),
  autoConnect: z.boolean(),
  privacyScreenshots: z.boolean(),
  theme: z.enum(['light', 'dark']),
  locale: z.enum(['en', 'th'])
}),
```

Then add locale to the `mergeSettings()` UI object:

```ts
ui: {
  minimizeToTray: pick(current.ui.minimizeToTray, base.ui.minimizeToTray, wanted.ui.minimizeToTray),
  autoConnect: pick(current.ui.autoConnect, base.ui.autoConnect, wanted.ui.autoConnect),
  privacyScreenshots: pick(
    current.ui.privacyScreenshots,
    base.ui.privacyScreenshots,
    wanted.ui.privacyScreenshots
  ),
  theme: pick(current.ui.theme, base.ui.theme, wanted.ui.theme),
  locale: pick(current.ui.locale, base.ui.locale, wanted.ui.locale)
},
```

`src/preload/index.ts` needs no new IPC channel because `SettingsPatch['ui']` already aliases `Config['ui']`.

- [ ] **Step 6: Ensure renderer snapshots carry the locale instead of dropping it**

When Task 3 adds `#localeSelect`, the renderer's `save()` UI object becomes:

```ts
ui: {
  autoConnect: $<HTMLInputElement>('autoConnect').checked,
  minimizeToTray: $<HTMLInputElement>('minimizeToTray').checked,
  privacyScreenshots: $<HTMLInputElement>('privacyScreenshots').checked,
  theme: over.theme ?? previous.ui.theme,
  locale: $<HTMLSelectElement>('localeSelect').value === 'th' ? 'th' : 'en'
},
```

The `base` snapshot in `saveSnapshot()` already copies `previous.ui`, so no separate field is needed there.

- [ ] **Step 7: Run the focused config and IPC suites**

```sh
npm test -- --run test/config.test.ts test/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit locale persistence**

```sh
git add src/shared/types.ts src/main/config.ts src/main/ipc.ts src/renderer/main.ts test/config.test.ts test/ipc.test.ts
git commit -m "feat: persist interface language"
```

---

### Task 3: Add the visible desktop language switch and live re-rendering

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/chat.ts`
- Modify: `src/renderer/styles.css`
- Test: `test/renderer-state.test.ts`
- Test: `test/renderer-layout.test.ts`

- [ ] **Step 1: Add a failing renderer-state test for immediate locale switching**

Extend the existing renderer state harness so it creates a state with `config.ui.locale = 'th'`, applies it, then asserts the document language and representative dynamic labels change. The assertions should be exactly:

```ts
expect(document.documentElement.lang).toBe('th');
expect(document.querySelector('#connectLabel')?.textContent).toBe('เชื่อมต่อ');
expect(document.querySelector('#runChecksLabel')?.textContent).toBe('ตรวจสอบการเชื่อมต่อ');
expect((document.querySelector('#localeSelect') as HTMLSelectElement).value).toBe('th');
```

Then apply an English state and assert:

```ts
expect(document.documentElement.lang).toBe('en');
expect(document.querySelector('#connectLabel')?.textContent).toBe('Connect');
```

- [ ] **Step 2: Run the renderer-state test and confirm it fails**

```sh
npm test -- --run test/renderer-state.test.ts
```

Expected: FAIL because no locale control/translation pass exists.

- [ ] **Step 3: Add the header language selector**

In `src/renderer/index.html`, place this immediately before `#themeBtn`:

```html
<label class="locale-control" for="localeSelect">
  <span class="sr-only" data-i18n="language.label">Language</span>
  <select id="localeSelect" aria-label="Language">
    <option value="en">EN</option>
    <option value="th">ไทย</option>
  </select>
</label>
```

Use the existing visual language of header controls: compact height, same border/background tokens as `.btn`, and no custom color constants. Add an `.sr-only` utility only if the stylesheet does not already have an equivalent visually-hidden class.

- [ ] **Step 4: Wire locale into `apply()` before any user-facing text is painted**

At the top of `src/renderer/main.ts`, import:

```ts
import { applyStaticTranslations } from './i18n.js';
import { t, type Locale } from '../shared/i18n/index.js';
```

In `apply(next)`, immediately after `state = next` / before rendering labels:

```ts
const locale = next.config.ui.locale;
applyStaticTranslations(document, locale);
applyValue(
  $<HTMLSelectElement>('localeSelect'),
  locale,
  previousState?.config.ui.locale
);
```

Add one small helper for dynamic text so every call names the locale explicitly:

```ts
function tr(key: Parameters<typeof t>[1], values?: Record<string, string | number>): string {
  return t(state?.config.ui.locale ?? 'en', key, values);
}
```

Do not keep a second mutable locale variable outside `state`; renderer state remains authoritative.

- [ ] **Step 5: Make the selector save through the existing serialized settings queue**

Register beside the existing theme handler:

```ts
$<HTMLSelectElement>('localeSelect').addEventListener('change', () => {
  void save();
});
```

Because `save()` is already serialized and three-way merged, rapid theme/language clicks cannot race each other into stale config.

- [ ] **Step 6: Convert representative static HTML to keyed text without destroying markup**

Use `data-i18n` only on elements whose complete `textContent` is translatable. For example:

```html
<span id="liveState" data-i18n="status.notConnected">Not connected</span>
<span id="connectLabel" data-i18n="common.connect">Connect</span>
<span data-i18n="home.permissions">Permissions</span>
<span data-i18n="home.folders">Folders</span>
<span data-i18n="home.health">Health</span>
<span id="runChecksLabel" data-i18n="home.runChecks">Run checks</span>
```

For mixed markup (`text + <strong>/<code> + text`), leave the structure intact and translate the fragments from renderer code with the existing `frag()` helper or split text into child spans carrying their own keys. Never put translated HTML into a catalog entry.

- [ ] **Step 7: Convert dynamic Desktop strings to `tr()` calls**

Replace deterministic UI English in these current owners:

- `buildGroups()` and `paintGroups()` — group names, descriptions, permission counts, session/agent surface descriptions.
- `STATUS_TEXT` and `METHOD_HINT` — convert them from English value maps to message-key maps.
- `apply()` — theme tooltip, tunnel/setup state, Connect/Disconnect, API-key state, setup instructions, extension/bridge states.
- `facts()`, `paintRoots()`, diagnostics UI, known toast messages, and button busy states.
- `chat.ts` — session empty/title states, timeline/handoff labels, Goal/OpenRouter UI, compaction hints, bridge messages, worker labels.

Use structured values for counts rather than English plural concatenation. For example, replace:

```ts
`${on.length} permission${on.length === 1 ? '' : 's'}`
```

with a key/value call such as:

```ts
t(locale, 'permissions.enabledCount', { count: on.length })
```

and give Thai a single natural form (`เปิดอยู่ {count} สิทธิ์`) instead of importing English plural grammar.

For `chat.ts`, derive locale from the `AppState` already passed to `chatApply()`; do not create a separate setting or preload call.

- [ ] **Step 8: Run renderer tests**

```sh
npm test -- --run test/renderer-state.test.ts test/renderer-layout.test.ts test/renderer-html.test.ts
```

Expected: PASS, including existing dirty-field/generation guards.

- [ ] **Step 9: Commit the desktop switch and rendering pipeline**

```sh
git add src/renderer src/shared/i18n test/renderer-state.test.ts test/renderer-layout.test.ts
git commit -m "feat: switch desktop interface language"
```

---

### Task 4: Complete and review the Thai desktop catalogue

**Files:**
- Modify: `src/shared/i18n/catalog.ts`
- Create: `docs/localization/thai-style.md`
- Test: `test/i18n.test.ts`

- [ ] **Step 1: Add a fixed glossary and writing contract before translating the remaining strings**

Create `docs/localization/thai-style.md` with these decisions:

```md
# แนวทางภาษาไทยของ Com-gu

ข้อความในแอปใช้ภาษาไทยแบบกระชับ เป็นกลาง และอ่านแล้วรู้ทันทีว่าปุ่มหรือสถานะนั้นทำอะไร
ไม่เติม ครับ/ค่ะ ในเมนู ปุ่ม หรือข้อความสถานะ และไม่แปลศัพท์เทคนิคจนคนใช้งานจริงอ่านยากกว่าเดิม

## คำที่ใช้เหมือนกันทั้งแอป

| English | ไทยที่ใช้ | หมายเหตุ |
| --- | --- | --- |
| Connect | เชื่อมต่อ | ใช้กับการเริ่มเชื่อมต่อ |
| Disconnect | ตัดการเชื่อมต่อ | ไม่ใช้ "ยกเลิกการเชื่อมต่อ" กับสถานะที่เชื่อมต่ออยู่แล้ว |
| Run checks | ตรวจสอบการเชื่อมต่อ | บอกสิ่งที่ผู้ใช้กำลังตรวจจริง |
| Read-only | อ่านอย่างเดียว | สั้นและตรงกับความหมายของโหมด |
| Permissions | สิทธิ์การเข้าถึง | ชัดกว่าคำว่า "สิทธิ์" เดี่ยว ๆ |
| Pick a folder to share | เลือกโฟลเดอร์ที่อนุญาตให้ ChatGPT ใช้งาน | ไม่ใช้ "แชร์" เพราะไม่ได้แชร์ให้บุคคลอื่น |
| Session recording | บันทึกการสนทนา | ใช้กับฟีเจอร์ ไม่ใช่ชื่อ tool `session` |
| Keep recordings | เก็บประวัติไว้ | ตัวเลขด้านขวาระบุจำนวนวันอยู่แล้ว |
| Compact automatically | ย่อบริบทอัตโนมัติ | Compact & Resume เป็นชื่อฟีเจอร์ได้ แต่คำอธิบายควรอ่านเป็นไทย |
| Goal | Goal | ชื่อฟีเจอร์คงเดิม แล้วอธิบายหน้าที่เป็นไทย |
| Sub-agent | Sub-agent | คงศัพท์เทคนิค |
| API key | API key | ไม่ใช้ "กุญแจ API" |
| Tunnel | Tunnel | คงศัพท์เทคนิค |
| Developer mode | Developer mode | ตรงกับชื่อเมนูใน ChatGPT |

## ห้ามแปล

ชื่อ MCP tools, error codes, API fields, model ids, request/conversation ids, `NO_REPLY`, URL,
path, command output และ selector/aria text ที่ใช้ตรวจ DOM ของ ChatGPT
```

- [ ] **Step 2: Extend `EN` first, then require `TH` to match it at compile/test time**

Organize keys by visible surface using stable semantic prefixes:

```text
common.*
language.*
status.*
nav.*
home.*
permissions.*
folders.*
health.*
activity.*
setup.*
chat.*
sessions.*
compaction.*
goal.*
agents.*
errors.*
```

Every deterministic string removed from `index.html`, `main.ts`, or `chat.ts` gets exactly one English source entry. Reuse a key only when the English and Thai meaning are genuinely the same action; do not reuse `common.close` for “Disconnect”, for example.

- [ ] **Step 3: Translate the Thai catalogue in reviewable chunks**

Do not run one giant Thai audit over a >1000-word catalog. Split the editorial pass into these chunks so `kode-thai` can inspect each surface deeply:

1. Home + permissions + folders + health.
2. Setup + connection/tunnel/security warnings.
3. Chat + session + compaction.
4. Goal + Sub-agent.

For each chunk use this exact quality sequence:

1. Draft/localize for meaning, not word order.
2. Run `kode-thai` audit/fix loops until the chunk returns `CLEAN`.
3. Run `humanizer` on the resulting Thai to catch stiff, repetitive, or translation-shaped UI prose.
4. Run one final `kode-thai` audit after the humanizer edit; stop only when it is `CLEAN` again.

Security copy must retain every operative fact. For example, the command permission must still say that commands run as the logged-in user and are **not** limited to approved folders; do not shorten that into a reassuring but false label.

- [ ] **Step 4: Add catalogue safety assertions**

Extend `test/i18n.test.ts`:

```ts
it('does not translate protocol literals through UI copy', () => {
  const thai = Object.values(TH).join('\n');
  expect(thai).toContain('ChatGPT');
  expect(thai).toContain('API key');
  expect(thai).toContain('Developer mode');
});

it('keeps security-sensitive command wording explicit in Thai', () => {
  expect(TH['permissions.command.detail']).toContain('ไม่ได้จำกัดอยู่แค่โฟลเดอร์ที่อนุญาต');
});
```

Use the exact final key `permissions.command.detail` when moving the existing command detail into the catalogue.

- [ ] **Step 5: Run the i18n and renderer suites**

```sh
npm test -- --run test/i18n.test.ts test/renderer-state.test.ts test/renderer-layout.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the reviewed Desktop Thai copy**

```sh
git add src/shared/i18n/catalog.ts docs/localization/thai-style.md test/i18n.test.ts
git commit -m "feat: localize desktop interface in Thai"
```

---

### Task 5: Project the desktop locale through the existing browser bridge

**Files:**
- Modify: `src/main/bridge.ts:1817-1833, 3166-3182`
- Modify: `extension/background.js:2067-2078, 2188-2226`
- Test: `test/bridge.test.ts`
- Test: `test/extension.test.ts`

- [ ] **Step 1: Write the failing bridge test**

Beside the existing `GET /settings` tests in `test/bridge.test.ts`, add:

```ts
it('projects the desktop locale through settings and activity context', async () => {
  await saveConfig({
    ...defaultConfig(),
    sessions: { ...defaultConfig().sessions, record: true },
    ui: { ...defaultConfig().ui, locale: 'th' }
  });

  const settings = await request('GET', '/settings');
  expect(settings.status).toBe(200);
  expect(settings.body.context.locale).toBe('th');
});
```

Also extend an existing `/activity` context assertion to include:

```ts
expect(activity.body.context.locale).toBe('th');
```

- [ ] **Step 2: Run the bridge test and verify it fails**

```sh
npm test -- --run test/bridge.test.ts
```

Expected: FAIL because `contextView()` currently exposes only `auto`, `threshold`, `warn`, and `limit`.

- [ ] **Step 3: Add locale to the existing read-only context projection**

Change `contextView()` in `src/main/bridge.ts` to:

```ts
function contextView(autoAllowed = true): {
  auto: boolean;
  threshold: number;
  warn: number;
  limit: number;
  locale: 'en' | 'th';
} {
  const config = getConfig();
  return {
    auto: autoAllowed && config.compaction.auto,
    threshold: config.compaction.autoTokens,
    warn: config.sessions.advisoryTokens,
    limit: config.sessions.limitTokens,
    locale: config.ui.locale
  };
}
```

Do not add locale to `/settings` POST. The browser follows the desktop setting; it does not own it.

- [ ] **Step 4: Give the extension popup a read-only locale path without weakening document ownership**

Do **not** remove `settings_get` from the `owned` set. Content-script requests still need exact document ownership because that route is part of the composer state flow.

Instead add a separate non-owned background handler:

```js
async locale_get() {
  await load();
  const result = await call('/settings', { method: 'GET' });
  if (!result || result.ok !== true) return result;
  const locale = result.data && result.data.context && result.data.context.locale === 'th' ? 'th' : 'en';
  return { ok: true, locale };
},
```

Do not add `locale_get` to the `owned` set around the runtime message listener. It is read-only, global presentation state for an extension-owned popup, and it exposes no secrets or machine capability.

- [ ] **Step 5: Add an extension test proving popup locale reads do not require ChatGPT document ownership**

In `test/extension.test.ts`, add a background-handler test that sends `locale_get` from an extension-page sender and stubs `/settings` to return `{ context: { locale: 'th' } }`. Assert:

```ts
expect(reply).toEqual({ ok: true, locale: 'th' });
```

Also assert the request is `GET /settings` and that no `/settings` POST is made.

- [ ] **Step 6: Run bridge + extension tests**

```sh
npm test -- --run test/bridge.test.ts test/extension.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit locale projection**

```sh
git add src/main/bridge.ts extension/background.js test/bridge.test.ts test/extension.test.ts
git commit -m "feat: sync locale to browser companion"
```

---

### Task 6: Add the extension i18n runtime and localize the popup

**Files:**
- Create: `extension/i18n.js`
- Modify: `extension/manifest.json`
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`
- Modify: `test/extension.test.ts`

- [ ] **Step 1: Add failing manifest/popup localization tests**

Extend `test/extension.test.ts` with static checks:

```ts
it('loads the extension i18n runtime before content and popup code', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  expect(manifest.content_scripts[0].js.slice(0, 3)).toEqual(['i18n.js', 'chatgpt-dom.js', 'content.js']);

  const popup = await fs.readFile(path.join(dir, 'popup.html'), 'utf8');
  expect(popup.indexOf('src="i18n.js"')).toBeGreaterThan(-1);
  expect(popup.indexOf('src="i18n.js"')).toBeLessThan(popup.indexOf('src="popup.js"'));
});
```

Add a VM test for the runtime itself:

```ts
it('translates extension UI with English fallback', async () => {
  const source = await fs.readFile(path.join(dir, 'i18n.js'), 'utf8');
  const context = vm.createContext({ globalThis: {} });
  vm.runInContext(source, context, { filename: 'i18n.js' });
  const i18n = (context.globalThis as any).CLF_I18N;
  expect(i18n.t('th', 'popup.sessionCapture')).toBe('บันทึกการสนทนา');
  expect(i18n.t('en', 'popup.sessionCapture')).toBe('Session capture');
});
```

- [ ] **Step 2: Run the extension suite and confirm the tests fail**

```sh
npm test -- --run test/extension.test.ts
```

Expected: FAIL because `extension/i18n.js` is not present/loaded.

- [ ] **Step 3: Create a plain-JS extension translation runtime**

Create `extension/i18n.js` as a classic script so both popup and isolated content script can use it with no bundler:

```js
(() => {
  const EN = {
    'popup.lookingForApp': 'Looking for the app',
    'popup.sessionCapture': 'Session capture',
    'popup.chatgptTab': 'ChatGPT tab',
    'popup.recordingThisChat': 'Recording this chat',
    'popup.chatId': 'Chat ID',
    'popup.requestId': 'Request ID',
    'popup.reachingApp': 'Reaching the app',
    'popup.pickedUp': 'Picked up',
    'popup.sentToApp': 'Sent to app',
    'popup.appProcessed': 'App processed',
    'popup.augmentChatgpt': 'Augment ChatGPT',
    'popup.overwriteChatgpt': 'Overwrite ChatGPT',
    'popup.timestamps': 'Timestamps',
    'popup.advanced': 'Advanced',
    'common.copy': 'Copy',
    'common.tryAgain': 'Try again',
    'common.disconnect': 'Disconnect',
    'common.connected': 'Connected',
    'common.connecting': 'connecting'
  };

  const TH = {
    'popup.lookingForApp': 'กำลังค้นหาแอป',
    'popup.sessionCapture': 'บันทึกการสนทนา',
    'popup.chatgptTab': 'แท็บ ChatGPT',
    'popup.recordingThisChat': 'กำลังบันทึกแชตนี้',
    'popup.chatId': 'Chat ID',
    'popup.requestId': 'Request ID',
    'popup.reachingApp': 'การส่งข้อมูลไปยังแอป',
    'popup.pickedUp': 'รับข้อมูลแล้ว',
    'popup.sentToApp': 'ส่งไปยังแอปแล้ว',
    'popup.appProcessed': 'แอปประมวลผลแล้ว',
    'popup.augmentChatgpt': 'ฟีเจอร์เสริมใน ChatGPT',
    'popup.overwriteChatgpt': 'แสดงผลการทำงานของ Com-gu ใน ChatGPT',
    'popup.timestamps': 'แสดงเวลา',
    'popup.advanced': 'ขั้นสูง',
    'common.copy': 'คัดลอก',
    'common.tryAgain': 'ลองใหม่',
    'common.disconnect': 'ตัดการเชื่อมต่อ',
    'common.connected': 'เชื่อมต่อแล้ว',
    'common.connecting': 'กำลังเชื่อมต่อ'
  };

  const catalogs = { en: EN, th: TH };
  const normalize = (value) => (value === 'th' ? 'th' : 'en');
  const t = (locale, key, values = {}) => {
    const lang = normalize(locale);
    const template = catalogs[lang][key] || EN[key] || key;
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
    );
  };

  globalThis.CLF_I18N = Object.freeze({ EN, TH, normalize, t });
})();
```

Task 7 expands this catalog for every Com-gu-owned injected string. Keep one `extension/i18n.js`; do not split popup/content into competing locale state.

- [ ] **Step 4: Load the runtime in both extension execution paths**

In `extension/manifest.json` change the first content-script list to:

```json
"js": ["i18n.js", "chatgpt-dom.js", "content.js"]
```

In `extension/popup.html`, load i18n immediately before popup code:

```html
<script src="i18n.js"></script>
<script src="popup.js"></script>
```

- [ ] **Step 5: Make popup locale app-authoritative**

In `popup.js`, keep a module-local locale only as the current rendered snapshot:

```js
let locale = 'en';
const tr = (key, values) => globalThis.CLF_I18N.t(locale, key, values);
```

At refresh time, add `locale_get` to the existing `Promise.all`:

```js
const [status, info, localeReply] = await Promise.all([
  chrome.runtime.sendMessage({ type: 'status' }),
  chrome.runtime.sendMessage({ type: 'tabStatus' }).catch(() => null),
  chrome.runtime.sendMessage({ type: 'locale_get' }).catch(() => null)
]);
locale = localeReply && localeReply.ok === true && localeReply.locale === 'th' ? 'th' : 'en';
document.documentElement.lang = locale;
```

Then repaint popup labels with `tr()` before `paintHeader/paintAlert/paintDetails`. Do not add a language selector to the extension: the desktop setting is the single authority.

- [ ] **Step 6: Localize the popup's deterministic HTML/JS copy**

Move all Com-gu-owned labels/status text in `popup.html` and `popup.js` to the extension catalog. Preserve `Chat ID`, `Request ID`, versions, ports, protocol numbers, ids, and raw error details as technical values.

In particular, replace generated strings such as:

```js
`Connected · Port ${status.port}`
`Port ${status.port} · connecting`
'copied'
'copy failed'
'tool call'
```

with translation keys and interpolation. Do not translate the port/id values themselves.

- [ ] **Step 7: Run extension tests**

```sh
npm test -- --run test/extension.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit popup localization**

```sh
git add extension/i18n.js extension/manifest.json extension/popup.html extension/popup.js test/extension.test.ts
git commit -m "feat: localize companion popup"
```

---

### Task 7: Localize Com-gu UI injected into ChatGPT and react to locale changes

**Files:**
- Modify: `extension/i18n.js`
- Modify: `extension/content.js`
- Test: `test/content-script.test.ts`

- [ ] **Step 1: Add failing context-locale tests**

In the content-script harness, extend `settings_get`/`activity` responses so their context can carry `locale`. Add a test that starts English, delivers Thai context, and asserts an injected Com-gu label changes without reloading the ChatGPT document.

Use representative assertions from UI that Com-gu owns, for example the Goal settings sheet:

```ts
expect(document.querySelector('[data-clf-menu]')?.textContent).toContain('Goal');

// Deliver the next /activity result with context.locale = 'th', then flush async work.
expect(document.querySelector('[data-clf-menu]')?.textContent).toContain('บันทึก');
```

Pick the exact stable DOM hooks already used by nearby Goal/compaction tests; do not add test-only selectors to production.

- [ ] **Step 2: Run the focused content-script tests and confirm failure**

```sh
npm test -- --run test/content-script.test.ts
```

Expected: FAIL because `readContext()` currently drops locale and generated labels are English literals.

- [ ] **Step 3: Preserve locale in the existing context object**

Change `readContext(raw)` from:

```js
return { auto: raw.auto === true, threshold, warn, limit };
```

to:

```js
return {
  auto: raw.auto === true,
  threshold,
  warn,
  limit,
  locale: raw.locale === 'th' ? 'th' : 'en'
};
```

Add:

```js
const currentLocale = () => (context && context.locale === 'th' ? 'th' : 'en');
const tr = (key, values) => globalThis.CLF_I18N.t(currentLocale(), key, values);
```

Because both `/activity` and id-less `/settings` flow through `readContext()`, the same code updates existing chats and New Chat.

- [ ] **Step 4: Repaint Com-gu-owned controls when the context locale changes**

Where an activity/settings response replaces `context`, compare the prior locale with the new one. If it changed, rerun the existing Com-gu render functions `renderControl()`, `renderMenu()`, and `injectStage()`. Do not rescan or rewrite ChatGPT-authored messages.

The behavior should be equivalent to:

```js
const beforeLocale = currentLocale();
context = readContext(reply.data.context) || context;
const localeChanged = beforeLocale !== currentLocale();
if (localeChanged) {
  renderControl();
  renderMenu();
  injectStage();
}
```

Use the existing render scheduling/epoch guards where these functions are already called; do not add an independent polling loop.

- [ ] **Step 5: Replace Com-gu-owned generated English with extension translation keys**

Cover current deterministic strings in `content.js`, including:

- context meter (`autocompact on/off`), Goal/compaction settings and tooltips;
- Save/Saving/Cancel/Clear/working labels;
- Goal status and dismiss aria label;
- locally rendered tool/activity summaries such as `Ran {tool}`, `Turn started`, and `Turn {outcome}`;
- worker/agent status copy generated by Com-gu;
- Com-gu error/help text whose source is a stable local branch.

Do not translate captured ChatGPT-authored message text, tool arguments/results, agent message payloads, or raw app errors carried as data.

- [ ] **Step 6: Audit Thai extension copy in small chunks**

Review two chunks independently so each stays comfortably under the `kode-thai` long-file threshold:

1. Popup + connection/activity copy.
2. Composer Goal/compaction/worker copy.

For each: `kode-thai` to `CLEAN` → `humanizer` → final `kode-thai` to `CLEAN`.

- [ ] **Step 7: Prove ChatGPT selectors were untouched**

Run:

```sh
git diff -- extension/chatgpt-dom.js extension/fiber.js
```

Expected: no diff.

This is a hard safety check for localization work; page-owned selector text is not part of the product copy.

- [ ] **Step 8: Run content + extension suites**

```sh
npm test -- --run test/content-script.test.ts test/extension.test.ts test/bridge.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit injected-UI localization**

```sh
git add extension/i18n.js extension/content.js test/content-script.test.ts
git commit -m "feat: localize ChatGPT companion controls"
```

---

### Task 8: Add localization regression guards

**Files:**
- Modify: `test/i18n.test.ts`
- Modify: `test/extension.test.ts`
- Modify: `test/renderer-state.test.ts`

- [ ] **Step 1: Test locale fallback and catalog integrity on both runtimes**

Add assertions that:

- Desktop `TH` and `EN` have identical key sets.
- Extension `CLF_I18N.TH` and `.EN` have identical key sets.
- `normalizeLocale` maps unknown persisted values to English.
- Interpolation leaves unknown placeholders visible rather than silently deleting data.

- [ ] **Step 2: Test the one-authority rule**

Add a bridge/extension integration assertion that changing `config.ui.locale` changes `/settings`/`/activity` output, while no extension request can POST a locale. A request such as:

```ts
const reply = await request('POST', '/settings', { body: { locale: 'th' } });
expect(reply.status).toBe(400);
expect(getConfig().ui.locale).toBe('en');
```

must stay true. This prevents a later popup feature from accidentally creating a second locale authority.

- [ ] **Step 3: Add a renderer persistence regression**

Verify `#localeSelect` follows incoming state but does not clobber a focused dirty control during unrelated state pushes, using the same dirty-field guard pattern already covered for settings controls.

- [ ] **Step 4: Add an extension fallback regression**

When the bridge is temporarily unreachable, the popup may render English for that open; it must not write a locale into Chrome storage as independent truth. Assert no new `chrome.storage` locale preference is introduced.

- [ ] **Step 5: Run the complete localization-adjacent suites**

```sh
npm test -- --run test/i18n.test.ts test/config.test.ts test/ipc.test.ts test/renderer-state.test.ts test/renderer-layout.test.ts test/bridge.test.ts test/extension.test.ts test/content-script.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the regression guards**

```sh
git add test
git commit -m "test: protect Thai localization behavior"
```

---

### Task 9: Verify the complete Thai localization build

**Files:**
- Verify only; modify production code only if a failing check exposes a localization defect.

- [ ] **Step 1: Check the working tree before broad verification**

```sh
git status --short
git diff --check
```

Expected: only intentional localization work; `git diff --check` prints nothing.

- [ ] **Step 2: Run TypeScript checking**

```sh
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run the repository's exact CI gate**

```sh
npm run verify
```

Expected: PASS, including privacy, typecheck, and full Vitest suites.

- [ ] **Step 4: Build the Electron bundles**

Localization changes touch renderer assets and the packaged extension, so run:

```sh
npm run build
```

Expected: PASS and Electron renderer/main/preload bundles produced normally.

- [ ] **Step 5: Manual desktop smoke check**

Run `npm run dev` and verify this exact sequence:

1. Fresh/old config opens in English and shows the `EN / ไทย` selector in the header.
2. Select `ไทย`; the current window changes immediately without restart.
3. Home, Setup, Chat, Activity, permissions, known statuses, Goal/settings UI, and deterministic warnings are Thai.
4. Technical tokens (`MCP`, `API key`, `Tunnel`, `Developer mode`, tool names, ids, paths) remain intact.
5. Restart the app; Thai remains selected.
6. Switch back to `EN`; the same open window returns to English.
7. Change theme immediately before/after locale; both settings persist and neither reverts the other.

- [ ] **Step 6: Manual extension smoke check**

With the unpacked extension loaded:

1. Desktop on `ไทย` → open extension popup → popup renders Thai.
2. Open an existing ChatGPT conversation → Com-gu-injected Goal/compaction/activity UI renders Thai.
3. Switch desktop to `EN` while the ChatGPT tab remains open → the next existing bridge poll repaints Com-gu controls in English without reloading the chat.
4. Open New Chat with desktop on `ไทย` → `/settings` path gives the id-less composer Thai immediately.
5. Disconnect/reconnect the app → extension recovers without creating a locale preference of its own.
6. Verify normal recording, tool-row replacement, Goal controls, and context meter still function.

- [ ] **Step 7: Final Thai language audit**

Read the rendered Thai UI, not just the dictionaries. UI context can make an individually good translation awkward beside a number/button. Fix any such case, then run the affected chunk through `kode-thai` → `humanizer` → final `kode-thai CLEAN` again.

- [ ] **Step 8: Final commit**

Only if Step 7 produced edits:

```sh
git add src extension docs test
git commit -m "fix: polish Thai localization"
```

Do not push as part of this plan unless the user explicitly asks to publish the branch/repo state.

---

## Plan self-review

- **Spec coverage:** Desktop + extension both follow one persisted locale; live switching, restart persistence, English fallback, natural Thai review, and technical/security exclusions are all covered.
- **Trust boundaries:** no new renderer IPC capability; browser gains one read-only locale request only; locale cannot be written from the extension; MCP/bridge auth and document ownership remain unchanged.
- **Upstream friendliness:** changes are concentrated in locale modules and existing presentation/config owners; no unrelated refactor or protocol rename.
- **Thai quality:** translation is reviewed by surface in chunks, then rendered-context QA; `humanizer` is followed by another `kode-thai` pass so the final editor cannot reintroduce awkward Thai.
- **Protected files:** `extension/chatgpt-dom.js` and `extension/fiber.js` are explicitly diff-checked and should remain untouched by localization.
- **Verification:** targeted tests first, then `npm run typecheck`, `npm run verify`, `npm run build`, and manual Desktop/extension smoke checks.
