# 2026-05-24 — Substrate: pgvector Embedding for vehicle_observations

**Status:** design proposal, awaiting approval. **NO DDL APPLIED.**
**Author:** Substrate design pass (agent under Skylar)
**Lane:** `vehicle_observations` only. Does NOT touch `vehicles` or `vehicle_images` (agent 72093 owns those).
**Companion:** `2026-05-24_substrate_xyz-spatial-anchor-design.md`
**Source axiom:** Skylar 2026-05-24 — *"labels are just that, they are opinions, very similar to LLM science where similar labels develop orbits of data chunks. ... minimal labels means we would just have to run analysis over the images again."*

---

## 1. Motivation — why embeddings, not more label drawers

Today every observation is tagged by `kind` (a 9-value enum: `media`, `listing`, `comment`, `bid`, `sale_result`, `condition`, `work_record`, `specification`, `provenance`) plus whatever the extractor stamped into `structured_data`. Adding a new descriptive axis ("oxidation pattern", "panel gap visual signature", "owner-claimed condition vibe") today means either:

1. A new column on `vehicle_observations` (locks the table, fights agent 72093, requires migration), or
2. A new enum value (changes the contract for every consumer), or
3. A naming-convention buried inside `structured_data` JSONB (unindexable, undiscoverable, drifts across extractors).

Skylar's framing reframes the problem. **Labels are projections from a high-dimensional space, not the space itself.** Two observations that say "front passenger quarter shows pitting around the badge mount" and "rust forming where the emblem screws into the fender" are not the same string but live in the same vector neighborhood. The substrate that captures sameness is not a label column — it's the embedding.

This is exactly the rhizome / palimpsest / "stickies-and-pen-ink" framing already in the library:

- `docs/library/intellectual/contemplations/the-rhizome.md` — observations are nodes; meaning is the topology between them.
- `docs/library/intellectual/papers/novel-ontological-contributions.md` §IV — disagreement is data; labels do not collapse contradictions, they retain them.
- The Schema Discovery Principle in `CLAUDE.md` — *"Never pre-define a schema before seeing the actual data."* Embeddings are the maximal version of this principle: never pre-declare the label vocabulary; let it emerge from clustering over the observation manifold.

The substrate goal: every `vehicle_observations` row carries a vector that lets us query, cluster, and crystallize labels later instead of guessing them up front.

---

## 2. Substrate state at design time

Confirmed via direct DB query 2026-05-24:

- `pg_extension`: **`vector` 0.8.0 already installed** (also `postgis` 3.3.7). No CREATE EXTENSION needed.
- `vehicle_observations`: 48 columns; **no vector column today.** Already carries `content_text`, `structured_data` (JSONB), `content_hash`, supersession columns (`is_superseded`, `superseded_by`, `lineage_chain`), and provenance (`agent_tier`, `agent_model`, `extraction_method`, `raw_source_ref`).
- Row count: **~7.5M observations** (pg_class reltuples). The brief estimated 5.6M; the real number is 34% larger. Cost numbers below use 7.5M.
- Text-length sample (5,000 rows via `TABLESAMPLE SYSTEM (0.5)`): `content_text` avg 116 chars / p50 57 / p90 234; `structured_data` avg 196 chars / p50 198 / p90 210. Combined avg ≈ 312 chars per observation.
- Kind distribution in the sample: media-heavy (59%), then listing/comment/bid. Media rows often have empty `content_text` but rich `structured_data`; both need to feed the embedding.

---

## 3. Proposed schema additions

> All additions are to `vehicle_observations` only. No new tables. No touching of `vehicles` or `vehicle_images`. Supersession semantics preserved: an embedding is a *property of the observation row*, not a separate testimony record — updating it does not constitute an overwrite of testimony per `.claude/rules/agent-trust-invariants.md` because the *content* (text + structured_data) is the testimony; the embedding is a derived projection.

### 3.1 Columns

