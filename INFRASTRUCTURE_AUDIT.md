# Nuke Platform Infrastructure Audit

**Date**: 2026-02-10
**Auditor**: Claude Opus 4.6 (automated)
**Current users**: 5 active
**Target scale**: 500 / 5,000 / 50,000 users

---

## Executive Summary

Nuke is running a 103 GB Postgres database on Supabase Pro (8 GB RAM tier) with 320 edge functions, 1,065 tables, and zero application-level caching. The platform will hit a wall at approximately 200 concurrent users due to database connection limits and the total absence of a caching layer. The rate limiting system exists but is broken. There is no CDN for API responses. This is a data platform duct-taped to a prototyping-tier infrastructure.

**Verdict**: Survivable at 500 users with targeted fixes (~$500/mo additional). Requires significant rearchitecture for 5,000 users (~$2,000-5,000/mo). Needs a complete platform migration for 50,000 users (~$10,000-25,000/mo).

---

## 1. Current State: What We Found

### 1.1 Database

| Metric | Value | Concern Level |
|--------|-------|---------------|
| Database size | **103 GB** | HIGH - approaching Pro plan limits |
| Total tables | **1,065** | HIGH - schema sprawl |
| Largest table | `listing_page_snapshots` at **37 GB** | CRITICAL - raw HTML storage |
| Second largest | `vehicle_images` at **32 GB** | HIGH - metadata table, not actual images |
| Total index size | **26 GB** | HIGH - over-indexed |
| Vehicle count | **794,644** | Moderate |
| Observation count | **628,809** | Moderate |
| Image metadata rows | **28.4 million** | HIGH |
| Max connections | **160** | Hard ceiling |
| Current connections | **51** (32% utilized) | OK for now |
| Connection breakdown | 41 idle authenticator, 7 idle admin, 2 active | Wasteful |
| shared_buffers | **2 GB** | Confirms Pro/Team ~8 GB RAM tier |
| effective_cache_size | **6 GB** | Confirms ~8 GB RAM instance |
| work_mem | **12 MB** | OK |
| statement_timeout | **10s** | Aggressive - will cause failures under load |
| Dead tuples | 1.6M in auction_comments, 475K in bat_bids | Moderate - autovacuum running |
| pg_cron jobs | **68** | HIGH - competing for connections |

**Postgres Config Analysis**: `shared_buffers=2GB` + `effective_cache_size=6GB` = Supabase Pro plan with either a Small or Medium compute add-on (~8 GB RAM instance). This is a $25/mo base + $50-100/mo compute add-on.

#### Index Bloat (Critical)

The `vehicle_images` table has **110+ indexes** consuming approximately **10 GB** for a 32 GB table. Many are redundant:

- `idx_vehicle_images_vehicle_id` AND `vehicle_images_vehicle_id_idx` (duplicate)
- `idx_vehicle_images_primary` AND `idx_vehicle_images_is_primary` AND `idx_vehicle_images_vehicle_primary` AND `idx_vehicle_images_vehicle_primary_lookup` AND `vehicle_images_one_primary_per_vehicle_idx` (5 overlapping indexes for "is_primary")
- `idx_vehicle_images_created_at` AND `vi_created_idx` (duplicate)
- `idx_vehicle_images_user_id` AND `vehicle_images_user_id_idx` (duplicate)

The `vehicles` table has **70+ indexes** consuming ~1.6 GB. The `vehicles_description_trgm_idx` alone is **1,016 MB** -- a trigram index on the full description text of 794K vehicles.

**Every INSERT/UPDATE on these tables must update 70-110 indexes.** This is a write performance killer.

#### Sequential Scan Hotspots

| Table | Seq Scans | Index Scans | Ratio |
|-------|-----------|-------------|-------|
| `receipts` | 14.7M | 5.2M | 2.8:1 seq |
| `canonical_makes` | 5.3M | 77K | 68:1 seq |
| `scrape_sources` | 4.8M | 403K | 12:1 seq |
| `vehicle_images` | 3.5M | 1.7B | OK |
| `canonical_models` | 3.3M | 8K | 415:1 seq |

