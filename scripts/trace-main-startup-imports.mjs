import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function slash(value) {
  return value.replaceAll('\\', '/');
}

async function resolveRelative(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = path.extname(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch {}
  }
  return null;
}

function staticSpecifiers(sourceText) {
  // Startup source uses ordinary ESM import/export declarations. Dynamic import() is
  // intentionally excluded because this audit asks what is evaluated before app-ready.
  const specifiers = [];
  const pattern = /(?:^|\n)\s*(?:import\s+(?:[^'"\n]+?\s+from\s+)?|export\s+[^'"\n]+?\s+from\s+)["']([^"']+)["']/g;
  for (const match of sourceText.matchAll(pattern)) specifiers.push(match[1]);
  return specifiers;
}

export async function traceMainStartupImports(repositoryRoot) {
  const entry = path.join(repositoryRoot, 'src', 'main', 'index.ts');
  const pending = [entry];
  const seen = new Set();
  const externalImports = new Set();

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const sourceText = await readFile(file, 'utf8');
    for (const specifier of staticSpecifiers(sourceText)) {
      if (!specifier.startsWith('.')) {
        externalImports.add(specifier);
        continue;
      }
      const resolved = await resolveRelative(file, specifier.replace(/\.js$/, ''));
      if (resolved && !seen.has(resolved)) pending.push(resolved);
    }
  }

  const modules = [...seen].map((file) => slash(path.relative(repositoryRoot, file))).sort();
  const externals = [...externalImports].sort();
  const matchingModules = (patterns) => modules.filter((module) => patterns.some((pattern) => module.includes(pattern)));
  const matchingExternals = (patterns) => externals.filter((specifier) => patterns.some((pattern) => specifier.includes(pattern)));

  return {
    entry: 'src/main/index.ts',
    modules,
    externalImports: externals,
    classifications: {
      computerHelper: matchingModules(['/computer/', 'src/main/computer/']),
      updater: matchingModules(['src/main/ipc.ts', 'updat']),
      mxc: [...matchingModules(['command-sandbox']), ...matchingExternals(['@microsoft/mxc-sdk'])],
      sharp: [...matchingModules(['/image', 'image-']), ...matchingExternals(['sharp'])],
      sessionAgent: matchingModules(['/session/', 'src/main/agents.ts', 'src/main/bridge.ts'])
    }
  };
}

async function main() {
  const repositoryRoot = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..'));
  const trace = await traceMainStartupImports(repositoryRoot);
  process.stdout.write(`${JSON.stringify(trace, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
