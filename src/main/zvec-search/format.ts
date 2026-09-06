import { resolvePath } from '../sandbox.js';
import type { Root } from '../../shared/types.js';
import {
  SMART_SEARCH_MAX_OUTPUT_BYTES,
  type SmartSearchHit,
  type SmartSearchRawHit,
  type SmartSearchResponse
} from './types.js';

const MAX_EXCERPT_BYTES = 64 * 1024;

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function truncateUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  if (utf8Bytes(value) <= maxBytes) return { text: value, truncated: false };
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (utf8Bytes(value.slice(0, mid)) <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return { text: value.slice(0, low), truncated: true };
}

/**
 * Treat zvec as an untrusted cache. Every returned native path must still prove current
 * containment through the same realpath/symlink-aware sandbox used by the filesystem tools.
 */
export async function verifySearchHits(
  roots: readonly Root[],
  raw: readonly SmartSearchRawHit[]
): Promise<SmartSearchHit[]> {
  const verified: SmartSearchHit[] = [];
  for (const hit of raw) {
    try {
      const resolved = await resolvePath(roots, hit.absolutePath);
      verified.push({
        virtualPath: resolved.virtual,
        startLine: hit.startLine,
        endLine: hit.endLine,
        content: hit.content,
        matchedBy: hit.matchedBy,
        ...(typeof hit.score === 'number' ? { score: hit.score } : {}),
        freshness: hit.freshness
      });
    } catch {
      // Missing, out-of-scope, or link-escaped cache entries are stale authority, not results.
    }
  }
  return verified;
}

function formatHit(hit: SmartSearchHit): string {
  const excerpt = truncateUtf8(hit.content, MAX_EXCERPT_BYTES);
  const lines = [
    `path: ${hit.virtualPath}`,
    `lines: ${hit.startLine}-${hit.endLine}`,
    `matched_by: ${hit.matchedBy}`,
    `freshness: ${hit.freshness}`,
    ...(typeof hit.score === 'number' ? [`score: ${hit.score}`] : []),
    ...(excerpt.truncated ? ['excerpt_truncated: true'] : []),
    'content:',
    excerpt.text
  ];
  return lines.join('\n');
}

export function formatSmartSearchResponse(response: SmartSearchResponse): string {
  const header = [
    `roots_searched: ${response.rootsSearched}`,
    `elapsed_ms: ${Math.max(0, Math.round(response.elapsedMs))}`,
    `results: ${response.hits.length}`
  ].join('\n');
  const blocks = [header];
  const truncation = '\noutput_truncated: true';
  let used = utf8Bytes(header);
  let truncated = false;

  for (const hit of response.hits) {
    const block = `\n\n${formatHit(hit)}`;
    const bytes = utf8Bytes(block);
    if (used + bytes + utf8Bytes(truncation) > SMART_SEARCH_MAX_OUTPUT_BYTES) {
      truncated = true;
      break;
    }
    blocks.push(block);
    used += bytes;
  }
  if (truncated) blocks.push(truncation);
  return blocks.join('');
}