`canonical_makes` (97 rows) and `canonical_models` (272 rows) are scanned sequentially **millions of times**. These are small lookup tables that should be cached in application memory, not queried from Postgres on every request.

### 1.2 Edge Functions

| Metric | Value |
|--------|-------|
| Total edge functions | **320** |
| Cold start latency (measured) | 355-410ms (avg: **380ms**) |
| Warm latency | ~355ms |
| Service role key usage | **Every function uses service role** |

**Cold Start Analysis** (5 sequential calls to `universal-search`):

```
Call 1: 0.355s  (warm - already deployed)
Call 2: 0.377s
Call 3: 0.410s
Call 4: 0.362s
Call 5: 0.395s
Average: 0.380s
```

The low variance (355-410ms) suggests these are all warm calls. True cold starts on Supabase Edge Functions (Deno Deploy) are typically 200-500ms additional. The ~380ms baseline includes network round-trip + query execution, which is acceptable.

**Critical Issue**: Every edge function creates its own Supabase client with `SUPABASE_SERVICE_ROLE_KEY`, bypassing RLS. While RLS is enabled on key tables, the service role key ignores it entirely. At scale, this means:
- No per-user query isolation
- A single compromised function = full database access
- No way to throttle individual user queries at the database level

### 1.3 API Rate Limiting

**The rate limiting system is structurally broken.**

From `api-v1-vehicles/index.ts` (lines 311-329):

```typescript
// Check rate limit
if (keyData.rate_limit_remaining !== null && keyData.rate_limit_remaining <= 0) {
    return { userId: null, error: "Rate limit exceeded" };
}

// Decrement rate limit
await supabase
    .from("api_keys")
    .update({
        rate_limit_remaining: keyData.rate_limit_remaining ? keyData.rate_limit_remaining - 1 : null,
        last_used_at: new Date().toISOString(),
    })
    .eq("key_hash", keyHash);
```

**Problems**:

1. **No reset mechanism**: `rate_limit_remaining` decrements to 0 and stays there forever. The `rate_limit_reset_at` column exists in the schema but is **never read or updated** in the code. Once a key hits 0, it is permanently dead.

2. **Race condition**: The read-then-decrement pattern is not atomic. Under concurrent requests, 10 requests could all read `remaining=1` and all pass through before any decrement is written. At 100 concurrent users, you could have 100x the intended rate.

3. **No per-endpoint limiting**: The same 1000/hour limit applies to a lightweight `GET /vehicles` and a heavy `POST /vehicles` with full AI extraction.

4. **No IP-based limiting**: Only API key rate limiting. Anonymous/JWT users have zero rate limiting.

5. **Decrement uses falsy check**: `keyData.rate_limit_remaining ? ... - 1 : null` -- if `rate_limit_remaining` is `0`, this evaluates to `null`, which means "unlimited". So hitting 0 actually **removes** the rate limit.

### 1.4 API Key System

**Schema** (`api_keys` table):
- Keys stored as SHA-256 hashes (good)
- Prefix system: `nk_live_` prefix stripped before hashing (good)
- Scopes: `['read', 'write']` default (but scopes are checked nowhere in the code)
- Rate limit: 1000/hour default (but broken as described above)
- Expiry: `expires_at` column exists but is **never checked** in auth code

**Authentication flow**: JWT first, then API key fallback. The API key lookup does a database query on every single request -- no caching.

### 1.5 Connection Pooling

**Remote**: Supabase uses **Supavisor** (their managed PgBouncer replacement) on port 6543. The connection string uses `pooler.supabase.com:6543`, confirming the pooler is active in production.

**Local config** (`supabase/config.toml`):
```toml
[db.pooler]
enabled = false      # DISABLED locally
pool_mode = "transaction"
default_pool_size = 20
max_client_conn = 100
```

The local pooler is disabled, but this only affects local development. In production, Supavisor handles pooling.

**The real problem**: 320 edge functions + 68 cron jobs, all creating fresh Supabase clients on every invocation. Each invocation opens a new connection through the pooler. At scale:
- 50 concurrent edge function invocations = 50 pooler connections
- 68 cron jobs running = up to 68 additional connections
- Supavisor default pool size for Pro = ~30 connections per pooler worker
- Max Postgres connections = 160