```
-- DESIGN ONLY — NOT EXECUTED
ALTER TABLE vehicle_observations
  ADD COLUMN observation_embedding        vector(1536),
  ADD COLUMN observation_embedding_model  text,
  ADD COLUMN observation_embedding_at     timestamptz,
  ADD COLUMN observation_embedding_input  text;     -- hash of the textified input
```

Rationale per column:

- **`observation_embedding vector(1536)`** — see §4 for dimension choice.
- **`observation_embedding_model`** — e.g. `'openai:text-embedding-3-small@2024-01-25'`. Without this, vocabulary drift across model versions is invisible. With it, we can re-embed only the rows produced by retired models. This is the embedding equivalent of `methodology_references.superseded_by` from the recursive-decay paper.
- **`observation_embedding_at`** — when the embedding was computed. Lets us answer "what fraction of the corpus is embedded with the current model?" without scanning text content.
- **`observation_embedding_input`** — SHA-256 of the exact textified input (content_text + canonicalized structured_data + kind tag). Lets us detect when the underlying content has been superseded but the embedding wasn't refreshed.

### 3.2 Indexing strategy

**Recommendation: HNSW.** Reasoning:

| | ivfflat | HNSW |
|---|---|---|
| Build time on 7.5M rows | ~30–60 min (one shot) | ~6–12 hours (or built incrementally) |
| Recall at default params | ~85% | ~95–98% |
| Tunability after build | re-cluster needed to re-balance | per-query `ef_search` knob, no rebuild |
| Incremental insert cost | low (cluster assignment) | moderate (graph walk) but fine for current write rate |
| Memory footprint | smaller | ~1.5–2× larger |
| pgvector version required | any | 0.5.0+ — **we have 0.8.0** |

The decisive factor: we expect the corpus to keep growing and the query pattern to be "find the 50 nearest neighbors of an arbitrary new observation" — that's the cluster-and-crystallize-labels loop. HNSW dominates ivfflat for high-recall k-NN at that scale and pgvector 0.8.0 has mature HNSW support.

