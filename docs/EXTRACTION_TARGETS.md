# Extraction targets

**Single source of truth for what we're aiming at.** Check this (and current counts) before turning on long-running extraction or cron.

## Defined targets (code)

| Source        | Metric           | Target    | Where defined                          |
|---------------|------------------|-----------|----------------------------------------|
| **BaT**       | bat_listings     | **222,000** | `supabase/functions/org-extraction-coverage/index.ts` |
| **BaT**       | queue pending    | **0** (clear backlog) | EXTRACTION_STATUS.md intent            |
| **C&B**       | —                | *none*    | org-extraction-coverage has `target: null` |
| **PCarMarket**| —                | *none*    | same                                    |
| **Craigslist**| —                | *none*    | same                                    |
| **Classic.com** | —              | *none*    | same                                    |
| **Barn Finds**  | —              | *none*    | discovery + extractor wired; no org target yet |

## Live auction monitoring (doc)

- **Target:** 800+ listings monitored (BaT, C&B, PCarMarket, Collecting Cars, SBX, etc.)
- See EXTRACTION_STATUS.md “Live Auction Monitoring”.

## How to check before running tools

1. **Current vs target (BaT):**
   - `bat_listings` count vs 222,000
   - `import_queue` pending for `%bringatrailer%` vs 0
2. **Run the status script** that compares to these targets (see below).
3. **Decide what to run:**
   - If BaT pending is high → verified extraction (Playwright) is on-target.
   - If BaT pending is 0 and bat_listings &lt; 222k → need discovery + extraction, not just “run for N hours.”
   - If only C&B/PCarMarket/Collecting Cars pending → those need Firecrawl or Playwright; don’t burn Firecrawl without a clear target.

## Script: print current vs targets

Run before starting verified extraction or cron:

```bash
npm run status:targets
# or
./scripts/status-targets.sh
```

This should output: BaT extracted (bat_listings), BaT pending, target 222k, and optionally other sources’ pending so we’re not “just turning on tools” without looking.
