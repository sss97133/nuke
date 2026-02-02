# Run Major Extraction (Targets Listed)

Finish the extraction effort on the targets from [EXTRACTION_SOURCES_INVENTORY](../../.claude/EXTRACTION_SOURCES_INVENTORY.md). Use **cautious but consistent** batch sizes and rate.

## Targets (as of 2026-02-01)

| Source        | Pending | Extractor / Path              | Notes                    |
|---------------|---------|-------------------------------|--------------------------|
| Bring a Trailer | ~77k  | `process-import-queue` → `complete-bat-import` | No AI, no Firecrawl      |
| Craigslist    | ~539    | `process-import-queue`        | Inline CL parsing        |
| Classic.com   | ~10     | `process-import-queue`        | Route by URL             |

All of these are processed by **`process-import-queue`** (it routes BaT to `complete-bat-import`, Craigslist inline, etc.).

## How to run (cautious but consistent)

### Option 0: Finite “finish up” pass (recommended first)

Run a fixed number of rounds with a small batch size (default 20 per batch, 50 rounds, 15s pause):

```bash
cd /Users/skylar/nuke
./scripts/run-major-extraction.sh
```

Tune with env vars:

```bash
BATCH=10 MAX_BATCHES=100 PAUSE_SEC=20 ./scripts/run-major-extraction.sh
```

### Option A: Continuous loop (run until queue empty)

From repo root, with `.env` or `.env.local` loaded (`VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`):

```bash
# Cautious: 5 items per call, 3 parallel workers, 10s between rounds
./scripts/extract-loop.sh
```

To tune: edit `scripts/extract-loop.sh` — `BATCH=50` and `WORKERS=3`. For more cautious: `BATCH=10` or `20`, `WORKERS=1` or `2`.

### Option B: One-off batches (manual control)

```bash
cd /Users/skylar/nuke
source .env 2>/dev/null || true

# Single batch (e.g. 20 items)
curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/process-import-queue" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 20}'

# Run N batches with a pause (e.g. 10 batches of 20 = 200 items)
for i in $(seq 1 10); do
  echo "Batch $i"
  curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/process-import-queue" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"batch_size": 20}'
  sleep 15
done
```

### Option C: BaT-only queue (alternative path)

If you want to drive only BaT via the dedicated orchestrator:

- `scripts/bat-process-queue.ts` calls `extract-bat-core` per URL (not `complete-bat-import`).  
- For the “official” BaT path (complete-bat-import + comments), use **Option A or B** so `process-import-queue` routes BaT URLs to `complete-bat-import`.

## Check progress

```bash
# Pending count
psql "$DATABASE_URL" -t -c "SELECT status, COUNT(*) FROM import_queue GROUP BY status;"

# Or use Supabase dashboard: import_queue table, filter status = 'pending'
```

## Facebook Marketplace (separate pipeline)

Facebook is **not** in the import_queue; it uses the marketplace monitor. Config and monitor are set to **vehicles older than 1992 only** (maxYear=1991, plus title filter in monitor). See `scripts/marketplace-monitor/config.ts` and `scripts/marketplace-monitor/monitor.ts`.

To run the Facebook monitor (browse + save listings ≤ 1991):

```bash
cd /Users/skylar/nuke/scripts/marketplace-monitor
npx tsx monitor.ts
```

(Requires Chrome and optional Facebook login in the persistent session.)