```
-- DESIGN ONLY
CREATE INDEX observation_embedding_hnsw
  ON vehicle_observations
  USING hnsw (observation_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**Distance op: cosine.** OpenAI embeddings are L2-normalized; cosine is the right choice and is what every paper using these embeddings benchmarks against. `vector_cosine_ops` enables `<=>` operator.

**Build-time discipline (per Hard Rule #11 + #8 in CLAUDE.md):**
- HNSW build on 7.5M rows will take hours. It cannot run while agent 72093 is doing `vehicles`/`vehicle_images` DDL. Coordinate.
- Build with `maintenance_work_mem` raised for the session (not the role default), and **build CONCURRENTLY is not supported for HNSW in pgvector 0.8.0** — so the table will take a heavy lock during index creation. Mitigations:
  - Build during a quiet window (overnight).
  - Or: do a *partial* HNSW on `WHERE observation_embedding IS NOT NULL`, build column first via backfill, then index. This is the recommended sequence (see §5).

### 3.3 Schema for the embedding lifecycle

Three valid states for any row:

| State | `observation_embedding` | `observation_embedding_model` | `observation_embedding_at` | Meaning |
|---|---|---|---|---|
| Unembedded | NULL | NULL | NULL | New row, or backfill not yet reached it |
| Embedded current | non-NULL | matches current default | recent | Active in similarity queries |
| Embedded stale | non-NULL | older model string | older | Still usable, lower priority for re-embed |

No supersession-style "ghost row" needed because the embedding is metadata about the observation, not a claim. When the model changes, the column is updated in-place. This is one of the rare in-place updates that **does not** violate the trust invariant — the testimony (content_text, structured_data) is unchanged.

---

## 4. Embedding model — 1536 vs 3072

| Option | Dimensions | OpenAI $/1M tokens | Cosine quality (MTEB) | Storage at 7.5M rows |
|---|---|---|---|---|
| `text-embedding-3-small` | 1536 | **$0.020** | 62.3 | ~46 GB (vector + index) |
| `text-embedding-3-large` (full) | 3072 | $0.130 | 64.6 | ~92 GB |
| `text-embedding-3-large` (truncated to 1536 via `dimensions` param) | 1536 | $0.130 | ~64.0 | ~46 GB |
| `text-embedding-3-large` (truncated to 256 via `dimensions` param) | 256 | $0.130 | ~62.0 | ~8 GB |

**Recommendation: `text-embedding-3-small` at 1536d.** Reasons:

1. 6.5× cheaper than `large`. At our scale this is the difference between a tractable backfill and a "let me think about it" backfill.
2. The quality delta (62.3 → 64.6 MTEB) is small relative to the cost delta. For the use case — cluster auto-discovery, label emergence detection, similar-observation lookup — we don't need the last 2 MTEB points. We need any embedding at all.
3. Dimension matches existing OpenAI ada-002 conventions, so any downstream tool that already expects 1536d works.
4. **If quality turns out insufficient, the migration path is open:** because `observation_embedding_model` is recorded per row, we can later add a `vector(3072)` column for selected high-value rows or a partial re-embed of a kind-stratified sample.

**The brief mentioned ada-002 compatibility ($0.13/1M).** Recommend updating that mental model: ada-002 is deprecated and `text-embedding-3-small` at $0.020/1M is now the default cost-aware choice. The cost numbers below use `-3-small`.

---

## 5. Backfill plan

### 5.1 Token estimate

Observed sample stats: avg ≈ 312 chars (content_text + structured_data) per row. Add ~40 chars of canonicalization scaffolding (kind tag, `source_id` short hash, separator tokens to give the embedder structure). Round to **~360 chars per row**.

OpenAI's tokenizer (cl100k_base for `-3-*`) averages ~3.7 chars/token for mixed English-and-structured content (closer to 4 for prose, ~3 for terse JSON). Conservative estimate: **~100 tokens per observation.**

Total backfill: **7.5M obs × 100 tokens = 750M tokens.**

### 5.2 Dollar cost

| Model | $/1M tokens | Total |
|---|---|---|
| `text-embedding-3-small` | $0.020 | **$15.00** |
| `text-embedding-3-large` | $0.130 | $97.50 |

**The backfill cost for `-3-small` is ~$15.** This is approximately the cost of one Lambda Labs H100-hour. It is not a budget item that requires discussion — it's noise.

The `-3-large` cost of ~$97.50 is also small in absolute terms, but $15 vs $97 is a 6.5× delta in cost for a marginal quality gain. Recommend `-3-small` unless an A/B sample on 10K rows shows the quality difference matters for our specific clustering use case (see §8).

### 5.3 Mechanical plan

Backfill is a **read-from-DB, embed-via-OpenAI-batch-API, write-back-to-DB** loop. Batch API discount is 50% (so the real cost is ~$7.50 for `-3-small`), but synchronous backfill is also fine — total wall time at 50 RPS would be 7.5M / 50 / 3600 ≈ 42 hours, or 6–8 hours if we parallelize across 5 workers.

Phased rollout to respect Hard Rule #8 (batched writes):

1. **Phase 1 — schema only (5 min).** Add the four columns (NULL-default, no rewrites). This is metadata-only, no data scan. Coordinate with agent 72093 to avoid lock cascade.
2. **Phase 2 — write-path integration (1 hour of code).** Update `supabase/functions/ingest-observation/index.ts` to embed on every new insert. **Synchronously, not fire-and-forget** — embedding latency is ~50ms which is acceptable. Async is an option (queue + worker), but it adds a moving part for a $7.50 problem.
3. **Phase 3 — backfill in 1k-row batches** with `pg_sleep(0.1)` between batches per Hard Rule #8. Resumable: query `WHERE observation_embedding IS NULL ORDER BY id LIMIT 1000`. Estimated wall time: 6–12 hours single-worker, 1–2 hours parallelized.
4. **Phase 4 — index build.** After Phase 3 hits >95% coverage, build the HNSW index. **Schedule overnight** because it locks the table during build. Set `maintenance_work_mem='2GB'` for the session only.
5. **Phase 5 — index validation.** `EXPLAIN ANALYZE SELECT ... ORDER BY embedding <=> $1 LIMIT 50;` should show `Index Scan using observation_embedding_hnsw`. Spot-check 20 known-similar pairs (manually curated) to confirm cosine distances make sense.

### 5.4 What to embed — the textification recipe

Per row, build the input string:

```
[KIND:{kind}] [SRC:{source_slug}] {content_text} {flatten(structured_data)}
```

`flatten(structured_data)` is a depth-first walk emitting `"key=value"` pairs in stable order (so `observation_embedding_input` hash is deterministic). Drop very long fields (>2KB) — embedding quality plateaus and cost rises linearly. Drop binary/url-only fields that don't carry meaning (raw image URLs, internal IDs).

The kind tag at the front gives the model a coarse-grained sorting signal. The source tag gives provenance context (a BaT comment and a forum post about the same vehicle should still be near each other, but the source tag is a useful weak signal).

---

## 6. Query patterns enabled

### 6.1 Nearest-neighbor

```sql
-- 50 observations most similar to a target embedding
SELECT id, vehicle_id, kind, content_text,
       observation_embedding <=> $1 AS distance
