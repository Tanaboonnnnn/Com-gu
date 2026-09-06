let loaded: Promise<typeof import('@zvec/zvec-grep')> | null = null;

export function loadZvecModule(): Promise<typeof import('@zvec/zvec-grep')> {
  loaded ??= import('@zvec/zvec-grep');
  return loaded;
}

export function zvecModuleLoadedForTest(): boolean {
  return loaded !== null;
}
