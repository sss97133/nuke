# Extraction targets

**Single source of truth for what we're aiming at.** Check this (and current counts) before turning on long-running extraction or cron.

## Defined targets (code)

| Source        | Metric           | Target    | Where defined                          |
|---------------|------------------|-----------|----------------------------------------|
| **BaT**       | vehicle_events (source_platform='bat') | **222,000** | `supabase/functions/org-extraction-coverage/index.ts` |
| **BaT**       | queue pending    | **0** (clear backlog) | EXTRACTION_STATUS.md intent            |
| **C&B**       | —                | *none*    | org-extraction-coverage has `target: null` |
| **PCarMarket**| —                | *none*    | same                                    |
| **Craigslist**| —                | *none*    | same                                    |
| **Classic.com** | —              | *none*    | same                                    |
| **Barn Finds**  | —              | *none*    | discovery + extractor wired; no org target yet |

## Accuracy (gold standard)

Volume targets say nothing about whether a writer got the lot right. Every extractor is graded against
`scripts/assays/extraction-gold-v1.json`: at least three lots per house (sold, not sold, live or upcoming), each
field read by hand from the house's own page and pinned to its evidence. Run the grader before trusting or
re-running an extractor, and after changing one:

```bash
cd ~/nuke && dotenvx run -q -- node scripts/assays/extraction-gold.mjs            # all houses
cd ~/nuke && dotenvx run -q -- node scripts/assays/extraction-gold.mjs --house mecum
```

It prints per-lot, per-field verdicts (pass / wrong value held / missing / stale) and a per-house scorecard.
Spend on history only after a house's extractor passes its gold lots and a cheaper path is ruled out.

## Live auction monitoring (doc)

- **Target:** 800+ listings monitored (BaT, C&B, PCarMarket, Collecting Cars, SBX, etc.)
- See EXTRACTION_STATUS.md “Live Auction Monitoring”.

## How to check before running tools

1. **Current vs target (BaT):**
   - `vehicle_events` count (where `source_platform='bat'`) vs 222,000
   - `import_queue` pending for `%bringatrailer%` vs 0
2. **Run the status script** that compares to these targets (see below).
3. **Decide what to run:**
   - If BaT pending is high → verified extraction (Playwright) is on-target.
   - If BaT pending is 0 and vehicle_events (bat) &lt; 222k → need discovery + extraction, not just “run for N hours.”
   - If only C&B/PCarMarket/Collecting Cars pending → those need Firecrawl or Playwright; don’t burn Firecrawl without a clear target: the target and its monthly credits come from `firecrawl_target_allocation`, and a spender asks `firecrawl_allowance(source)` first (spec: `docs/ledger/theory/extraction.md`, “Spending Firecrawl”).

## Script: print current vs targets

Run before starting verified extraction or cron:

```bash
npm run status:targets
# or
./scripts/status-targets.sh
```

This should output: BaT extracted (vehicle_events where source_platform=’bat’), BaT pending, target 222k, and optionally other sources’ pending so we’re not “just turning on tools” without looking.
