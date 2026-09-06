import { describe, expect, it } from 'vitest';
import { rootIndexId, rootIndexPaths, smartSearchStoragePaths } from '../src/main/zvec-search/paths.js';

describe('smart-search paths', () => {
  it('stores indexes below userData and never below the source repository', () => {
    const storage = smartSearchStoragePaths('C:\\Users\\u\\AppData\\Roaming\\ComGu');
    const root = { name: 'repo', path: 'D:\\work\\repo' };
    const paths = rootIndexPaths(storage, root, 'D:\\work\\repo');
    expect(paths.syntheticRoot.startsWith(storage.indexes)).toBe(true);
    expect(paths.syntheticRoot.startsWith(root.path)).toBe(false);
  });

  it('does not alias two different canonical native roots with the same virtual name', () => {
    expect(rootIndexId({ name: 'repo', path: 'D:\\a' }, 'D:\\a')).not.toBe(
      rootIndexId({ name: 'repo', path: 'D:\\b' }, 'D:\\b')
    );
  });
});
