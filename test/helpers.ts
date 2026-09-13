import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Creates an isolated temp directory and canonicalises it. The canonical form
 * matters: on Windows the temp path often differs from what realpath returns,
 * and the sandbox compares canonical paths.
 */
export async function makeTempDir(prefix = 'clf-'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), prefix));
  return await fs.realpath(dir);
}

export async function removeTempDir(dir: string): Promise<void> {
  // Windows can keep a just-terminated child process's cwd handle alive briefly after the
  // process manager has observed termination. Under parallel Vitest load that shows up as
  // transient EBUSY/EPERM during cleanup. Let fs.rm own the retry loop rather than adding
  // per-test sleeps that make the suite timing-dependent.
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

/** Writes a map of "a/b.txt" -> contents, creating parent folders as needed. */
export async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
}

/**
 * Directory link type that needs no administrator rights. On Windows a junction
 * is a reparse point, which is exactly the escape route the sandbox must block.
 */
export const DIR_LINK: 'junction' | 'dir' = process.platform === 'win32' ? 'junction' : 'dir';

export const IS_WINDOWS = process.platform === 'win32';

/**
 * A handoff brief long enough to be one.
 *
 * The app refuses a brief that is too short to have carried a session across, because a
 * receiving chat cannot tell a truncated capture from a whole document — see
 * `briefShortfall`. Tests about the *transaction* still need a brief that gets past that
 * floor, so they share this one rather than each inventing a paragraph.
 */
export const SAMPLE_BRIEF = [
  'TASK — finish the bridge rewrite the user asked for and leave the tests green.',
  '',
  'USER SPECIFICATION — the rewrite must keep the existing wire contract, must not change',
  'the extension protocol version, and must land before the release is cut. The user asked',
  'twice for the tests to be run before anything is reported as done.',
  '',
  'CURRENT STATE — src/main/bridge.ts compiles; the routes are ported; two suites are red.',
  'The pairing handshake is unchanged and the bearer token still comes from /pair, so nothing',
  'an already-paired extension holds has to be reissued.',
  '',
  'DONE — /commands and /commands/ack are ported and covered by test/bridge.test.ts. The rate',
  'limiter and the body cap moved with them unchanged, and the Origin check still refuses any',
  'origin that is not a chrome-extension:// one.',
  '',
  'IN PROGRESS — /activity, stopped while re-deriving the cursor semantics. The old route',
  'advanced its cursor on read, which the page relies on not happening for a peek.',
  '',
  'FAILED / UNRESOLVED — none outstanding beyond the two red suites named above. The earlier',
  'attempt to share one cursor between /activity and /events was abandoned: they are read by',
  'different callers at different rates and one cursor made both of them wrong.',
  '',
  'FILES — src/main/bridge.ts (routes), test/bridge.test.ts (coverage for them),',
  'src/main/session/recorder.ts (only where the activity cursor is read).',
  '',
  'VERIFICATION — `npm run typecheck` is clean; `npx vitest run test/bridge.test.ts` is red.',
  '',
  'NEXT — finish the cursor rework, then run the full suite.',
  '',
  'DO NOT — do not touch the extension protocol version; the user ruled that out.'
].join('\n');
