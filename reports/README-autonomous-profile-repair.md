# Autonomous profile repair loop (7h)

Fixes vehicle profiles: **wrong lead image** (BaT UI assets as primary) and **missing VIN** (backfill from metadata or re-extract).

## Run for 7 hours (overnight)

From repo root (`nuke/`):

```bash
npx tsx scripts/autonomous-profile-repair-loop.ts --hours 7
```

Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (e.g. in `nuke_frontend/.env.local`).

## Options

- `--hours 7` — run for 7 hours (default)
- `--batch 30` — vehicles per batch (default 25)
- `--delay-ms 3000` — delay between vehicles in ms (default 2500)
- `--dry-run` — no DB writes, only log what would be done
- `--skip-reextract` — do not call bat-simple-extract for missing VIN (fewer BaT requests)

## Feedback

- **Report file**: `reports/autonomous-profile-repair-YYYY-MM-DD.json`  
  Updated every 5 minutes with: `vehiclesProcessed`, `galleryRepairs`, `vinBackfilledFromMetadata`, `vinReextractInvoked`, `errors`, `elapsedHours`.
- **Console**: Progress line every 5 min, e.g.  
  `[autonomous-profile-repair] 1.23h | processed=120 repairs=98 vinMeta=5 vinReextract=2 errors=0`

## What it does each loop

1. Fetches a batch of `bat_import` vehicles that have `vehicle_images` (oldest `updated_at` first).
2. For each vehicle:
   - Calls `repair_bat_vehicle_gallery_images(id)` (fixes wrong primary, marks UI assets as duplicate).
   - Backfills `vehicles.vin` from `origin_metadata.vin` when present.
3. Optionally invokes `bat-simple-extract` for a few vehicles with `discovery_url` but no VIN (rate-limited).

When you wake up, check `reports/autonomous-profile-repair-<today>.json` for the final counts and any `errors`.
