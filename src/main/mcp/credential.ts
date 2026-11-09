import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SurfaceId } from './surfaces.js';

type Credentials = Record<SurfaceId, string>;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Persist high-entropy bearer secrets separately from user-editable settings. */
export async function loadOrCreateMcpSecrets(dir: string): Promise<Credentials> {
  const file = path.join(dir, 'mcp-credentials.json');
  await fs.mkdir(dir, { recursive: true });
  try {
    const candidate = {
      core: randomBytes(32).toString('base64url'),
      desktop: randomBytes(32).toString('base64url')
    };
    await fs.writeFile(file, JSON.stringify(candidate), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    throw new Error('MCP credential file cannot be read; refusing to rotate published endpoint credentials');
  }
  if (
    !parsed || typeof parsed !== 'object' ||
    !('core' in parsed) || typeof parsed.core !== 'string' || !TOKEN.test(parsed.core) ||
    !('desktop' in parsed) || typeof parsed.desktop !== 'string' || !TOKEN.test(parsed.desktop) ||
    parsed.core === parsed.desktop
  ) throw new Error('Invalid MCP credential file; refusing to rotate published endpoint credentials');
  return { core: parsed.core, desktop: parsed.desktop };
}
