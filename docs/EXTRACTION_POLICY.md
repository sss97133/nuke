# Extraction policy: conserve Firecrawl, prefer local verified runs

## Rule: no sloppy Firecrawl usage

- **Do not** use Firecrawl for one-off or exploratory scrapes.
- **Do not** call edge functions that use Firecrawl from cron or long-running scripts unless explicitly required and rate-limited.
- **Prefer** local Playwright extraction for import_queue processing (no API credits).
- Use Firecrawl **only** when:
  - A source requires JS rendering and cannot be handled by local Playwright, and
  - The URL is validated (e.g. not already in vehicles, not duplicate), and
  - Runs are rate-limited and quality-checked (e.g. post-extract validation).

## Long-running extraction on this machine

- **Verified extraction** = Playwright-only, no Firecrawl, no OpenAI. Runs for several hours via cron.
- Script: `scripts/verified-extraction-run.sh` (wrapped by `scripts/cron-verified-extraction.sh`).
- Optional `VERIFIED_SOURCES_ONLY=1`: only process BaT, Hagerty, KSL (highest quality, no Cloudflare-heavy sites).
- Cron should run `cron-verified-extraction.sh` (e.g. nightly) so this computer does the work instead of burning Firecrawl credits in the cloud.

### Crontab (run on this computer)

```bash
# Install: run once
crontab -e

# Add one of these lines (adjust path if needed):

# Nightly at 2am: 6-hour verified run (BaT, Hagerty, KSL only)
0 2 * * * /Users/skylar/nuke/scripts/cron-verified-extraction.sh >> /Users/skylar/nuke/logs/cron-verified-extraction.log 2>&1

# Same with explicit env
0 2 * * * VERIFIED_SOURCES_ONLY=1 HOURS=6 /Users/skylar/nuke/scripts/cron-verified-extraction.sh >> /Users/skylar/nuke/logs/cron-verified-extraction.log 2>&1
```

### Manual runs

```bash
# 6-hour run, all Playwright sources
npm run extract:verified
# or
./scripts/verified-extraction-run.sh 6

# 6-hour run, only BaT + Hagerty + KSL (verified sources)
VERIFIED_SOURCES_ONLY=1 ./scripts/verified-extraction-run.sh 6
```

## What uses Firecrawl (avoid in batch/cron)

- sync-live-auctions (C&B, PCarMarket, Mecum, etc.)
- extract-facebook-marketplace
- extract-bonhams (optional), extract-historics-uk (optional)
- extract-using-catalog, import-classic-auction
- niche-builder-extractor, backfill-broadarrow-full
- smart-queue-worker.sh when it routes to extract-vehicle-data-ai / extract-cars-and-bids-core / import-pcarmarket-listing

For batch processing import_queue, use **Playwright** (autonomous-playwright-extractor, playwright-single-worker, run-playwright-queue) so no Firecrawl credits are spent.
