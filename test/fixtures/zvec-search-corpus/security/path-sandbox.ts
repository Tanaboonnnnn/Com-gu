// Native paths are canonicalized with realpath before access. Symlinks and junctions that escape
// an approved root are rejected after resolution rather than trusted from their textual prefix.
export function insideCanonicalRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

// Model-facing results use virtual paths such as /project/src/app.ts. Host drive letters and
// user profile directories are never returned to ChatGPT.
export function virtualPath(rootName: string, relative: string): string {
  return `/${rootName}/${relative}`;
}
