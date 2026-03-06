# Handoff — 2026-03-06

## What I Was Working On
Tesla market analysis from the CLI (ad-hoc queries against Supabase), which led to a data quality audit of the entire vehicles table, which led to a plan to clean up 504K duplicate stub rows.

## What's Complete
1. **Tesla market analysis** — full breakdown of 309 sold Teslas: by-model, market curve, depreciation, bid velocity, sentiment, late surge analysis. All done via ad-hoc SQL queries.

2. **Vehicle profile quality audit** — honest metrics established:
   - 1.29M raw rows → 750K live (after removing 540K junk)
   - 102K complete profiles (YMM+price+VIN), 280K priced, 678K queryable
   - 162K "rich" profiles (8+ of 10 key fields filled)

3. **Duplicate root cause identified** — 504K `status='duplicate'` rows are BaT comment-page scrape artifacts. Each comment scrape created a new vehicle row with just year/make/model/sale_price. No VIN, no URL, no description. The 1983 Countach appears 364 times. Zero have `merged_into_vehicle_id`.

4. **Perplexity prompt written** — `prompts/perplexity-cli-data-terminal.md` — comprehensive research prompt for building a Bloomberg-style NL-to-SQL CLI tool. Uses real schema dimensions.

## What's Next — Duplicate Collapse Migration

The big pending task: **collapse 504K duplicate stubs into observation counts, then delete.**

### Designed approach:
1. **Build temp table** of dupe clusters: GROUP BY (year, make, model, sale_price, auction_source) → find canonical `active` record for each cluster
2. **Write observation counts** to `vehicle_observations` for each canonical vehicle (e.g., "this vehicle was observed 364 times on BaT")
3. **Update canonical vehicles** — set `comment_count` or a new `observation_count` field from the cluster size
4. **Batch-delete** the 504K stubs (1000 at a time with pg_sleep per BATCHED MIGRATION PRINCIPLE)

### Key facts for next agent:
- 447K of the dupes are from BaT, 445K have sale_price, only 962 have VIN
- ~40% of clusters have an `active` match already; ~60% don't (the "active" record may have slightly different model text)
- FK constraints are mostly CASCADE — deleting vehicles auto-deletes child rows
- The `merged_into_vehicle_id` column exists but is NULL on all 504K dupes
- This is a PRODUCTION database — follow batched migration principle strictly

### Also pending:
- User wants to actually **use** the Perplexity prompt to research and then **build** the CLI data terminal
- The audit revealed 69K "skeleton" rows (no make or year) in live status that should also be addressed

## Uncommitted Changes (from other agents)
- mcp-server
- nuke_frontend/src/feed/components/ (FeedLayout, FeedPage, FeedToolbar, VehicleCard, CardRankScore)
- nuke_frontend/src/feed/hooks/useFeedSearchParams.ts
- nuke_frontend/src/feed/index.ts, types/feed.ts, utils/feedUrlCodec.ts
- scripts/fb-scrape-saved.ts
- supabase/functions/feed-query/index.ts

## Files Changed This Session
- `DONE.md` — appended 2026-03-06 entries (analysis, data-quality audit, prompt)
- `prompts/perplexity-cli-data-terminal.md` — NEW, Perplexity research prompt
- `.claude/HANDOFF.md` — this file
