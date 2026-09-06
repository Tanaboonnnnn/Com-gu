import type { Root } from '../../shared/types.js';

export const SMART_SEARCH_MODES = ['auto', 'hybrid', 'lexical', 'semantic'] as const;
export type SmartSearchMode = (typeof SMART_SEARCH_MODES)[number];
export const SMART_SEARCH_DEFAULT_LIMIT = 8;
export const SMART_SEARCH_MAX_LIMIT = 20;
export const SMART_SEARCH_MAX_OUTPUT_BYTES = 96 * 1024;

export interface SmartSearchRequest {
  query: string;
  path?: string;
  mode?: SmartSearchMode;
  include?: readonly string[];
  fileTypes?: readonly string[];
  limit?: number;
}

export interface SmartSearchScope {
  root: Root;
  realPath: string;
  virtualPath: string;
  kind: 'file' | 'directory';
}

export interface SmartSearchRawHit {
  absolutePath: string;
  startLine: number;
  endLine: number;
  content: string;
  matchedBy: string;
  score?: number;
  freshness: 'fresh' | 'possibly_stale';
}

export interface SmartSearchHit extends Omit<SmartSearchRawHit, 'absolutePath'> {
  virtualPath: string;
}

export interface SmartSearchResponse {
  hits: SmartSearchHit[];
  rootsSearched: number;
  elapsedMs: number;
}

export interface SmartSearchProvider {
  search(scopes: readonly SmartSearchScope[], request: SmartSearchRequest): Promise<SmartSearchResponse>;
}
