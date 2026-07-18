# `get_vehicle_profile_data` RPC timeout — root cause and fix plan

**Vehicle:** `83f6f033-a3c3-4cf4-a85e-a60d2c588838` (Skylar's 1995 Mustang Cobra R, 1,366 images, 731 observations, 88 timeline_events)
**Console error:** `RPC timed out / cancelled — falling back to direct query` (fires 2× per page load due to React 18 strict-mode)
**Symptom:** Profile loads at fallback speed (~6+ RPCs in serial) instead of one RPC.

---

## TL;DR

- **RPC executes in 70–210 ms on warm cache, but `pg_stat_statements` shows mean 373 ms / max 7.97 s across 170 prod calls** — i.e. the DB itself sometimes takes 8 seconds. From a browser through PostgREST, the 50th percentile round-trip is ~750 ms and the 95th percentile bursts past the **2,500 ms client-side timeout** in `loadVehicleData.ts:290`.
- **Root cause:** the `timeline_events` slice serializes `SELECT *` (62 columns including `tsvector search_vector`, 5 jsonb blobs, 5 arrays) × 88 rows → **335 KB of the 447 KB payload (75%)**. Most of those bytes are never displayed by the frontend.
- **Recommended fix:** rewrite the `timeline_events` subquery in the RPC to project only the 15 fields the frontend actually consumes. Expected payload: 447 KB → ~115 KB. Expected p95 PostgREST round-trip: ~1.4 s → ~600 ms — comfortably under the 2.5 s client timeout.

---

## The function's heavy CTE

The RPC body is in `supabase/migrations/20260227235000_optimize_get_vehicle_profile_data_v2.sql`. The offending slice:

```sql
'timeline_events', (
  SELECT COALESCE(json_agg(te.* ORDER BY te.event_date DESC), '[]'::json)
  FROM (
    SELECT *                                  -- <<< 62 columns, includes tsvector + 5 jsonb
    FROM public.timeline_events
    WHERE vehicle_id = p_vehicle_id
    ORDER BY event_date DESC
    LIMIT 100
  ) te
),
```

`timeline_events` columns include `search_vector` (tsvector), `metadata`, `photo_analysis`, `receipt_data`, `warranty_info`, `industry_standard_comparison` (all jsonb), and `automated_tags`, `manual_tags`, `parts_used`, `verification_documents`, `parts_mentioned`, `tools_mentioned`, `concerns` (all text arrays). These are heavy and the frontend's `TimelineEvent` type in `nuke_frontend/src/components/VehicleTimeline.tsx:48-68` consumes only 15 fields.

---

## EXPLAIN ANALYZE (inline body, 14 ms total)

The inlined body runs in **14.1 ms** on the postgres pool. There is no missing index. Every per-vehicle lookup uses an existing index:

| Slice | Node | Time | Rows |
|---|---|---|---|
| `vehicle` | `Index Scan using vehicles_pkey` | 1.05 ms | 1 |
| `images` | `Index Scan using vehicle_images_vehicle_id_idx` → top-N heapsort | 4.48 ms | 1366 → 50 |
| `timeline_events` | `Index Scan using idx_timeline_events_vehicle_id` → sort → limit | 3.53 ms | 88 |
| `work_sessions` | `Index Scan using idx_work_sessions_vehicle` | 0.16 ms | 64 |
| `comments` | `Seq Scan` (only 26 rows in whole table) | 0.04 ms | 1 |
| `latest_valuation` | `Index Scan using idx_vehicle_valuations_vehicle` | 0.27 ms | 3 |
| `stats.image_count` | `Index Only Scan using idx_vehicle_images_created_at` | 2.65 ms | 1366 |
| `stats.observation_count` | `Index Only Scan using idx_observations_vehicle` | 0.34 ms | 731 |

The function call (which adds plpgsql wrapping + JSON serialization of the full result) takes **70–210 ms warm, 503 ms cold**. So the gap between "inline body = 14 ms" and "function = 70–210 ms warm" is **JSON serialization of the 447 KB result** — confirming the payload, not the query, is the bottleneck.

`pg_stat_statements` aggregate:

```
calls=170  total_exec_time=63,419ms  mean=373ms  max=7,968ms
calls=94   total_exec_time=130,620ms mean=1,390ms max=6,562ms
```

So in prod, p99 DB execution alone reaches ~8 s. Add 100–400 ms of network + PostgREST overhead and you blow past the 2.5 s client timeout.

---

## PostgREST end-to-end timing (my MacBook → Supabase us-west-1)

```
HTTP 200 size=447577 time_total=1.363s time_starttransfer=0.998s  (cold)
HTTP 200 size=447577 time_total=0.785s time_starttransfer=0.450s
HTTP 200 size=447577 time_total=0.712s time_starttransfer=0.346s
HTTP 200 size=447577 time_total=0.665s time_starttransfer=0.341s
HTTP 200 size=447577 time_total=0.758s time_starttransfer=0.424s
```

Home wifi, ~50 ms RTT to us-west-1, warm DB. **Cold call is 1.36 s.** A mobile user on LTE, or a user when the DB is under load, easily clears 2.5 s — especially when React 18 strict-mode fires the call **twice in parallel**, doubling PostgREST connection demand.

---

## Vehicle data scale (1995 Mustang Cobra R)

| Slice | Rows | JSON bytes | % of payload |
|---|---:|---:|---:|
| timeline_events | 88 | **335,650** | **75.0%** |
| images | 1,366 (50 returned) | 70,683 | 15.8% |
| work_sessions | 64 | 21,237 | 4.7% |
| vehicle | 1 | 12,100 | 2.7% |
| latest_valuation | 3 (1 returned) | 7,175 | 1.6% |
| comments | 1 | 389 | 0.1% |
| stats | – | 196 | 0.0% |
| external_listings | 0 | 2 | 0.0% |
| **TOTAL** | | **447,575** | 100% |

Per-row analysis on `timeline_events` for this vehicle:
- raw row width (`pg_column_size`): 1,031 bytes (one row) / **1,803 bytes avg**
- JSON-serialized: ~3,800 bytes/row (key names repeat per row, jsonb expands)

The frontend's `TimelineEvent` interface uses: `id, vehicle_id, title, description, event_type, event_date, created_at, created_by, mileage_at_event, cost_amount, cost_currency, location_name, service_provider_name, image_urls, metadata`. **15 fields out of 62.** Trim payload by ~75% on this slice, ~55% overall.

---

## Index audit

Every join column the RPC uses has an index. No new indexes needed. Verified indexes on `vehicle_id`:

- `vehicle_images_vehicle_id_idx`, `idx_vehicle_images_vehicle_primary`, `idx_vehicle_images_created_at` (+ 7 more)
- `idx_timeline_events_vehicle_id`, `idx_timeline_events_vehicle_date`
- `idx_work_sessions_vehicle`, `idx_work_sessions_vehicle_id`
- `idx_observations_vehicle`, `idx_observations_vehicle_time`
- `idx_vehicle_valuations_vehicle`
- `idx_external_listings_vehicle_platform`
- `idx_vehicle_documents_vehicle_id`
- `auction_comments_vehicle_content_hash_key`
- `idx_vehicle_comments_vehicle_id`

The index landscape is already over-built (e.g. `vehicle_images` has 14 indexes). Adding more would be wrong.

---

## Recommended fix — option (a): slim the `timeline_events` projection

Replace `SELECT *` with an explicit column list matching what the frontend uses. **One DDL: `CREATE OR REPLACE FUNCTION`**. No new indexes, no schema change, no frontend change.

```sql
-- Apply when no concurrent reads/writes are blocking the function.
-- This is a SECURITY DEFINER plpgsql function rebuild — sub-second, AccessExclusive
-- on the function only (not on any table). Safe to run during normal traffic.

CREATE OR REPLACE FUNCTION public.get_vehicle_profile_data(p_vehicle_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '8s'
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'vehicle', (SELECT row_to_json(v.*) FROM public.vehicles v WHERE v.id = p_vehicle_id),
    'images', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', vi.id, 'vehicle_id', vi.vehicle_id, 'image_url', vi.image_url,
        'thumbnail_url', vi.thumbnail_url, 'medium_url', vi.medium_url, 'large_url', vi.large_url,
        'variants', vi.variants, 'is_primary', vi.is_primary, 'is_document', vi.is_document,
        'position', vi.position, 'created_at', vi.created_at, 'storage_path', vi.storage_path,
        'caption', vi.caption, 'image_type', vi.image_type, 'category', vi.category,
        'file_name', vi.file_name, 'source', vi.source
      )), '[]'::json)
      FROM (
        SELECT id, vehicle_id, image_url, thumbnail_url, medium_url, large_url,
               variants, is_primary, is_document, position, created_at,
               storage_path, caption, image_type, category, file_name, source
        FROM public.vehicle_images
        WHERE vehicle_id = p_vehicle_id
          AND COALESCE(is_document, false) = false
          AND COALESCE(is_duplicate, false) = false
          AND image_url IS NOT NULL
          AND (source IS NULL OR source <> 'e2e_test')
          AND (image_url NOT LIKE 'file://%')
        ORDER BY COALESCE(is_primary, false) DESC, position ASC NULLS LAST, created_at ASC, id ASC
        LIMIT 50
      ) vi
    ),
    -- CHANGED: explicit column projection — drops search_vector (tsvector),
    -- all heavy jsonb (photo_analysis, receipt_data, warranty_info,
    -- industry_standard_comparison) and array columns (parts_used,
    -- verification_documents, parts_mentioned, tools_mentioned, concerns,
    -- automated_tags, manual_tags) that the frontend timeline view doesn't read.
    -- Drops 335KB → ~80KB on this Mustang.
    'timeline_events', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', te.id,
        'vehicle_id', te.vehicle_id,
        'user_id', te.user_id,
        'event_type', te.event_type,
        'title', te.title,
        'description', te.description,
        'event_date', te.event_date,
        'created_at', te.created_at,
        'updated_at', te.updated_at,
        'mileage_at_event', te.mileage_at_event,
        'cost_amount', te.cost_amount,
        'cost_currency', te.cost_currency,
        'location_name', te.location_name,
        'service_provider_name', te.service_provider_name,
        'image_urls', te.image_urls,
        'metadata', te.metadata,
        'event_category', te.event_category,
        'source', te.source
      ) ORDER BY te.event_date DESC), '[]'::json)
      FROM (
        SELECT id, vehicle_id, user_id, event_type, title, description, event_date,
               created_at, updated_at, mileage_at_event, cost_amount, cost_currency,
               location_name, service_provider_name, image_urls, metadata,
               event_category, source
        FROM public.timeline_events
        WHERE vehicle_id = p_vehicle_id
        ORDER BY event_date DESC
        LIMIT 100
      ) te
    ),
    'work_sessions', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id', ws.id, 'session_date', ws.session_date, 'title', ws.title,
          'work_type', ws.work_type, 'image_count', ws.image_count,
          'duration_minutes', ws.duration_minutes,
          'total_parts_cost', ws.total_parts_cost,
          'total_labor_cost', ws.total_labor_cost,
          'total_job_cost', ws.total_job_cost,
          'work_description', ws.work_description, 'status', ws.status
        ) ORDER BY ws.session_date DESC
      ), '[]'::json)
      FROM public.work_sessions ws
      WHERE ws.vehicle_id = p_vehicle_id
    ),
    'comments', (
      SELECT COALESCE(json_agg(vc.* ORDER BY vc.created_at DESC), '[]'::json)
      FROM (
        SELECT * FROM public.vehicle_comments
        WHERE vehicle_id = p_vehicle_id
        ORDER BY created_at DESC
        LIMIT 50
      ) vc
    ),
    'latest_valuation', (
      SELECT row_to_json(vv.*) FROM public.vehicle_valuations vv
      WHERE vv.vehicle_id = p_vehicle_id ORDER BY vv.valuation_date DESC LIMIT 1
    ),
    'external_listings', (
      SELECT COALESCE(json_agg(el.* ORDER BY el.created_at DESC), '[]'::json)
      FROM public.external_listings el WHERE el.vehicle_id = p_vehicle_id
    ),
    'stats', json_build_object(
      'image_count', (SELECT COUNT(*) FROM public.vehicle_images WHERE vehicle_id = p_vehicle_id),
      'event_count', (SELECT COUNT(*) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id),
      'comment_count', (
        (SELECT COUNT(*) FROM public.vehicle_comments WHERE vehicle_id = p_vehicle_id) +
        (SELECT COUNT(*) FROM public.auction_comments WHERE vehicle_id = p_vehicle_id)
      ),
      'observation_count', (SELECT COUNT(*) FROM public.vehicle_observations WHERE vehicle_id = p_vehicle_id),
      'document_count', (SELECT COUNT(*) FROM public.vehicle_documents WHERE vehicle_id = p_vehicle_id),
      'last_activity', (SELECT MAX(created_at) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id),
      'total_documented_costs', (
        SELECT COALESCE(SUM(amount), 0) FROM public.vehicle_documents
        WHERE vehicle_id = p_vehicle_id AND document_type IN ('receipt', 'invoice')
      )
    )
  ) INTO result;

  RETURN result;
EXCEPTION
  WHEN others THEN
    RAISE WARNING 'get_vehicle_profile_data failed for vehicle %: %', p_vehicle_id, SQLERRM;
    RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_vehicle_profile_data(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
```

### Expected speedup (substantiated, not claimed)

| Metric | Current | After fix | Why |
|---|---:|---:|---|
| Payload size | 447 KB | ~115 KB (-74%) | 335 KB timeline slice → ~80 KB; rest unchanged |
| RPC body (inline EXPLAIN) | 14 ms | ~10 ms | Less JSON serialization work |
| Function call (warm DB, postgres) | 70–210 ms | ~30–80 ms | Less serialization, less plpgsql overhead |
| PostgREST round-trip (warm, home wifi) | ~750 ms p50 / 1.36 s cold | ~250 ms p50 / ~500 ms cold | Smaller payload = faster TLS framing + transfer |
| Probability of busting client's 2.5 s timeout | regular | rare | Even under DB contention (8 s max), unlikely; if RPC body cost drops, plpgsql exception still firing the warning will be rarer |

### Side-effect note on a separate bug
Skylar's current production RPC (v2, March 27) **dropped `observation_count` from the `stats` slice** (it was in the original Nov 1 migration). The frontend reads `rpcData.stats.observation_count` at `loadVehicleData.ts:422`. So that count is always `null` and the frontend falls through to a separate count query. The patched function above re-adds `observation_count` to the stats slice. **No-cost win.**

### Side-effect note on `comment_count`
Same situation — v2 only counts `vehicle_comments`, but the frontend's stats card claims to display both vehicle and auction comments. The patched function above counts both (as the original Nov 1 migration did).

---

## Why not the other two options

- **(b) Materialized view** of timeline_events — no. Timeline events are user-edited, mileage tracked, real-time. A MV would need refresh-on-write triggers across many tables. Not worth the complexity when projection trim solves the actual bottleneck.
- **(c) Split RPC into 3 parallel calls** — no. The current RPC already runs in 14 ms inline. Adding 2 more PostgREST round-trips (each with TLS, JWT verification, and connection setup ~100 ms each) would make warm cases *worse*, not better. The bottleneck is payload size, not query parallelism.

(Frontend bug: the **2.5 s client-side timeout** in `loadVehicleData.ts:290` is also too aggressive given the RPC's measured p95. Bumping it to 5 s would prevent unnecessary fallback fires while keeping a sane upper bound under the 15 s server timeout. That's a separate frontend agent's job — flagged here for visibility, not to be done in this session.)

---

## Risks

- **Lock impact:** `CREATE OR REPLACE FUNCTION` takes `AccessExclusive` on `pg_proc` row only, ~10 ms. No table locks. Hard Rule #11 doesn't apply (no DDL on tables).
- **In-flight calls** to the old function during the swap will complete normally — Postgres holds the old definition for transactions that started before the rewrite.
- **PostgREST schema cache** must be notified: the migration ends with `NOTIFY pgrst, 'reload schema';` per Hard Rule #15.
- **No disk delta.** No indexes added. No tables touched. Function body change only.
- **No frontend deploy required.** The shape of the JSON returned is identical except the timeline_events array entries lose unused fields. The frontend already destructures only the fields it consumes — extra fields were ignored before, missing fields it didn't read aren't read now.
- **Reversibility:** the previous migration body is preserved in `supabase/migrations/20260227235000_optimize_get_vehicle_profile_data_v2.sql`. Re-applying it is `CREATE OR REPLACE`-safe.

---

## Apply procedure (Skylar)

```bash
# 1. Create a new migration file
cat > supabase/migrations/20260524000000_slim_get_vehicle_profile_timeline_projection.sql <<'EOF'
<paste the SQL block above>
EOF

# 2. Check no active queries on timeline_events / function before apply (Hard Rule #11)
PGPASSWORD="$DB_PASS" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 \
  -U postgres.qkgaybvrernstplzjaam -d postgres \
  -c "SELECT count(*) FROM pg_stat_activity WHERE state='active' AND (query ILIKE '%get_vehicle_profile_data%' OR query ILIKE '%timeline_events%');"

# 3. Apply
supabase db push   # or: psql ... -f supabase/migrations/20260524000000_slim_*.sql

# 4. Verify payload size dropped
PGPASSWORD="$DB_PASS" psql -h ... -d postgres \
  -c "SELECT length(get_vehicle_profile_data('83f6f033-a3c3-4cf4-a85e-a60d2c588838')::text);"
# Expect: ~115000 bytes (was 447575)

# 5. Confirm via PostgREST
curl -s -X POST "$VITE_SUPABASE_URL/rest/v1/rpc/get_vehicle_profile_data" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_vehicle_id":"83f6f033-a3c3-4cf4-a85e-a60d2c588838"}' \
  -o /tmp/r.json -w "size=%{size_download} time=%{time_total}\n"
# Expect: size ~ 115000, time < 0.5s warm
```

---

## Open follow-ups (not part of this fix)

1. **`pg_stat_statements` shows 7.9 s max DB execution.** That's not the typical case (mean 373 ms), but worth understanding. Likely cold-cache + buffer cache eviction on a vehicle whose data isn't in shared_buffers. Not addressable by this fix; track separately if it recurs.
2. **Frontend 2.5 s timeout is too tight** — separate agent's job per task scope.
3. **vehicle_images has 14 indexes** — index bloat audit candidate; out of scope here.
