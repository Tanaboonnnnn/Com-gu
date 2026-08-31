import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.join(process.cwd(), 'scripts', 'verify-public-history.mjs');
const repositories: string[] = [];
const safeEmail = '227782719+totec448-spec@users.noreply.github.com';

function makeRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'public-history-privacy-'));
  repositories.push(repository);
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: repository });
  writeFileSync(path.join(repository, 'README.md'), 'clean\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repository });
  commit(repository, 'Clean root', safeEmail);
  return repository;
}

function commit(repository: string, message: string, email: string): void {
  execFileSync('git', ['commit', '--allow-empty', '-m', message], {
    cwd: repository,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'totec448-spec',
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: 'totec448-spec',
      GIT_COMMITTER_EMAIL: email,
    },
  });
}

function verify(repository: string) {
  return spawnSync(process.execPath, [script], {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function addOrigin(repository: string, url: string): void {
  execFileSync('git', ['remote', 'add', 'origin', url], { cwd: repository });
}

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe('public-history privacy gate', () => {
  it('accepts the numeric GitHub noreply identity', () => {
    const repository = makeRepository();
    const result = verify(repository);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('privacy check passed');
  });

  it('rejects a non-noreply maintainer identity without printing the address', () => {
    const repository = makeRepository();
    const privateEmail = ['totec448', 'gmail.com'].join('@');
    commit(repository, 'Unsafe identity', privateEmail);

    const result = verify(repository);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('non-noreply maintainer email');
    expect(result.stderr).not.toContain(privateEmail);
  });

  it('rejects Claude session provenance in commit messages without echoing it', () => {
    const repository = makeRepository();
    const sessionUrl = ['https://claude.ai/code/', 'session_exampleIdentifier'].join('');
    commit(repository, `Unsafe trailer\n\n${['Claude', 'Session'].join('-')}: ${sessionUrl}`, safeEmail);

    const result = verify(repository);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Claude session');
    expect(result.stderr).not.toContain(sessionUrl);
  });

  it('allows inherited upstream author identity on the ComGu fork but still rejects session provenance', () => {
    const repository = makeRepository();
    addOrigin(repository, 'https://github.com/Tanaboonnnnn/Com-gu.git');
    commit(repository, 'Inherited upstream commit', ['totec448', 'gmail.com'].join('@'));

    const inherited = verify(repository);
    expect(inherited.status).toBe(0);

    const sessionUrl = ['https://claude.ai/code/', 'session_forkLeak'].join('');
    commit(repository, `Unsafe fork trailer\n\n${['Claude', 'Session'].join('-')}: ${sessionUrl}`, safeEmail);
    const leaked = verify(repository);
    expect(leaked.status).toBe(1);
    expect(leaked.stderr).toContain('Claude session');
    expect(leaked.stderr).not.toContain(sessionUrl);
  });
});
