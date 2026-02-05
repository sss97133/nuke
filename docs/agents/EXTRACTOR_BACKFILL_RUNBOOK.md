# Extractor Backfill / Repair Runbook (Agents)

When asked to "get agents on it," "keep working," or "backfill/repair extractors," run these tasks.

## 1. Gooding chunked backfill

Repairs all Gooding lots (chassis, coachwork, estimate, calendar, SRA, full highlights/specs). Run in chunks to avoid client timeouts.

```bash
cd /Users/skylar/nuke

# Run 5 chunks of 20 lots (100 lots total)
npx tsx scripts/backfill-gooding-now.ts --batch 20 --chunks 5

# Run more: 10 chunks = 200 lots
npx tsx scripts/backfill-gooding-now.ts --batch 20 --chunks 10

# Continue from offset (e.g. after 200 already done)
npx tsx scripts/backfill-gooding-now.ts --batch 20 --chunks 10 --offset 200
```

- Sitemap has ~9k lots. To repair "all," run many chunks (e.g. `--chunks 450` for 9000) or schedule via cron.
- Each chunk takes ~30–60s; leave 2s pause between chunks.

## 2. Other extractors (already fixed)

These are deployed with shared resolver (no duplicate discovery_url). Re-extraction is on-demand or via process-import-queue:

- **Bonhams** – POST `extract-bonhams` with URL or batch
- **BH Auction** – POST `extract-bh-auction` with URL or batch
- **Historics UK** – POST `extract-historics-uk` with URL
- **RM Sothebys** – POST `extract-rmsothebys` with action list/process
- **Import Classic Auction** – triggered by import queue / classic.com URLs

No dedicated backfill script for these; use platform discovery + single-URL or batch as needed.

## 3. Checklist for any new/changed extractor

See `supabase/functions/_shared/EXTRACTOR_QUALITY_CHECKLIST.md` and `.cursor/rules/extractor-quality.mdc`:

- Use `resolveExistingVehicleId` before insert (listing → discovery_url exact → URL pattern).
- Chassis as VIN for classics; capture estimate, calendar position, coachwork, SRA, full highlights/specs where source has them.

## 4. Quick status

```bash
# Gooding single-lot test (Ferrari)
npx tsx scripts/backfill-gooding-now.ts --single

# Gooding batch (small)
npx tsx scripts/backfill-gooding-now.ts --batch 10 --chunks 2
```