FROM vehicle_observations
WHERE observation_embedding IS NOT NULL
ORDER BY observation_embedding <=> $1
LIMIT 50;
```

Use case: "given this newly extracted observation, what existing observations corroborate or contradict it?" Feeds the conflict-detection pipeline.

### 6.2 Cross-vehicle pattern lookup

```sql
-- Find observations on OTHER vehicles that look like this one
SELECT o2.vehicle_id, count(*) AS hits
FROM vehicle_observations o1
JOIN vehicle_observations o2
  ON o2.observation_embedding <=> o1.observation_embedding < 0.20
WHERE o1.id = $1 AND o2.vehicle_id != o1.vehicle_id
GROUP BY o2.vehicle_id
ORDER BY hits DESC LIMIT 10;
```

Use case: "this damage pattern on the K5 — which other trucks in the corpus have the same pattern?" Drives the archetype-discovery query loop.

### 6.3 Cluster auto-discovery → label emergence

```sql
-- Pull the embedding manifold for a vehicle, cluster externally (HDBSCAN in Python),
-- detect dense clusters that don't yet have a label, surface them for human review.
SELECT id, observation_embedding
FROM vehicle_observations
WHERE vehicle_id = $1 AND observation_embedding IS NOT NULL;
```

The crystallization moment: when a cluster gets dense enough (e.g. ≥20 members, intra-cluster distance < ε), surface it as a candidate label. A human (Skylar, or a vetted reviewer) accepts/rejects. Accepted labels become first-class — but they live as a *projection over the manifold*, not as a hard-coded enum. This is the rhizome formalized.

### 6.4 Embedding drift detection

```sql
-- Which observations were embedded with a retired model?
SELECT observation_embedding_model, count(*)
FROM vehicle_observations
WHERE observation_embedding IS NOT NULL
GROUP BY observation_embedding_model;
```

When OpenAI deprecates a model or we switch providers, this query is the migration plan.

---

## 7. Integration with `ingest-observation`

Current code (`supabase/functions/ingest-observation/index.ts`) inserts the row and fires an async analysis trigger. Two integration options:

### 7.1 Synchronous embed (RECOMMENDED)

Add a single `await openai.embeddings.create(...)` call between content-hash computation and the row insert. ~50ms latency added per call. Failure mode: if OpenAI is down, the row insert proceeds with NULL embedding (a backfill worker will pick it up later). This is the simplest correct behavior and matches the system's general "fail open, backfill later" pattern.

```typescript
// DESIGN — actual integration in a separate receipt
const embedding = await embedObservation({
  kind: input.kind,
  source_slug: input.source_slug,
  content_text: input.content_text,
  structured_data: input.structured_data,
}).catch(() => null);  // soft-fail