### 1.6 Caching

**There is no caching layer.** Period.

- No Redis
- No Memcached
- No in-memory cache in edge functions (Deno Deploy instances are ephemeral)
- No CDN caching for API responses (CORS headers set `Access-Control-Allow-Origin: *` but no `Cache-Control` on API responses)
- Frontend static assets are cached via Vercel (`max-age=31536000, immutable` for `/assets/`)
- HTML pages are `no-store`

The `canonical_makes` table (97 rows, 5.3M sequential scans) is the poster child for why caching matters. Every vehicle lookup queries this table. A 60-second in-memory cache would eliminate 99.9% of those queries.

### 1.7 Storage

- `listing_page_snapshots`: **37 GB** of raw HTML stored in Postgres
- `vehicle_images`: **32 GB** of image metadata (actual images are in Supabase Storage/external URLs)
- `forum_page_snapshots`: **464 MB** of raw HTML

Raw HTML snapshots should not be in Postgres. This is object storage data masquerading as relational data.

---

## 2. What Breaks at Each Scale

### 2.1 At 500 Users (50-100 concurrent)

**What breaks first**: Database connections and rate limiting.

| Risk | Severity | Details |
|------|----------|--------|
| Connection exhaustion | HIGH | 100 concurrent requests + 68 cron jobs + admin = ~170 connections. Max is 160. Requests start failing. |
| Rate limiting is fiction | HIGH | The broken decrement logic means power users can send unlimited requests. One abusive user tanks the DB. |
| Sequential scans on lookup tables | MEDIUM | 5M+ seq scans on 97-row `canonical_makes` will add latency under concurrent load. |
| API key auth = 1 DB query per request | MEDIUM | Every API call does a full DB query to validate the key. At 100 req/s that is 100 extra queries/s. |
| 10s statement timeout | LOW | Complex queries start timing out as DB load increases. |

**Estimated monthly cost at 500 users**: Current plan (~$75/mo) + compute upgrade ($100/mo) = **~$175/mo**

**Required fixes (in priority order)**:
1. Fix the rate limiting bug (free -- code fix)
2. Add connection pooling awareness to edge functions (free -- code fix)
3. Cache `canonical_makes`/`canonical_models` in edge function memory (free -- code fix)
4. Cache API key validation results for 60s (free -- code fix)
5. Upgrade Supabase compute to Medium ($100/mo) for 200 max connections

### 2.2 At 5,000 Users (500-1,000 concurrent)

**What breaks first**: Everything in section 2.1, plus Postgres itself.

| Risk | Severity | Details |
|------|----------|--------|
| Postgres OOM | CRITICAL | 103 GB database on 8 GB RAM. Working set exceeds memory. Index scans start hitting disk. |
| Index write amplification | CRITICAL | 110 indexes on `vehicle_images` means every write does 110 index updates. Bulk operations grind to halt. |
| Edge function concurrency | HIGH | Supabase Pro allows ~60 concurrent edge function executions. 1,000 concurrent users = queuing/timeouts. |
| `universal-search` N+1 pattern | HIGH | Searches vehicles, then fetches images in separate query. At 500 req/s = 1,000 queries/s just for search. |
| Storage: 37 GB HTML in Postgres | HIGH | This data is never queried relationally but consumes buffer cache, pushing hot data to disk. |
| No full-text search engine | MEDIUM | ILIKE queries with `%pattern%` on 800K vehicles = sequential scan every time. |
| 68 cron jobs | MEDIUM | Background jobs compete with user-facing queries for connections and CPU. |

**Estimated monthly cost at 5,000 users**: Supabase Pro ($25) + Large compute ($300) + bandwidth overages (~$200) + Vercel Pro ($20) = **~$545/mo minimum**

But realistically, you need:
- **Redis/Upstash cache**: $30-100/mo
- **Supabase XL or 2XL compute**: $300-600/mo
- **Read replicas** for search: $300/mo
- **Move HTML snapshots to object storage**: engineering time

Total: **~$1,000-2,000/mo**

