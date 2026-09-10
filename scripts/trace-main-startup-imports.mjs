import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

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
  // Dynamic imports and type-only imports are intentionally excluded: neither is evaluated as
  // part of the eager startup dependency graph. Parse syntax rather than regex so multiline
  // imports and TypeScript `import type` declarations cannot distort the performance audit.
  const ast = parse(sourceText, { sourceType: 'module', plugins: ['typescript'] });
  return ast.program.body.flatMap((statement) => {
    if (statement.type === 'ImportDeclaration') {
      return statement.importKind === 'type' ? [] : [statement.source.value];
    }
    if (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportAllDeclaration') {
      return statement.exportKind === 'type' || !statement.source ? [] : [statement.source.value];
    }
    return [];
  });
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
      sessionAgent: matchingModules(['/session/', 'src/main/agents.ts', 'src/main/bridge.ts']),
      goalAgents: matchingModules(['src/main/goal.ts', 'src/main/agents.ts'])
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