// then in the insert payload:
observation_embedding: embedding?.vector ?? null,
observation_embedding_model: embedding ? CURRENT_MODEL : null,
observation_embedding_at: embedding ? new Date().toISOString() : null,
observation_embedding_input: embedding?.input_hash ?? null,
```

### 7.2 Async embed (alternative)

Use the existing fire-and-forget pattern at the bottom of `ingest-observation` and post a job to a queue. A separate `embed-observation-worker` picks it up and updates the row. Adds a moving part. Worth doing only if synchronous embedding throughput becomes a bottleneck — which it won't, at our write rate.

**Recommend 7.1.** Revisit if write-rate climbs above ~5 RPS sustained.

---

## 8. Open questions Skylar must decide

1. **Embedding model**: `text-embedding-3-small@1536d` ($15 backfill) vs `text-embedding-3-large@3072d` ($97.50, ~2.3 MTEB points better). Strong recommend `-3-small`; flag only if there's an explicit reason to want the higher quality.

2. **Sync vs async embed-on-write**: §7.1 recommended. Confirm.

3. **HNSW vs ivfflat**: §3.2 recommended HNSW with `m=16, ef_construction=64`. These are pgvector's standard defaults; recall on real benchmarks is 95–98%. Confirm or adjust.

4. **Embedding refresh policy when content is superseded**: Today, when an observation is superseded (`is_superseded=true, superseded_by=<new_id>`), no embedding action is taken. The old row keeps its embedding, the new row gets a fresh one. **Question: should superseded rows be excluded from similarity queries by default?** Recommend yes — add `AND is_superseded IS NOT TRUE` to all similarity queries. The old embedding stays in the DB (testimony preserved) but doesn't pollute live queries.

5. **Provider lock-in vs portability**: OpenAI is the cheapest decent embedder today. Cohere, Voyage, and local nomic-embed-text are alternatives. `observation_embedding_model` makes provider swap possible later. **Default: OpenAI. Reopen if Anthropic ships an embedding endpoint** (none currently).

6. **Batch API vs realtime API**: Backfill via OpenAI Batch API is 50% the cost ($7.50). Wall time is 24h instead of 6–12h. Recommend Batch API for the one-shot backfill; realtime API for the steady-state ingest path.

7. **Per-kind embedding strategy**: Should `media`-kind observations (which are image-heavy and have terse `content_text`) be embedded from their image instead via CLIP? Open question. Recommend Phase 1 = text-only for all kinds; Phase 2 = CLIP embeddings for `media` kind specifically, stored in a separate column or table to keep dimensions sane. **Do not** try to mix CLIP and text embeddings in the same column — they live in different vector spaces.

---

## 9. What this design explicitly does NOT do

- Does not touch `vehicles` table (agent 72093 owns it).
- Does not touch `vehicle_images` table (agent 72093 owns it). Image embeddings, if added, go in a future receipt.
- Does not create new edge functions (Hard Rule #1). Embedding logic lives inside the existing `ingest-observation` function as a shared helper.
- Does not propose deletion or overwrite of any testimony row.
- Does not change the supersession pattern. Embeddings are added as a derived property; the testimony content remains immutable.
- Does not propose a new table (Hard Rule #2). Four columns on an existing table, no new tables.

---

## 10. Decision summary for Skylar

| Decision | Recommendation | Cost / Risk if wrong |
|---|---|---|
| Embedding model | `text-embedding-3-small` @ 1536d | $80 wasted if we should have used `-large` (recoverable) |
| Index type | HNSW (`m=16, ef_construction=64`) | Build is slow; rebuild possible |
| Embed-on-write | Synchronous | +50ms per ingest; acceptable |
| Backfill API | OpenAI Batch (50% off) | 24h wall time vs 6–12h |
| Total backfill cost | **~$7.50** (Batch API) or ~$15 (realtime) | Negligible |
| Backfill wall time | 24h (Batch) or 6–12h (realtime, single worker) | Schedule overnight either way |
| Index build wall time | 6–12 hours, locks table | Schedule overnight; coordinate w/ 72093 |

**Awaiting Skylar's go-ahead before drafting the migration receipt.**