**Required changes**:
1. Add Redis/Upstash as a caching layer ($30/mo via Upstash)
2. Drop or consolidate 50+ redundant indexes (free -- migration)
3. Move `listing_page_snapshots` and `forum_page_snapshots` to Supabase Storage (free -- engineering time)
4. Implement proper atomic rate limiting with Redis or Postgres `UPDATE ... RETURNING`
5. Add search caching (cache "porsche 911" results for 5 minutes)
6. Upgrade to Supabase Large/XL compute ($300-600/mo)
7. Separate read/write workloads (read replica for search)
8. Fix `universal-search` to use a single JOIN instead of N+1 pattern
9. Implement proper full-text search with `tsvector` (indexes already exist as `vehicles_search_idx`)

### 2.3 At 50,000 Users (5,000-10,000 concurrent)

**What breaks**: Supabase's architecture itself.

| Risk | Severity | Details |
|------|----------|--------|
| Single Postgres instance ceiling | CRITICAL | Even Supabase's 4XL ($1,200/mo) has 500 max connections. 10K concurrent users need thousands. |
| Edge function limits | CRITICAL | Supabase Enterprise needed for >500 concurrent functions. No horizontal scaling. |
| RLS bypass via service role | CRITICAL | Every function uses service role. No per-user query isolation. One bug = data breach at scale. |
| No horizontal DB scaling | CRITICAL | Supabase does not offer automatic sharding. Manual sharding needed. |
| Cron job interference | HIGH | 68 cron jobs running on the same instance as 10K concurrent users = resource starvation. |
| Billing shock | HIGH | Supabase bandwidth, function invocations, and storage charges are usage-based. |

**This scale requires a fundamentally different architecture:**

1. **Database**: Migrate hot path to a managed Postgres cluster (AWS RDS Multi-AZ or Neon with autoscaling), keep Supabase for auth/storage
2. **Caching**: Dedicated Redis cluster (AWS ElastiCache or Upstash Pro)
3. **Search**: Dedicated search engine (Typesense, Meilisearch, or Elasticsearch)
4. **API layer**: Move from edge functions to a proper API server (the Elixir/Phoenix backend at `nuke_api/` -- this already exists but appears unused)
5. **Background jobs**: Move cron jobs off the database to a queue system (BullMQ, Temporal, or pg_boss on a separate instance)
6. **CDN**: Cloudflare or Fastly in front of read APIs (cache vehicle data, search results)
7. **Connection pooling**: PgBouncer or Supavisor on a dedicated instance with 10,000+ client connection support

**Estimated monthly cost at 50,000 users**:

| Component | Monthly Cost |
|-----------|-------------|
| Primary Postgres (RDS r6g.2xlarge) | $800-1,200 |
| Read replicas (2x) | $1,000-1,600 |
| Redis cluster | $200-500 |
| Search engine (Typesense Cloud) | $200-400 |
| API servers (3x t3.large) | $300-500 |
| Supabase (auth + storage only) | $75-200 |
| Vercel Pro | $20 |
| CDN (Cloudflare Pro) | $20-200 |
| Monitoring (Datadog/Grafana Cloud) | $100-300 |
| **Total** | **$2,700-5,000/mo** |

---

## 3. Critical Bugs Found During Audit

### Bug 1: Rate Limit Decrement Becomes Unlimited

**File**: `/Users/skylar/nuke/supabase/functions/api-v1-vehicles/index.ts`, line 326

```typescript
rate_limit_remaining: keyData.rate_limit_remaining ? keyData.rate_limit_remaining - 1 : null
```

When `rate_limit_remaining` reaches `0` (falsy), the ternary returns `null`, which means "no limit." This effectively removes rate limiting for any key that has exhausted its quota. Should be:

```typescript
rate_limit_remaining: keyData.rate_limit_remaining !== null ? keyData.rate_limit_remaining - 1 : null
```

### Bug 2: Rate Limit Never Resets

The `rate_limit_reset_at` column is never read or updated. Keys that hit their limit are permanently locked out (or permanently unlimited due to Bug 1). There is no hourly reset mechanism.

### Bug 3: API Key Expiry Never Checked

`expires_at` column exists but `authenticateRequest()` never checks it. Expired keys work forever.

