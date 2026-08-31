import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const maintainerLogin = 'totec448-spec';
const safeMaintainerEmail = /^(?:\d+\+)?totec448-spec@users\.noreply\.github\.com$/i;
const comGuMaintainerLogin = 'Tanaboonnnnn';
const safeComGuMaintainerEmail = /^(?:\d+\+)?tanaboonnnnn@users\.noreply\.github\.com$/i;

// Keep the blocked values split so this guard does not contain the data it rejects.
const blockedText = [
  { label: 'Claude session trailer', value: ['Claude', 'Session:'].join('-') },
  { label: 'Claude session URL', value: ['https://claude.ai/code/', 'session_'].join('') },
];

function runGit(args, { allowFailure = false, encoding = 'utf8' } = {}) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (!allowFailure && result.status !== 0) {
    const detail = String(result.stderr ?? '').trim();
    throw new Error(`git ${args[0] ?? ''} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function findBlockedText(text, location) {
  const normalized = text.toLowerCase();
  return blockedText
    .filter(({ value }) => normalized.includes(value.toLowerCase()))
    .map(({ label }) => `${location} contains ${label}`);
}

function checkMaintainerIdentity(name, email, location) {
  const normalizedName = name.trim().toLowerCase();
  const normalizedEmail = email.trim().replace(/^<|>$/g, '').toLowerCase();
  const belongsToUpstreamMaintainer =
    normalizedName === maintainerLogin.toLowerCase() || normalizedEmail.includes(maintainerLogin.toLowerCase());
  const belongsToComGuMaintainer =
    normalizedName === comGuMaintainerLogin.toLowerCase() || normalizedEmail.includes(comGuMaintainerLogin.toLowerCase());
  if (belongsToUpstreamMaintainer && !safeMaintainerEmail.test(normalizedEmail)) {
    return [`${location} uses a non-noreply maintainer email`];
  }
  if (belongsToComGuMaintainer && !safeComGuMaintainerEmail.test(normalizedEmail)) {
    return [`${location} uses a non-noreply maintainer email`];
  }
  return [];
}

function parseGitIdent(ident) {
  const match = ident.match(/^(.*) <([^>]+)> \d+ [+-]\d{4}$/);
  if (!match) throw new Error('Could not parse the Git author identity.');
  return { name: match[1] ?? '', email: match[2] ?? '' };
}

function checkIndexedOrCommittedFiles(treeish) {
  const failures = [];
  for (const { label, value } of blockedText) {
    const args = ['grep', '-q', '-I', '-i', '-F', '-e', value];
    if (treeish === '--cached') args.push('--cached');
    else args.push(treeish);
    args.push('--', '.');
    const result = runGit(args, { allowFailure: true });
    if (result.status === 0) failures.push(`${treeish} contains ${label}`);
    else if (result.status !== 1) throw new Error(`git grep failed while checking ${label}`);
  }
  return failures;
}

function checkForbiddenSessionMetadata(treeish) {
  const failures = [];
  for (const { label, value } of blockedText) {
    const args = ['grep', '-q', '-I', '-i', '-F'];
    if (treeish === '--cached') args.push('--cached');
    args.push('-e', value);
    if (treeish !== '--cached') args.push(treeish);
    args.push('--', '.');
    const result = runGit(args, { allowFailure: true });
    if (result.status === 0) failures.push(`${treeish} contains ${label}`);
    else if (result.status !== 1) throw new Error(`git grep failed while checking ${label}`);
  }
  return failures;
}

function isComGuOrigin() {
  const originRemote = String(runGit(['remote', 'get-url', 'origin'], { allowFailure: true }).stdout ?? '').trim();
  return /(?:^|[/:])Tanaboonnnnn\/Com-gu(?:\.git)?$/i.test(originRemote);
}

function checkCurrentAuthor() {
  const ident = String(runGit(['var', 'GIT_AUTHOR_IDENT']).stdout).trim();
  const { name, email } = parseGitIdent(ident);
  return checkMaintainerIdentity(name, email, 'current Git author');
}

function checkMessageFile(messagePath) {
  return [
    ...checkCurrentAuthor(),
    ...findBlockedText(readFileSync(messagePath, 'utf8'), 'commit message'),
  ];
}

function checkHistory() {
  const failures = [];
  const isComGuFork = isComGuOrigin();
  const commits = String(runGit(['rev-list', '--all']).stdout)
    .split(/\r?\n/)
    .filter(Boolean);
  // pull_request jobs default to a GitHub-generated merge object that can never enter
  // public history. Its identity belongs to GitHub's test ref, not to the proposed tree.
  const syntheticPullRequestCommit =
    process.env.GITHUB_EVENT_NAME === 'pull_request' ? process.env.GITHUB_SHA?.trim() : '';

  for (const commit of commits) {
    if (syntheticPullRequestCommit && commit === syntheticPullRequestCommit) continue;
    const record = String(
      runGit(['show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce%x00%B', commit]).stdout,
    );
    const [authorName = '', authorEmail = '', committerName = '', committerEmail = '', ...body] =
      record.split('\0');
    const location = `commit ${commit}`;
    if (!isComGuFork) {
      failures.push(
        ...checkMaintainerIdentity(authorName, authorEmail, `${location} author`),
        ...checkMaintainerIdentity(committerName, committerEmail, `${location} committer`),
      );
    }
    failures.push(...findBlockedText(body.join('\0'), `${location} message`));
  }

  const tags = String(runGit(['tag', '--list']).stdout)
    .split(/\r?\n/)
    .filter(Boolean);
  for (const tag of tags) {
    const type = String(runGit(['cat-file', '-t', tag]).stdout).trim();
    if (type !== 'tag') continue;
    const record = String(
      runGit([
        'for-each-ref',
        `refs/tags/${tag}`,
        '--format=%(taggername)%00%(taggeremail)%00%(contents)',
      ]).stdout,
    );
    const [taggerName = '', taggerEmail = '', ...body] = record.split('\0');
    if (!isComGuFork) failures.push(...checkMaintainerIdentity(taggerName, taggerEmail, `tag ${tag} tagger`));
    failures.push(...findBlockedText(body.join('\0'), `tag ${tag} message`));
  }

  const head = runGit(['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
  if (head.status === 0) {
    failures.push(...(isComGuFork ? checkForbiddenSessionMetadata('HEAD') : checkIndexedOrCommittedFiles('HEAD')));
  }
  return { failures, commits: commits.length, tags: tags.length };
}

function fail(failures) {
  console.error('Public-history privacy check failed:');
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exitCode = 1;
}

const [mode, argument] = process.argv.slice(2);
if (mode === '--message') {
  if (!argument) throw new Error('--message requires the commit-message file path.');
  const failures = checkMessageFile(argument);
  if (failures.length > 0) fail(failures);
} else if (mode === '--staged') {
  const failures = [
    ...checkCurrentAuthor(),
    ...(isComGuOrigin() ? checkForbiddenSessionMetadata('--cached') : checkIndexedOrCommittedFiles('--cached')),
  ];
  if (failures.length > 0) fail(failures);
} else if (mode) {
  throw new Error(`Unknown argument: ${mode}`);
} else {
  const { failures, commits, tags } = checkHistory();
  if (failures.length > 0) fail(failures);
  else console.log(`Public-history privacy check passed (${commits} commits, ${tags} tags).`);
}
