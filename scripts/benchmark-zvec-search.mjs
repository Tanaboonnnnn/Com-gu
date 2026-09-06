import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createEmbeddingModel, createZvecGrep, EmbeddingPurpose } from '@zvec/zvec-grep';

function parseArgs(argv) {
  const args = { embedding: '', out: '' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--embedding') args.embedding = argv[++index] ?? '';
    else if (arg === '--out') args.out = argv[++index] ?? '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.embedding.startsWith('local/')) throw new Error('--embedding must be an explicit local/* model');
  if (!args.out) throw new Error('--out is required');
  return args;
}

async function treeBytes(root) {
  let bytes = 0;
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) bytes += (await fs.stat(absolute)).size;
    }
  }
  try {
    await walk(root);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return bytes;
}

function relativeFile(corpusRoot, absolutePath) {
  const relative = path.relative(corpusRoot, absolutePath).replaceAll('\\', '/');
  return relative.startsWith('../') ? null : relative;
}

function rates(records) {
  const subset = (language) => records.filter((row) => !language || row.language === language);
  const summarize = (rows) => ({
    count: rows.length,
    top1: rows.length ? rows.filter((row) => row.top1Hit).length / rows.length : 0,
    top5: rows.length ? rows.filter((row) => row.top5Hit).length / rows.length : 0,
    meanQueryMs: rows.length ? rows.reduce((sum, row) => sum + row.elapsedMs, 0) / rows.length : 0
  });
  return { overall: summarize(subset()), th: summarize(subset('th')), en: summarize(subset('en')) };
}

async function prepareModel(embedding, modelCacheDir) {
  const rssBefore = process.memoryUsage().rss;
  const model = createEmbeddingModel(embedding, { modelCacheDir, device: 'cpu' });
  let firstDownloadAt = null;
  let readyAt = null;
  let downloadedBytes = 0;
  let totalBytes = 0;
  const started = performance.now();
  try {
    await model.embed([{ kind: 'text', text: 'ComGu local search benchmark warmup' }], {
      purpose: EmbeddingPurpose.Query,
      onProgress(progress) {
        const now = performance.now();
        if (progress.stage === 'downloading') {
          if (firstDownloadAt === null) firstDownloadAt = now;
          if (typeof progress.downloadedBytes === 'number') downloadedBytes = Math.max(downloadedBytes, progress.downloadedBytes);
          if (typeof progress.totalBytes === 'number') totalBytes = Math.max(totalBytes, progress.totalBytes);
        }
        if (progress.stage === 'ready') readyAt = now;
      }
    });
  } finally {
    await model.dispose();
  }
  const ended = performance.now();
  return {
    prepareMs: ended - started,
    downloadObserved: firstDownloadAt !== null,
    downloadMs: firstDownloadAt === null ? 0 : Math.max(0, (readyAt ?? ended) - firstDownloadAt),
    downloadedBytes,
    totalBytes,
    rssDeltaBytes: Math.max(0, process.memoryUsage().rss - rssBefore)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpusRoot = path.resolve('test', 'fixtures', 'zvec-search-corpus');
  const queryManifest = path.join(corpusRoot, 'queries.json');
  const queries = JSON.parse(await fs.readFile(queryManifest, 'utf8'));
  if (!Array.isArray(queries) || queries.length !== 20) throw new Error('Expected exactly 20 frozen benchmark queries');
  if (queries.filter((row) => row.language === 'th').length !== 10 || queries.filter((row) => row.language === 'en').length !== 10) {
    throw new Error('Expected 10 Thai and 10 English benchmark queries');
  }

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'comgu-zvec-benchmark-'));
  const syntheticRoot = path.join(temp, 'workspace');
  const home = path.join(temp, 'runtime');
  const modelCacheDir = path.join(temp, 'models');
  await fs.mkdir(syntheticRoot, { recursive: true });

  const result = {
    embedding: args.embedding,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    corpusRoot,
    queryCount: queries.length,
    startedAt: new Date().toISOString(),
    model: null,
    indexMs: 0,
    indexBytes: 0,
    rssDeltaBytes: 0,
    rates: null,
    queries: []
  };

  try {
    result.model = await prepareModel(args.embedding, modelCacheDir);
    const rssBefore = process.memoryUsage().rss;
    const service = await createZvecGrep({
      root: syntheticRoot,
      home,
      embedding: args.embedding,
      modelCacheDir,
      device: 'cpu'
    });
    try {
      const indexStarted = performance.now();
      await service.index({
        root: syntheticRoot,
        rootPaths: [corpusRoot],
        excludePaths: [queryManifest],
        follow: false,
        rebuild: true
      });
      result.indexMs = performance.now() - indexStarted;
      const info = await service.info({ root: syntheticRoot, includeStatus: true });
      result.indexBytes = await treeBytes(info.indexPath);
      result.rssDeltaBytes = Math.max(0, process.memoryUsage().rss - rssBefore);

      for (const query of queries) {
        const started = performance.now();
        const response = await service.context({
          root: syntheticRoot,
          query: query.query,
          routes: [
            { id: 'lexical', mode: 'fts', query: query.query },
            { id: 'semantic', mode: 'vector', query: query.query }
          ],
          fuse: true,
          limit: 20,
          follow: false,
          autoUpdate: false
        });
        const elapsedMs = performance.now() - started;
        const files = [];
        for (const item of response.items) {
          const relative = relativeFile(corpusRoot, item.file.absolutePath);
          if (relative && relative !== 'queries.json' && !files.includes(relative)) files.push(relative);
          if (files.length >= 5) break;
        }
        const expected = new Set(query.expectedFiles);
        result.queries.push({
          id: query.id,
          language: query.language,
          query: query.query,
          expectedFiles: query.expectedFiles,
          topFiles: files,
          top1Hit: files.length > 0 && expected.has(files[0]),
          top5Hit: files.some((file) => expected.has(file)),
          elapsedMs
        });
      }
      result.rates = rates(result.queries);
    } finally {
      await service.close();
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }

  result.finishedAt = new Date().toISOString();
  await fs.writeFile(path.resolve(args.out), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    embedding: result.embedding,
    model: result.model,
    indexMs: result.indexMs,
    indexBytes: result.indexBytes,
    rssDeltaBytes: result.rssDeltaBytes,
    rates: result.rates
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