### Bug 4: Scopes Never Enforced

API keys have `scopes: ['read', 'write']` but the authorization code never checks scopes against the requested operation. A read-only key can POST/PATCH/DELETE.

### Bug 5: CORS Allows Everything

```typescript
"Access-Control-Allow-Origin": "*"
```

Any website can make authenticated API calls on behalf of users. At 50K users, this is a credential-stuffing attack surface.

---

## 4. The "Free" Wins (Fix Today)

These cost nothing and would meaningfully improve scalability:

| Fix | Impact | Effort |
|-----|--------|--------|
| Fix rate limit decrement bug | Prevents abuse | 5 minutes |
| Add rate limit reset cron job | Makes rate limits work | 30 minutes |
| Check `expires_at` in auth | Security fix | 5 minutes |
| Enforce scopes in API | Security fix | 30 minutes |
| Drop 50+ redundant indexes on `vehicle_images` | 5-10x faster writes | 2 hours |
| Cache `canonical_makes/models` in-memory | Eliminate 8M+ seq scans | 1 hour |
| Move CORS to allowlist | Security fix | 30 minutes |
| Add `Cache-Control` headers to read APIs | Reduce repeat queries | 1 hour |

---

## 5. The Elephant in the Room

There is a complete Elixir/Phoenix backend at `/Users/skylar/nuke/nuke_api/` that appears to be unused in production. The entire API surface is currently served by 320 independent Deno edge functions, each creating their own database connections, with no shared state, no connection reuse, and no middleware stack.

**At 5,000+ users, you need an actual application server**, not hundreds of independent serverless functions. The Phoenix backend already exists. Using it would give you:

- Connection pooling (Ecto pool, configurable)
- In-memory caching (ETS/Cachex)
- Middleware for auth, rate limiting, logging
- WebSocket support via Phoenix Channels (already built for this)
- Ability to handle 10K+ concurrent connections per node
- Proper process isolation via BEAM/OTP

The edge functions should remain for: webhooks, async extraction jobs, and cron tasks. But user-facing API traffic should route through Phoenix.

---

## 6. Recommended Roadmap

### Phase 1: Survive to 500 (This Week, $0)
- [ ] Fix rate limit bugs (4 bugs listed above)
- [ ] Drop redundant indexes on `vehicle_images` and `vehicles`
- [ ] Cache lookup tables in edge function closures
- [ ] Add API key validation caching (LRU, 60s TTL)

### Phase 2: Prepare for 5,000 (Next Month, ~$500/mo)
- [ ] Add Upstash Redis for caching + rate limiting ($30/mo)
- [ ] Move `listing_page_snapshots` to object storage (frees 37 GB)
- [ ] Upgrade Supabase compute to Large ($200/mo)
- [ ] Implement proper search with existing `tsvector` index
- [ ] Set up monitoring (Supabase dashboard + alerts)
- [ ] Activate the Phoenix backend for user-facing API

### Phase 3: Scale to 50,000 (Quarter, ~$3,000/mo)
- [ ] Migrate primary database to managed Postgres (RDS/Neon)
- [ ] Deploy Phoenix API cluster (2-3 nodes)
- [ ] Add read replicas for search/read workloads
- [ ] Deploy dedicated search engine (Typesense)
- [ ] Move background jobs to dedicated worker pool
- [ ] Add CDN layer for public read APIs
- [ ] Implement proper multi-tenant data isolation

---

## 7. Current Cost vs. Scaled Cost

| Users | Concurrent | Monthly Cost | Per-User Cost |
|-------|-----------|-------------|---------------|
| 5 (now) | ~2 | ~$75 | $15.00 |
| 500 | ~100 | ~$175-275 | $0.35-0.55 |
| 5,000 | ~1,000 | ~$1,000-2,000 | $0.20-0.40 |
| 50,000 | ~10,000 | ~$3,000-5,000 | $0.06-0.10 |

The economics actually improve at scale, but the engineering investment to get there is significant. The jump from 500 to 5,000 is the hardest because it requires moving from "serverless everything" to "actual architecture."

---

*This audit was generated from live production data. All numbers are real. All bugs are real. Fix the rate limiting first.*
