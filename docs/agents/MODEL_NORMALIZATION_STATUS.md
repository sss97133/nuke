# Model Normalization Status

> **Started:** 2026-02-06 8:45 AM PST
> **Process:** PID 61418 (nohup, will survive terminal close)
> **Script:** `scripts/normalize-models-psql.sh`
> **Log:** `reports/normalize-models-psql-run2.log`

## Status: RUNNING - Processing 1,068 makes

### Progress (as of ~8:53 AM PST)

| # | Make | Records Normalized | Status |
|---|------|-------------------|--------|
| 1 | Chevrolet (33,610) | ~17,000 (from earlier run) | ✅ Done |
| 2 | Ford (26,229) | ~12,000 (from earlier run) | ✅ Done |
| 3 | Porsche (22,140) | 191 | ✅ Done |
| 4 | Mercedes-Benz (17,082) | 228 | ✅ Done |
| 5 | BMW (15,985) | skipped (already clean?) | ✅ Done |
| 6 | Honda (5,422) | skipped | ✅ Done |
| 7 | Toyota (9,839) | 25 | ✅ Done |
| 8 | Dodge (5,447) | 1,835 | ✅ Done |
| 9 | Cadillac (3,678) | 2,644 | ✅ Done |
| 10 | Jaguar (4,331) | 82 | ✅ Done |
| 11 | Ferrari (4,622) | 76 | ✅ Done |
| 12 | Volkswagen (5,228) | 1,176 | ✅ Done |
| 13-1068 | Remaining makes | ... | ⏳ Processing |

## What the Script Does

For each make (1,068 total with 5+ vehicles):
1. Groups all models by `lower(model)` to find case variants
2. Uses `mode()` to pick the most common casing as canonical
3. Updates all variants to match in a single UPDATE per make
4. Logs the count of normalized records

## Approach

Uses direct `psql` connection (not REST API) to avoid statement timeouts.
Each make gets its own UPDATE with 90s timeout -- handles even the largest makes (Chevrolet 33k).

## How to Monitor

```bash
tail -f /Users/skylar/nuke/reports/normalize-models-psql-run2.log
ps -p 61418 -o pid,stat,etime  # Check if alive
```

## How to Resume if Process Dies

```bash
cd /Users/skylar/nuke
dotenvx run -- ./scripts/normalize-models-psql.sh
# It's idempotent - skips already-normalized makes (0 updates)
```

## Other Active Data Quality Work

- `backfill-make-model-from-urls.ts` completed 1,251 empty-make fixes
- `autonomous-profile-repair-loop.ts` ran for BaT image/VIN repairs
- 1,561 CL cross-post duplicates merged
- 4,911 motorcycles separated from car feed
- ~500 junk records cleaned
- Server-side DB filtering deployed to production
- Model selector normalized in frontend (deployed)
