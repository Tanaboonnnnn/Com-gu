import { promises as fs } from 'node:fs';
import path from 'node:path';

const MIGRATION_MARKER = '.legacy-userdata-migrated';
const COPY_FILES = ['config.json', 'secrets.bin'] as const;

export interface LegacyUserDataMigrationOptions {
  legacyDir: string;
  destinationDir: string;
}

export interface LegacyUserDataMigrationResult {
  completed: boolean;
  copied: string[];
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Copy-first compatibility migration for the product identity change.
 *
 * The legacy directory remains authoritative backup material and is never deleted. secrets.bin
 * is copied byte-for-byte: this layer deliberately has no safeStorage dependency and therefore
 * cannot decrypt, inspect or reseal credentials while moving them to the new Electron userData.
 */
export async function migrateLegacyUserData(
  options: LegacyUserDataMigrationOptions
): Promise<LegacyUserDataMigrationResult> {
  const { legacyDir, destinationDir } = options;
  const marker = path.join(destinationDir, MIGRATION_MARKER);
  if (await exists(marker)) return { completed: true, copied: [] };
  if (!(await exists(legacyDir))) return { completed: false, copied: [] };

  await fs.mkdir(destinationDir, { recursive: true });
  const copied: string[] = [];
  for (const name of COPY_FILES) {
    const source = path.join(legacyDir, name);
    const destination = path.join(destinationDir, name);
    if (!(await exists(source)) || (await exists(destination))) continue;
    await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
    copied.push(name);
  }
  await fs.writeFile(marker, 'copy-first-v1\n', { encoding: 'utf8', flag: 'wx' });
  return { completed: true, copied };
}
