import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Root } from '../../shared/types.js';

export interface SearchStoragePaths {
  base: string;
  models: string;
  indexes: string;
}

export function smartSearchStoragePaths(userData: string): SearchStoragePaths {
  const base = path.join(userData, 'search');
  return { base, models: path.join(base, 'models'), indexes: path.join(base, 'indexes') };
}

export function rootIndexId(root: Root, canonicalPath: string): string {
  return createHash('sha256')
    .update('comgu-zvec-root-v1\0')
    .update(root.name)
    .update('\0')
    .update(process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath)
    .digest('hex')
    .slice(0, 32);
}

export function rootIndexPaths(storage: SearchStoragePaths, root: Root, canonicalPath: string) {
  const id = rootIndexId(root, canonicalPath);
  const container = path.join(storage.indexes, id);
  return { id, container, syntheticRoot: path.join(container, 'workspace') };
}
