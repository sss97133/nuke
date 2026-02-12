# ACTIVE AGENTS - Updated 2026-02-12 7:35 PM

## BACKGROUND JOBS RUNNING

### Multi-Domain Queue Drain v3 — ACTIVE
- **Started**: 2026-02-12 6:28 PM AST (primary), 7:34 PM (boost2)
- **Workers**: 15 parallel drain processes (3 scripts + 1 standalone)
- **Scripts**: `/tmp/drain-final.sh` (4), `/tmp/drain-boost.sh` (3), `/tmp/drain-boost2.sh` (7), `/tmp/drain-ebay.sh` (1)
- **Edge function max runtime**: 60s per call (Supabase timeout ~120s)

| Source | Workers | Pending (~) | Rate | Logs |
|--------|---------|-------------|------|------|
| Bonhams | 4 | ~73k | ~600/hr | `drain-final-bonhams`, `drain-boost-bonhams-{2,3}`, `drain-boost2-bonhams-{4,5}` |
| PCarMarket | 4 | ~20k | ~140/hr | `drain-final-pcarmarket`, `drain-boost-pcarmarket-2`, `drain-boost2-pcarmarket-{3,4}` |
| Broad Arrow | 1 | ~1.1k | ~170/hr | `drain-final-broadarrow` |
| Barrett-Jackson | 1 | ~1k | ~42/hr (Firecrawl timeouts) | `drain-final-barrettjackson` |
| BaT | 2 | ~5.4k | ~420/hr | `drain-boost2-bat-{1,2}` |
| Cars & Bids | 1 | ~40 | finishing | `drain-boost2-carsandbids-1` |
| eBay | 1 | ~177 | new | `drain-ebay.log` |

All logs in `/tmp/drain-*.log`
- **Kill all**: `ps aux | grep drain | grep -v grep | awk '{print $2}' | xargs kill`
- **Status**: `for f in /tmp/drain-final-*.log /tmp/drain-boost-*.log /tmp/drain-boost2-*.log; do echo "--- $(basename $f) ---"; tail -2 $f; done`

---

## COMPLETED THIS SESSION

### Infrastructure Improvements
- **Created `claim_import_queue_batch_by_source_id`** — indexed claim function using source_id instead of LIKE pattern scan. 10-100x faster claiming on 440k+ row table
- **Created partial index** `idx_import_queue_source_status` on `(source_id, status, attempts, next_attempt_at, locked_at) WHERE status = 'pending'`
- **Updated `continuous-queue-processor`** — tries fast source_id claim first, falls back to LIKE pattern for items with NULL source_id
- **Backfilled source_id** for Barrett-Jackson (3,151 items) and Broad Arrow (1,442 items) that had NULL source_id
- **Added eBay source config** to continuous-queue-processor + detectSource
- **Committed & deployed** updated continuous-queue-processor

### PCarMarket Fixes
- **Fixed `[object Object]` error serialization** in import-pcarmarket-listing/index.ts — Supabase error objects now properly serialized
- **Improved duplicate discovery_url handler** — uses exact eq match (fast unique index) before ILIKE fallback
- **Added error logging** to vehicle lookup queries (timeout detection)
- **Deployed** import-pcarmarket-listing

### Queue Triage
- Reset 4,313 failed items → pending (BaT 1,190, Bonhams 3,066, other 57)
- Reset 84,407 pending items with maxed-out attempts back to 0
- Reset 5,447 stuck processing items → pending
- Reset 15 PCarMarket `[object Object]` failures for retry with fixed code
- Reset 177 eBay items with stale attempt counts

### Queue Status (~7:35 PM)
- Drains running across all major domains
- Total workers: 15 concurrent
- Completed this session: ~2,500+

---

## WHAT NEXT AGENT SHOULD DO

1. **Monitor drains**: Check logs, restart if workers die
2. **Scale assessment**: With 15 workers, watch for edge function timeouts or rate limits
3. **Barrett-Jackson**: Consider adding direct fetch fallback to avoid Firecrawl timeout dependency
4. **Fix Playwright failures**: KSL (40), Classic.com (39) — need non-Playwright extractors
5. **Bonhams 64k skipped**: Investigate why 64k items are skipped — may be recoverable
6. **Contract station**: Wire curator profile links, test with real data
7. **Commit all changes**: PCarMarket fix + eBay config not yet committed

---

## Coordination Rules
- Check this file before editing shared files
- One agent per edge function at a time
- Git: descriptive commit messages, no force push
- Database: no destructive operations (DROP, TRUNCATE)
