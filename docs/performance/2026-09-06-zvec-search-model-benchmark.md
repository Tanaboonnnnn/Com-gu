# Zvec Smart Search Local Model Benchmark — 2026-09-06

## Decision

ComGu Smart Search uses **`local/potion-code-16m-v2`** as its default embedding model.

The frozen 20-query bilingual corpus gate was:

- overall top-5 target-file hit rate >= 90%;
- Thai top-5 >= 80%;
- English top-5 >= 80%;
- if more than one model passes, choose the smaller/lower-RSS model.

`local/potion-code-16m-v2` passed all three quality thresholds and was much smaller than the multilingual candidate. `local/potion-multilingual-128m` did not pass the fixed quality gate, so no third candidate was required.

## Frozen corpus

Source: `test/fixtures/zvec-search-corpus/`

- 13 source/document files;
- 20 queries total;
- 10 Thai queries;
- 10 English queries;
- expected files were committed in `queries.json` before either model was benchmarked;
- `queries.json` itself was excluded from indexing so the expected answers could not leak into retrieval.

The benchmark used hybrid retrieval for every query: one FTS route plus one vector route with fusion enabled. Success means at least one expected file appeared among the first five distinct returned files.

## Environment

| Field | Value |
| --- | --- |
| Git base SHA | `b45d6c4ad1c488ca6411a774fc0a388c3601aba3` |
| OS | Microsoft Windows 11 Home Single Language, build 26200 |
| CPU | AMD Ryzen 7 3750H with Radeon Vega Mobile Gfx |
| RAM | 9.94 GiB reported by Windows |
| Architecture | AMD64 |
| Node | v24.14.0 |
| npm | 11.18.0 |
| `@zvec/zvec-grep` | 0.2.1 |
| Device forced for benchmark | CPU |

Each candidate used a new temporary runtime/index/model-cache directory. Therefore both runs exercised a first-run model download. The download phase was measured separately through zvec's embedding progress callback before index timing began.

## Results

| Metric | `local/potion-code-16m-v2` | `local/potion-multilingual-128m` |
| --- | ---: | ---: |
| Overall top-1 | 50% | 55% |
| Overall top-5 | **95%** | 70% |
| Thai top-5 | **90%** | 60% |
| English top-5 | **100%** | 80% |
| Mean query latency | **777.9 ms** | 902.5 ms |
| First-run model prepare | **3,208.9 ms** | 28,842.5 ms |
| Observed model download | **2,696.1 ms** | 27,461.2 ms |
| Downloaded bytes observed | **33,514,412** | 530,977,691 |
| Index time | **6,216.8 ms** | 9,923.1 ms |
| Index bytes | 4,425,407 | 4,425,410 |
| Model warm-up RSS delta | **75,849,728 B** | 979,951,616 B |
| Index/service RSS delta | **95,879,168 B** | 194,568,192 B |
| Gate | **PASS** | **FAIL** |

Raw run outputs were written locally as `.bench-zvec-code.json` and `.bench-zvec-multilingual.json`; they are benchmark scratch data and are not release artifacts.

## Miss analysis

The selected code model missed one of twenty top-5 expectations: Thai query `th-shutdown` did not return `lifecycle/shutdown.ts` in its first five distinct files. The other nine Thai queries and all ten English queries hit an expected target within top 5.

The multilingual model missed six top-5 expectations: four Thai queries (`th-symlink-escape`, `th-stdin-owner`, `th-compact`, `th-shutdown`) and two English queries (`en-durable-write`, `en-shutdown-order`). Because that run scored only 70% overall and 60% Thai, it failed before size/RSS could be considered.

No expected-file labels were changed after seeing either run.

## Release consequence

Freeze `DEFAULT_SMART_SEARCH_EMBEDDING` to `local/potion-code-16m-v2`. This benchmark does not relax ComGu's security model: the embedding stays local, indexes/models stay in ComGu private application data, and every candidate path returned by zvec is still revalidated against the current MCP call's WorkspaceScope before it can reach ChatGPT.
