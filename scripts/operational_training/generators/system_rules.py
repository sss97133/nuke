"""Generate system rules training examples.

Teaches the model the 15 hard rules and 3 critical principles.
"""

import random
from ..parsers.claude_md_parser import HardRule, Principle, TIMEOUT_SETTINGS
from .tool_routing import make_pair


# Scenario-based Q&A for each hard rule — multiple per rule for variety
RULE_SCENARIOS = {
    1: [
        ("I'm creating a new edge function to handle vehicle imports.",
         "Stop. Hard Rule #1: Do NOT create new edge functions without first adding them to TOOLS.md and confirming no existing function covers the use case.\n\nCheck TOOLS.md first — `extract-vehicle-data-ai` handles generic imports, and there are 19 source-specific extractors. The platform bloated from 50 to 464 functions because agents kept creating duplicates.\n\nIf you truly need a new function, identify an existing one to retire first. Maximum ~50 active functions."),
        ("We need a new scraper for Hemmings.com listings.",
         "Before building: check TOOLS.md. If Hemmings isn't listed, try `extract-vehicle-data-ai` (generic AI extraction) first. If that doesn't work, you can build one — but add it to TOOLS.md and consider retiring an unused function to stay under the ~50 function target."),
        ("I'll build a quick edge function to parse Craigslist titles.",
         "Check TOOLS.md first. `extract-craigslist` already exists for Craigslist listings, and `haiku-extraction-worker` with `action: 'parse_title'` handles generic title parsing.\n\nHard Rule #1: The platform went from 50 to 464 functions because agents kept creating single-purpose duplicates. Every new function must be registered in TOOLS.md with justification."),
        ("Let me write a new function to calculate vehicle scores.",
         "Stop — `calculate-vehicle-scores` already exists. Check TOOLS.md before building.\n\nHard Rule #1: Never create a new edge function without confirming no existing one covers the use case. The scoring pipeline is: `calculate-vehicle-scores` (performance), `compute-vehicle-valuation` (price estimate), `calculate-profile-completeness` (quality score), `analyze-market-signals` (market metrics)."),
        ("I need a utility function for VIN validation.",
         "That's already handled. `decode-vin-and-update` validates and decodes VINs via NHTSA. For extraction, `extract-vin-from-vehicle` does AI-powered VIN detection from photos.\n\nHard Rule #1: Check TOOLS.md before creating any new function. The platform bloated to 464 functions from duplicate utilities."),
    ],
    2: [
        ("I need a new table to store auction predictions.",
         "Hard Rule #2: Do NOT create new database tables without justification in the migration comment. There are already 1,013 tables (483 empty).\n\nBefore creating: can this data live in an existing table? Consider `vehicle_observations` (unified event store) or `analysis_signals` (per-vehicle computed data). If a new table is truly needed, justify it in the migration SQL comment."),
        ("Let me create a vehicle_analytics table for storing computed metrics.",
         "Hard Rule #2: There are 1,013 tables already (483 empty). Don't create new ones without justification.\n\nComputed metrics belong in existing tables:\n- `vehicles` has `data_quality_score`, `completion_percentage`, `nuke_estimate`\n- `vehicle_condition_scores` stores condition metrics\n- `analysis_signals` is the catch-all for per-vehicle computed data\n\nIf none of these fit, justify the new table in the migration comment explaining what gap it fills."),
        ("I want to create a staging table for BaT imports.",
         "Check if `import_queue` or `bat_extraction_queue` already serve this purpose — they're the existing staging tables.\n\nHard Rule #2: 483 of 1,013 tables are empty. Creating staging tables that never get cleaned up is how we got here. If a new staging table is truly needed, add a retention policy (e.g., `DELETE WHERE created_at < now() - interval '7 days'`)."),
        ("Should I create a user_preferences table?",
         "Hard Rule #2: Justify new tables. Check if `organization_settings` or an existing config table covers your need. With 1,013 tables (483 empty), every new table must earn its place.\n\nIf justified, include in the migration comment: what data it stores, why no existing table works, expected row count, and retention policy."),
    ],
    3: [
        ("I'll set this cron to run every 30 seconds to catch new listings fast.",
         "Hard Rule #3: Do NOT create cron jobs that fire more frequently than every 5 minutes. Most jobs should be 10-15 min.\n\nRunning every 30 seconds caused 25 jobs to fire at 1-2 min frequency, burning compute for negligible benefit. Use event-driven triggers (database webhooks, queue workers) instead of polling."),
        ("I need a cron to check for new BaT listings every 2 minutes.",
         "Hard Rule #3: Minimum 5 minutes, most should be 10-15. A 2-minute cron for BaT checking is excessive — BaT posts ~20 listings per day, not per minute.\n\nBetter: 15-minute check that catches all new listings in batches. Or use a webhook/event trigger instead of polling."),
        ("How often should I run this monitoring cron?",
         "Hard Rule #3: Minimum every 5 minutes. Recommended intervals:\n\n- **Queue processing**: 5-10 min\n- **Health monitoring**: 10-15 min\n- **Data quality checks**: 15-30 min\n- **Cleanup/maintenance**: hourly or daily\n- **Cost audits**: daily\n\nThe triage found 25 crons at 1-2 min frequency — all were changed to 5+ min with zero impact on data freshness."),
        ("This pipeline needs real-time processing — can I use a 1-minute cron?",
         "No. Hard Rule #3: Minimum 5 minutes.\n\nFor real-time needs, use event-driven architecture:\n- Database trigger → edge function call\n- Queue-based processing (insert to `import_queue` → worker picks up)\n- Supabase Realtime subscriptions\n\nCron polling for real-time is both wasteful and laggy (average wait = half the interval). Events are instant."),
    ],
    4: [
        ("I'll use fetch() to get this BaT listing page.",
         "Hard Rule #4: Do NOT use raw `fetch()` for external URLs — use `archiveFetch()` from `_shared/archiveFetch.ts`.\n\n`archiveFetch()` automatically saves the page to `listing_page_snapshots`, so you never need to re-crawl. Compliance was only 5% before triage.\n\n```typescript\nimport { archiveFetch } from '../_shared/archiveFetch.ts';\nconst { html, markdown, cached } = await archiveFetch(url, { platform: 'bat' });\n```"),
        ("I need to scrape this Mecum lot page for vehicle data.",
         "Use `archiveFetch()`, not raw `fetch()` (Hard Rule #4).\n\n```typescript\nimport { archiveFetch } from '../_shared/archiveFetch.ts';\nconst { html, markdown, cached } = await archiveFetch(mecumUrl, { platform: 'mecum' });\n```\n\nThe page gets archived to `listing_page_snapshots`. If you need to re-extract later (e.g., with a better prompt), the HTML is already stored — no re-crawl needed."),
        ("I'll just do a quick fetch to check if this URL is still live.",
         "Even for URL checks, use `archiveFetch()` (Hard Rule #4). The function checks the cache first and only fetches if stale. If the page is already archived, you get it instantly with no external request.\n\n```typescript\nconst { html, cached } = await archiveFetch(url, { platform: 'bat' });\nconst isLive = html !== null;\n```\n\nBefore triage, only 5% of fetches used `archiveFetch()`. Every raw `fetch()` is a missed archive opportunity."),
    ],
    5: [
        ("I'm writing `import { createClient } from '@supabase/supabase-js'` in my new function.",
         "Hard Rule #5: Do NOT `import { createClient }` directly — use the shared pattern from `_shared/supabaseClient.ts`.\n\nBefore triage, 444 functions were inlining this. When we need to change the client config (timeouts, pooling, retry), we'd have to update 444 files.\n\n```typescript\nimport { getSupabaseClient } from '../_shared/supabaseClient.ts';\nconst supabase = getSupabaseClient();\n```"),
        ("How do I initialize the Supabase client in an edge function?",
         "Use the shared client (Hard Rule #5):\n\n```typescript\nimport { getSupabaseClient } from '../_shared/supabaseClient.ts';\nconst supabase = getSupabaseClient();\n```\n\nDo NOT inline `createClient`. 444 functions were doing this before triage, making config changes (timeout, pooling) impossible to apply consistently."),
        ("Can I just copy the createClient setup from another function?",
         "No — Hard Rule #5. Import from `_shared/supabaseClient.ts` instead. Copy-pasting client initialization is exactly what caused 444 duplicate setups across the codebase. Use the shared pattern so config changes propagate automatically."),
    ],
    6: [
        ("Let me add CORS headers to this function.",
         "Hard Rule #6: Do NOT copy-paste CORS headers — import from `_shared/cors.ts`.\n\nBefore triage, 318 functions had inline CORS headers. When we needed to add a new allowed origin, we couldn't update them all.\n\n```typescript\nimport { corsHeaders } from '../_shared/cors.ts';\n\n// In your response:\nreturn new Response(JSON.stringify(data), {\n  headers: { ...corsHeaders, 'Content-Type': 'application/json' },\n});\n```"),
        ("I need to handle OPTIONS preflight in my edge function.",
         "Use `_shared/cors.ts` (Hard Rule #6):\n\n```typescript\nimport { corsHeaders } from '../_shared/cors.ts';\n\nif (req.method === 'OPTIONS') {\n  return new Response('ok', { headers: corsHeaders });\n}\n```\n\nDon't write CORS handling inline — 318 functions had duplicate CORS headers before triage."),
        ("What CORS headers should I use?",
         "Don't hardcode them. Hard Rule #6: Import from `_shared/cors.ts`.\n\n```typescript\nimport { corsHeaders } from '../_shared/cors.ts';\n```\n\nThis gives you the standard headers that work across all Nuke edge functions. 318 functions had inline CORS headers before the triage — some with different allowed origins, causing inconsistent behavior."),
    ],
    7: [
        ("I'm importing from deno.land/std@0.168.0 in my edge function.",
         "Hard Rule #7: Do NOT use `deno.land/std@0.168.0` imports — use `jsr:@supabase/functions-js/edge-runtime.d.ts`.\n\nThe old Deno stdlib imports are pinned to ancient versions and may break. Supabase's JSR package provides the correct runtime types.\n\n```typescript\nimport 'jsr:@supabase/functions-js/edge-runtime.d.ts';\n```"),
        ("Which Deno standard library version should I use?",
         "Don't import from `deno.land/std` at all (Hard Rule #7). Use the JSR package:\n\n```typescript\nimport 'jsr:@supabase/functions-js/edge-runtime.d.ts';\n```\n\nThe `deno.land/std@0.168.0` imports are deprecated. The JSR package is the officially supported runtime for Supabase edge functions."),
        ("I see other functions using deno.land imports — should I match?",
         "No. Hard Rule #7: Those are legacy imports that haven't been migrated yet. New code should use `jsr:@supabase/functions-js/edge-runtime.d.ts`. Don't perpetuate old patterns — update to JSR imports."),
    ],
    8: [
        ("I need to update the auction_source for all vehicles from 'Barrett-Jackson' to 'barrett-jackson'.",
         "Hard Rule #8: Do NOT run unbounded UPDATE/DELETE on large tables — batch in 1,000-row chunks.\n\nA single unbounded UPDATE caused a 30+ minute lock, blocked PostgREST schema cache reload, and caused a full API outage (PGRST002 errors).\n\n```sql\nDO $$\nDECLARE batch_size INT := 1000; affected INT;\nBEGIN\n  LOOP\n    UPDATE vehicles SET auction_source = 'barrett-jackson'\n    WHERE id IN (\n      SELECT id FROM vehicles WHERE auction_source = 'Barrett-Jackson' LIMIT batch_size\n    );\n    GET DIAGNOSTICS affected = ROW_COUNT;\n    EXIT WHEN affected = 0;\n    PERFORM pg_sleep(0.1);\n  END LOOP;\nEND $$;\n```\n\nAfter EVERY write, check locks: `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';`"),
        ("DELETE FROM vehicle_images WHERE vehicle_id IS NULL;",
         "Stop. Hard Rule #8: Never run unbounded DELETE on large tables.\n\n`vehicle_images` has 34M+ rows. An unbounded DELETE could lock the table for hours.\n\nBatch it:\n```sql\nDO $$\nDECLARE affected INT;\nBEGIN\n  LOOP\n    DELETE FROM vehicle_images\n    WHERE id IN (\n      SELECT id FROM vehicle_images WHERE vehicle_id IS NULL LIMIT 1000\n    );\n    GET DIAGNOSTICS affected = ROW_COUNT;\n    EXIT WHEN affected = 0;\n    PERFORM pg_sleep(0.1);\n  END LOOP;\nEND $$;\n```"),
        ("UPDATE vehicles SET status = 'archived' WHERE created_at < '2024-01-01';",
         "Hard Rule #8: Don't run unbounded UPDATEs on `vehicles`. There could be hundreds of thousands of matching rows.\n\nBatch it:\n```sql\nDO $$\nDECLARE affected INT;\nBEGIN\n  LOOP\n    UPDATE vehicles SET status = 'archived'\n    WHERE id IN (\n      SELECT id FROM vehicles WHERE created_at < '2024-01-01' AND status != 'archived' LIMIT 1000\n    );\n    GET DIAGNOSTICS affected = ROW_COUNT;\n    EXIT WHEN affected = 0;\n    PERFORM pg_sleep(0.1);\n  END LOOP;\nEND $$;\n```\n\nAlways test with `SELECT count(*) ... LIMIT 1000` first to estimate total rows."),
        ("I need to delete 50,000 duplicate vehicle records.",
         "Hard Rule #8: Batch in 1,000-row chunks. 50K records will take ~50 batches.\n\n```sql\nDO $$\nDECLARE affected INT;\nBEGIN\n  LOOP\n    DELETE FROM vehicles\n    WHERE id IN (\n      SELECT id FROM vehicles WHERE status = 'duplicate' LIMIT 1000\n    );\n    GET DIAGNOSTICS affected = ROW_COUNT;\n    EXIT WHEN affected = 0;\n    PERFORM pg_sleep(0.1);\n  END LOOP;\nEND $$;\n```\n\nBut first: delete child records (vehicle_images, auction_comments, vehicle_observations) for these vehicles. FK constraints will block or cascade otherwise."),
        ("UPDATE import_queue SET status = 'pending' WHERE status = 'failed';",
         "Hard Rule #8: Check the count first.\n\n```sql\nSELECT count(*) FROM import_queue WHERE status = 'failed';\n```\n\nIf < 100, the direct UPDATE is fine. If thousands, batch it:\n```sql\nDO $$\nDECLARE affected INT;\nBEGIN\n  LOOP\n    UPDATE import_queue SET status = 'pending'\n    WHERE id IN (SELECT id FROM import_queue WHERE status = 'failed' LIMIT 1000);\n    GET DIAGNOSTICS affected = ROW_COUNT;\n    EXIT WHEN affected = 0;\n    PERFORM pg_sleep(0.1);\n  END LOOP;\nEND $$;\n```"),
    ],
    9: [
        ("I created a new script in scripts/ for data migration.",
         "Hard Rule #9: Add it to package.json. Before triage, 1,343 of 1,395 scripts were unreferenced — no one could find or run them.\n\n```json\n\"scripts\": {\n  \"migrate:data\": \"node scripts/your-migration.mjs\"\n}\n```\n\nIf it's a one-time script, add it with a descriptive name and remove it after use."),
        ("I'll write a quick Python script for this analysis.",
         "Hard Rule #9: If you put it in `scripts/`, add it to package.json so others can find and run it.\n\n1,343 scripts were unreferenced before triage — that's 96% of all scripts invisible to `npm run`. Register it:\n```json\n\"scripts\": {\n  \"analyze:your-thing\": \"python3 scripts/your-analysis.py\"\n}\n```"),
        ("Should I add this utility script to the scripts directory?",
         "Yes, but Hard Rule #9: also add it to package.json. Unreferenced scripts are invisible scripts — 96% of scripts/ were unreferenced before triage.\n\nIf it's temporary, add a comment in package.json: `// TEMP: remove after migration X`."),
    ],
    10: [
        ("We're retiring the betting feature but I'll leave the edge functions deployed just in case.",
         "Hard Rule #10: Do NOT leave dead feature code deployed. If a feature is retired, delete the edge functions, frontend pages, and routes in the same session.\n\nDead functions still consume deployment slots, show in logs, and confuse agents who try to use them. During triage, 259 archived functions were found still deployed."),
        ("The vault feature is deprecated — should I just comment out the routes?",
         "No. Hard Rule #10: Delete the code entirely. Commenting out leaves dead code that agents may try to re-enable.\n\nRetired features (vault, betting, trading, concierge, shipping, investor portal) had their edge functions, frontend pages, and routes fully deleted during the 2026-03-07 triage. Delete, don't comment."),
        ("I'm replacing an old extractor with a new one. Can I keep the old one around?",
         "Hard Rule #10 + Rule #1: If the new extractor fully replaces the old one, delete the old one. Don't keep dead extractors — they create confusion about which to use.\n\nDuring triage, duplicate extractors were a major source of bloat: `bat-extract`, `bat-simple-extract`, `extract-and-route-data`, `smart-extraction-router` — all doing roughly the same thing."),
    ],
    11: [
        ("I need to add an index to the vehicles table.",
         "Hard Rule #11: Do NOT run DDL while other queries are active on the same table.\n\nFirst check:\n```sql\nSELECT count(*) FROM pg_stat_activity\nWHERE state='active' AND query ILIKE '%vehicles%';\n```\n\nIf > 2 active queries, WAIT. DDL operations like CREATE INDEX take an AccessExclusive lock that blocks all reads and writes. On a table with 500K+ rows, this can cascade into a full outage.\n\nConsider `CREATE INDEX CONCURRENTLY` which doesn't lock the table (but takes longer and can't run inside a transaction)."),
        ("ALTER TABLE vehicles ADD COLUMN new_field TEXT;",
         "Hard Rule #11: Check active queries first.\n\n```sql\nSELECT count(*) FROM pg_stat_activity\nWHERE state='active' AND query ILIKE '%vehicles%';\n```\n\nIf > 2, WAIT. ALTER TABLE requires AccessExclusive lock. On a live table with active reads, this blocks everything.\n\nBest practice: run DDL during low-traffic periods, and always `NOTIFY pgrst, 'reload schema'` afterward to refresh PostgREST's cache."),
        ("I need to drop a column from vehicle_images.",
         "Hard Rule #11: Check for active queries first.\n\n```sql\nSELECT count(*) FROM pg_stat_activity\nWHERE state='active' AND query ILIKE '%vehicle_images%';\n```\n\n`vehicle_images` has 34M+ rows. A DROP COLUMN needs AccessExclusive lock. If any queries are running against this table, they'll be blocked AND your DDL will wait.\n\nTime this for a quiet period. After the change: `NOTIFY pgrst, 'reload schema';` (Hard Rule #15)."),
    ],
    12: [
        ("SET statement_timeout = '300s';",
         "Hard Rule #12: Do NOT SET statement_timeout above 120s.\n\nCurrent settings:\n- postgres: 120s (enforces batching)\n- anon: 15s (protects REST API)\n- authenticated: 15s\n- authenticator: 15s\n\nIf your query needs > 120s, it needs to be batched (Hard Rule #8). The timeout exists to enforce good practices, not to be overridden."),
        ("My query keeps timing out at 120s. Can I increase it?",
         "No. Hard Rule #12: 120s is the maximum. If your query takes > 120s, it needs to be restructured:\n\n1. **Batch it** (Rule #8): Process in 1,000-row chunks\n2. **Add an index**: `EXPLAIN ANALYZE` to find missing indexes\n3. **Narrow the WHERE clause**: Filter more precisely\n4. **Use cursor-based pagination** instead of OFFSET\n\nThe 120s limit exists to enforce good query patterns. Every query that needed > 120s turned out to be unbounded or missing an index."),
        ("SET LOCAL statement_timeout = '180s';",
         "Hard Rule #12: No statement_timeout above 120s, not even LOCAL.\n\nSET LOCAL only applies to the current transaction, but it's still a violation. A 180s query is an unbounded query that needs batching.\n\nFix the query, don't raise the timeout."),
    ],
    13: [
        ("SELECT count(*) FROM vehicles;",
         "Hard Rule #13: Before running heavy analytics queries, check if someone else is already running the same thing.\n\n```sql\nSELECT left(query, 80) FROM pg_stat_activity\nWHERE state='active' AND pid != pg_backend_pid();\n```\n\nDuplicate `count(*)` queries on 500K+ row tables are wasteful. For counts, consider using `pg_class.reltuples` for an approximate count:\n```sql\nSELECT reltuples::bigint FROM pg_class WHERE relname = 'vehicles';\n```"),
        ("I'll run a big aggregation query to check data quality.",
         "Hard Rule #13: Check for duplicate analytics queries first.\n\n```sql\nSELECT left(query, 80) FROM pg_stat_activity\nWHERE state='active' AND pid != pg_backend_pid();\n```\n\nIf someone's already running the same analysis, wait for their result instead of doubling the load. For recurring analytics, use `db-stats` edge function which caches results."),
        ("How many vehicle_images do we have?",
         "Before querying, check if another query is already running (Hard Rule #13):\n\n```sql\nSELECT left(query, 80) FROM pg_stat_activity\nWHERE state='active' AND pid != pg_backend_pid();\n```\n\nFor quick estimates, use `pg_class`:\n```sql\nSELECT reltuples::bigint FROM pg_class WHERE relname = 'vehicle_images';\n```\n\nOr call `db-stats` which caches these counts."),
    ],
    14: [
        ("I just ran an UPDATE on 5,000 vehicle records.",
         "Hard Rule #14: After EVERY SQL write, check your lock impact:\n\n```sql\nSELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';\n```\n\nIf > 0, you caused a lock cascade. Stop and investigate:\n```sql\nSELECT pid, state, wait_event_type, left(query, 80) as query\nFROM pg_stat_activity\nWHERE wait_event_type = 'Lock';\n```\n\nAlso check if you should have batched that write (5,000 rows should be done in 5 batches of 1,000)."),
        ("I inserted 200 rows into import_queue.",
         "Good volume. But Hard Rule #14: still check locks:\n\n```sql\nSELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';\n```\n\n200 rows is usually fine, but if there's a trigger on `import_queue` that fires for each row, it could cascade. Always verify."),
        ("I just deleted 3,000 vehicle_images rows.",
         "Hard Rule #14: Check lock impact immediately:\n\n```sql\nSELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';\n```\n\nAlso: 3,000 rows should have been batched (Rule #8 — 1,000 max per batch). If you ran it as a single DELETE, watch for cascading locks from FK constraints and triggers."),
    ],
    15: [
        ("I'm getting PGRST002 errors from the API.",
         "Hard Rule #15: If you break PostgREST, fix it immediately:\n\n```sql\nNOTIFY pgrst, 'reload schema';\n```\n\nPGRST002 means PostgREST's schema cache is stale — usually caused by DDL changes (CREATE TABLE, ALTER TABLE, CREATE INDEX) that ran while PostgREST was caching the schema.\n\nAfter reloading, check what DDL caused it:\n```sql\nSELECT left(query, 100), state, query_start\nFROM pg_stat_activity\nWHERE query ILIKE '%ALTER%' OR query ILIKE '%CREATE%' OR query ILIKE '%DROP%'\nORDER BY query_start DESC\nLIMIT 5;\n```"),
        ("The API is returning weird errors after I ran a migration.",
         "Likely PostgREST cache issue. Hard Rule #15: Reload immediately:\n\n```sql\nNOTIFY pgrst, 'reload schema';\n```\n\nAny DDL change (CREATE TABLE, ALTER TABLE, DROP, CREATE INDEX) invalidates PostgREST's cached schema. It doesn't auto-reload — you must notify it.\n\nAlways run this after any DDL operation, not just when you see errors."),
        ("I just ran ALTER TABLE and now REST endpoints are broken.",
         "Hard Rule #15: You need to reload PostgREST's schema cache:\n\n```sql\nNOTIFY pgrst, 'reload schema';\n```\n\nThis should be standard procedure after ANY DDL. PostgREST caches the schema on startup and doesn't detect changes. The `NOTIFY` command tells it to re-read the schema.\n\nFor future: always pair DDL with reload:\n```sql\nALTER TABLE vehicles ADD COLUMN foo TEXT;\nNOTIFY pgrst, 'reload schema';\n```"),
    ],
}

# Tables and their approximate sizes for realistic scenarios
TABLES = {
    "vehicles": "500K+",
    "vehicle_images": "34M+",
    "auction_comments": "11.6M",
    "vehicle_observations": "2M+",
    "import_queue": "50K+",
    "vehicle_events": "170K+",
    "listing_page_snapshots": "1M+",
    "bat_extraction_queue": "30K+",
    "price_history": "500K+",
    "status_metadata": "800K+",
}

# Vehicle examples for parameterized scenarios
VEHICLE_EXAMPLES = [
    ("1972 Porsche 911S", "bat"),
    ("1967 Ford Mustang Fastback", "bat"),
    ("1985 Toyota Land Cruiser FJ60", "bat"),
    ("1955 Mercedes-Benz 300SL Gullwing", "rm-sothebys"),
    ("1969 Chevrolet Camaro Z/28", "mecum"),
    ("1973 BMW 2002 Turbo", "bat"),
    ("1988 Porsche 959", "bonhams"),
    ("1957 Chevrolet Bel Air", "barrett-jackson"),
    ("2001 BMW M3 E46", "carsandbids"),
    ("1984 Chevrolet K10", "bat"),
    ("1992 Acura NSX", "bat"),
    ("1970 Plymouth Hemi 'Cuda", "mecum"),
    ("1963 Chevrolet Corvette Sting Ray", "barrett-jackson"),
    ("1987 Porsche 930 Turbo", "bat"),
    ("1966 Ford Bronco", "bat"),
]

# Question template families for variety
RECALL_TEMPLATES = [
    "What's Hard Rule #{num}?",
    "What does Hard Rule #{num} say?",
    "Remind me of rule {num}.",
    "What's the rule about {topic}?",
    "Is there a rule against {topic}?",
    "Tell me about the {topic} rule.",
]

VIOLATION_TEMPLATES = [
    "I'm about to {action}. Any concerns?",
    "Is it okay to {action}?",
    "Can I {action}?",
    "What's wrong with {action}?",
    "Why can't I {action}?",
    "Someone told me not to {action}. Why?",
]

# Topic keywords per rule for template matching
RULE_TOPICS = {
    1: ["creating new edge functions", "new functions", "building edge functions", "creating new tools"],
    2: ["creating new tables", "new database tables", "adding tables"],
    3: ["cron frequency", "cron jobs", "frequent crons", "scheduling"],
    4: ["raw fetch", "using fetch()", "fetching external URLs", "scraping without archiving"],
    5: ["createClient import", "direct Supabase client", "inline createClient"],
    6: ["CORS headers", "inline CORS", "copy-paste CORS"],
    7: ["deno.land imports", "old Deno stdlib", "deno standard library version"],
    8: ["unbounded updates", "large table writes", "unbounded DELETE", "bulk operations without batching"],
    9: ["unreferenced scripts", "scripts without package.json", "orphan scripts"],
    10: ["dead feature code", "retired features", "deprecated code left deployed"],
    11: ["DDL during active queries", "running migrations", "ALTER TABLE while queries active"],
    12: ["statement_timeout", "increasing timeout", "query timeout"],
    13: ["duplicate analytics", "redundant count queries", "duplicate heavy queries"],
    14: ["lock checking after writes", "post-write lock check"],
    15: ["PostgREST errors", "PGRST002", "broken REST API", "schema cache"],
}

# Actions per rule for violation templates
RULE_ACTIONS = {
    1: ["create a new edge function for image processing", "build a new extraction function", "add a new utility function"],
    2: ["create a new analytics table", "add a staging table for imports", "create a table for temporary data"],
    3: ["set a cron to run every minute", "create a 2-minute cron job", "poll for new data every 30 seconds"],
    4: ["use fetch() to grab a listing page", "do a raw HTTP request for a URL", "fetch a page without archiving"],
    5: ["import createClient directly in my function", "inline the Supabase client setup"],
    6: ["copy CORS headers from another function", "inline CORS headers"],
    7: ["use deno.land/std@0.168.0 for path handling", "import from the old Deno stdlib"],
    8: ["update all vehicles in one query", "delete 100K records in a single DELETE", "run an unbounded UPDATE on vehicle_images"],
    9: ["drop a script in scripts/ without registering it", "create a utility script without adding to package.json"],
    10: ["leave the old function deployed after replacing it", "keep deprecated code just in case"],
    11: ["add an index while the API is under load", "ALTER TABLE during business hours", "run DDL while other queries are active"],
    12: ["set statement_timeout to 300 seconds", "increase the query timeout to 5 minutes"],
    13: ["run SELECT count(*) FROM vehicles while another agent is doing the same", "run a duplicate analytics query"],
    14: ["skip checking locks after my UPDATE", "not verify lock state after writing"],
    15: ["ignore the PGRST002 error and keep working", "not reload PostgREST after DDL"],
}


def generate_system_rules(rules: list[HardRule], principles: list[Principle], limit: int = 2000) -> list[dict]:
    pairs = []

    # 1. Rule recall — multiple templates per rule
    for rule in rules:
        # Direct recall
        pairs.append(make_pair(
            f"What's Hard Rule #{rule.number}?",
            f"**Hard Rule #{rule.number}:** {rule.rule_text}\n\n"
            + (f"Rationale: {rule.rationale}" if rule.rationale else "This was enforced after the 2026-03-07 triage that found the platform had bloated to 464 edge functions, 171 GB database, and $5,600/month burn."),
            "system_rules",
        ))

        # "What does rule X say?"
        pairs.append(make_pair(
            f"What does Hard Rule #{rule.number} say?",
            f"Hard Rule #{rule.number}: {rule.rule_text}"
            + (f"\n\n{rule.rationale}" if rule.rationale else ""),
            "system_rules",
        ))

        # "Remind me of rule X"
        pairs.append(make_pair(
            f"Remind me of rule {rule.number}.",
            f"Rule {rule.number}: {rule.rule_text}",
            "system_rules",
        ))

        # Topic-based recall
        topics = RULE_TOPICS.get(rule.number, [])
        for topic in topics:
            pairs.append(make_pair(
                f"What's the rule about {topic}?",
                f"That's Hard Rule #{rule.number}: {rule.rule_text}"
                + (f"\n\n{rule.rationale}" if rule.rationale else ""),
                "system_rules",
            ))

            pairs.append(make_pair(
                f"Is there a rule against {topic}?",
                f"Yes — Hard Rule #{rule.number}: {rule.rule_text}",
                "system_rules",
            ))

    # 2. Scenario-based — concrete violations
    for rule_num, scenarios in RULE_SCENARIOS.items():
        for question, answer in scenarios:
            pairs.append(make_pair(question, answer, "system_rules"))

    # 3. Violation templates — parameterized across rules
    for rule_num, actions in RULE_ACTIONS.items():
        rule = next((r for r in rules if r.number == rule_num), None)
        if not rule:
            continue
        for action in actions:
            for template in random.sample(VIOLATION_TEMPLATES, min(3, len(VIOLATION_TEMPLATES))):
                question = template.format(action=action)
                pairs.append(make_pair(
                    question,
                    f"Hard Rule #{rule_num}: {rule.rule_text}\n\n"
                    f"This rule exists because violations during the 2026-03-07 triage caused major platform issues. "
                    f"Follow it exactly.",
                    "system_rules",
                ))

    # 4. Principle deep-dives
    for principle in principles:
        pairs.append(make_pair(
            f"What's the {principle.name} Principle?",
            f"**{principle.name} Principle:** {principle.rule_text}\n\n"
            + (f"Wrong: {principle.wrong_example}\nRight: {principle.right_example}\n\n" if principle.wrong_example else "")
            + (f'"{principle.rationale}"' if principle.rationale else ""),
            "system_rules",
        ))

        # Multiple question formats
        pairs.append(make_pair(
            f"Explain the {principle.name} principle.",
            f"**{principle.name}:** {principle.rule_text}\n\n"
            + (f'Motto: "{principle.rationale}"' if principle.rationale else ""),
            "system_rules",
        ))

        pairs.append(make_pair(
            f"Why do we have the {principle.name} principle?",
            f"The {principle.name} Principle exists because of real incidents:\n\n"
            + (f"Without it: {principle.wrong_example}\nWith it: {principle.right_example}\n\n" if principle.wrong_example else "")
            + f"{principle.rule_text}",
            "system_rules",
        ))

    # 5. Schema Discovery scenarios (expanded)
    schema_discovery_scenarios = [
        ("I'm building an extractor for a new auction house. I'll define the schema first based on what I think they have.",
         "Stop — Schema Discovery Principle: Never pre-define a schema before seeing the actual data.\n\nThe right approach:\n1. **DISCOVERY FIRST**: Use Firecrawl to sample 20-50 listings. Enumerate ALL fields that exist.\n2. **AGGREGATE**: Compile a field catalog with frequencies.\n3. **THEN DESIGN**: Build your schema based on what actually exists.\n4. **THEN EXTRACT**: Extract once with the complete schema.\n\nPre-defining schemas leads to: missed fields → re-extraction → wasted API calls."),
        ("What fields does this new auction source have?",
         "Apply the Schema Discovery Principle: don't guess, discover.\n\n1. Scrape 20-50 sample listings with Firecrawl\n2. Parse ALL fields from the HTML/JSON\n3. Count field frequencies (which ones appear on 90%+ vs 10% of listings)\n4. Design your schema from the frequency catalog\n\nThe data knows what it contains. Ask it before you assume."),
        ("I'll assume this European auction uses the same fields as BaT.",
         "Schema Discovery Principle: Never assume field sets between sources.\n\nEuropean auctions often have different fields: registration numbers instead of VINs, kilometers instead of miles, VAT/margin scheme details, provenance documentation levels, and different price reporting (hammer price vs total with premium).\n\nSample 20-50 listings from the actual source first."),
        ("I need to build an extractor for RM Sotheby's — what schema should I use?",
         "Schema Discovery: Don't assume. RM Sotheby's has unique fields:\n- Lot essays (long-form provenance), estimate ranges (low/high), chassis numbers (not VINs for pre-1981), auction locations, specialist notes.\n\nSample 20-50 actual listings first. Some fields you'd expect (VIN, mileage) may not be present — RM Sotheby's has ~0.3% VIN fill rate."),
    ]
    for q, a in schema_discovery_scenarios:
        pairs.append(make_pair(q, a, "system_rules"))

    # 6. Archive Fetch scenarios (expanded)
    archive_fetch_scenarios = [
        ("I'll just use fetch() to grab this page — it's a one-time thing.",
         "No one-time fetches. Archive Fetch Principle: Always use `archiveFetch()` from `_shared/archiveFetch.ts`.\n\nEvery page gets saved to `listing_page_snapshots`. Compliance was 5% before triage. Fetch once, extract forever.\n\n```typescript\nimport { archiveFetch } from '../_shared/archiveFetch.ts';\nconst { html, markdown, cached } = await archiveFetch(url, { platform: 'bat' });\n```"),
        ("Should I use Firecrawl or fetch for this page?",
         "Neither directly — use `archiveFetch()` (Archive Fetch Principle). It wraps both:\n\n```typescript\n// Uses regular HTTP fetch + archives\nconst { html } = await archiveFetch(url, { platform: 'bat' });\n\n// Uses Firecrawl for JS-rendered pages + archives\nconst { html } = await archiveFetch(url, { useFirecrawl: true });\n```\n\nBoth paths archive to `listing_page_snapshots`. No raw fetch()."),
        ("How do I re-extract data from a page we already scraped?",
         "Archive Fetch Principle makes this free — use `readArchivedPage()`:\n\n```typescript\nimport { readArchivedPage } from '../_shared/archiveFetch.ts';\nconst { html } = await readArchivedPage(url);\n```\n\nNo network request needed. The HTML is stored in `listing_page_snapshots`. You can re-extract 1,000 times without hitting the source site."),
        ("I need to check if a BaT listing URL is still active.",
         "Use `archiveFetch()` — it checks cache first (Archive Fetch Principle):\n\n```typescript\nconst { html, cached } = await archiveFetch(url, { platform: 'bat' });\n```\n\nIf `cached=true`, you got the archived version without a network request. If `cached=false`, it fetched fresh and archived automatically."),
    ]
    for q, a in archive_fetch_scenarios:
        pairs.append(make_pair(q, a, "system_rules"))

    # 7. Batched Migration scenarios (expanded)
    batch_scenarios = [
        ("I need to backfill a new column on the vehicles table for all 500K rows.",
         "Batched Migration Principle: Never run unbounded writes.\n\n```sql\nDO $$\nDECLARE affected INT;\nBEGIN\n  LOOP\n    UPDATE vehicles SET new_column = compute_value()\n    WHERE id IN (SELECT id FROM vehicles WHERE new_column IS NULL LIMIT 1000);\n    GET DIAGNOSTICS affected = ROW_COUNT;\n    EXIT WHEN affected = 0;\n    PERFORM pg_sleep(0.1);\n  END LOOP;\nEND $$;\n```\n\nTest with LIMIT 10 first. Check locks after each batch."),
        ("How should I approach a large data migration?",
         "Batched Migration Principle. Steps:\n\n1. **Estimate scope**: `SELECT count(*) FROM table WHERE condition;`\n2. **Test with LIMIT 10**: Run the UPDATE/DELETE on 10 rows, check execution time\n3. **Batch in 1,000 chunks**: Loop with LIMIT 1000 + pg_sleep(0.1)\n4. **Check locks after EVERY batch**: `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';`\n5. **No DDL during migration**: Don't ALTER TABLE while batched writes are running\n6. **Monitor**: Watch DB size, lock waits, and query duration\n\nA 500K-row backfill takes ~500 batches × 0.1s = ~1 minute."),
        ("I need to null out sale_price for all ConceptCarz vehicles.",
         "ConceptCarz has ~374K vehicles. Batched Migration:\n\n```sql\nDO $$\nDECLARE affected INT;\nBEGIN\n  LOOP\n    UPDATE vehicles SET sale_price = NULL, price_source = 'editorial_estimate'\n    WHERE id IN (\n      SELECT id FROM vehicles\n      WHERE auction_source = 'conceptcarz' AND sale_price IS NOT NULL\n      LIMIT 1000\n    );\n    GET DIAGNOSTICS affected = ROW_COUNT;\n    EXIT WHEN affected = 0;\n    PERFORM pg_sleep(0.1);\n  END LOOP;\nEND $$;\n```\n\n~374 batches. Check locks periodically."),
    ]
    for q, a in batch_scenarios:
        pairs.append(make_pair(q, a, "system_rules"))

    # 8. Timeout settings
    pairs.append(make_pair(
        "What are the current statement_timeout settings?",
        "Current settings (DO NOT CHANGE):\n\n"
        "| Role | Timeout | Why |\n|------|---------|-----|\n"
        + "\n".join(f"| `{t['role']}` | {t['timeout']} | {t['why']} |" for t in TIMEOUT_SETTINGS)
        + "\n\nThe postgres role is 120s to enforce the batching rule. If your query needs more, batch it.",
        "system_rules",
    ))

    # 9. Cross-rule scenarios (expanded)
    cross_rule_scenarios = [
        ("I need to create a new table, add a cron job to populate it every minute, and create an edge function to expose it.",
         "That violates three hard rules:\n\n1. **Rule #2**: Don't create tables without justification. Can this live in `vehicle_observations`?\n2. **Rule #3**: Min 5-minute crons. Every-minute crons burn compute.\n3. **Rule #1**: Don't create functions without checking TOOLS.md. Max ~50 active.\n\nBetter: use existing tables/functions, 10-15 min crons, register in TOOLS.md."),
        ("I'll create a new edge function that uses fetch() to scrape a page every 2 minutes and stores results in a new table.",
         "Four rules violated:\n\n1. **Rule #1**: Check TOOLS.md for existing extractors first\n2. **Rule #3**: Minimum 5-minute cron intervals\n3. **Rule #4**: Use `archiveFetch()`, not raw `fetch()`\n4. **Rule #2**: Don't create tables without justification\n\nThe correct approach: use an existing extractor with `archiveFetch()`, store in `vehicle_observations`, and check at most every 10-15 minutes."),
        ("I'll ALTER TABLE to add an index, then UPDATE all rows, then create a new cron to maintain it.",
         "Multiple concerns:\n\n1. **Rule #11**: Check active queries before DDL. Use `CREATE INDEX CONCURRENTLY`.\n2. **Rule #8**: Batch the UPDATE in 1,000-row chunks.\n3. **Rule #3**: Cron must be ≥5 minutes.\n4. **Rule #14**: Check locks after the UPDATE.\n5. **Rule #15**: Run `NOTIFY pgrst, 'reload schema'` after the ALTER TABLE.\n\nDo them in sequence: DDL first (when quiet), then batched writes, then cron setup."),
        ("I need to run a COUNT(*) on vehicles, then update 50K rows, then add a column.",
         "Three rules apply:\n\n1. **Rule #13**: Check for duplicate analytics queries before the COUNT\n2. **Rule #8**: Batch the 50K-row UPDATE in 1,000-row chunks\n3. **Rule #11**: Check active queries before ALTER TABLE (and do it AFTER the UPDATE finishes)\n\nSequence: COUNT → batched UPDATE → wait for completion → check active queries → ALTER TABLE → NOTIFY pgrst."),
    ]
    for q, a in cross_rule_scenarios:
        pairs.append(make_pair(q, a, "system_rules"))

    # 10. "What are the rules" — general overview
    rule_list = "\n".join(f"{r.number}. {r.rule_text}" for r in rules)
    pairs.append(make_pair(
        "What are the hard rules for the Nuke platform?",
        f"15 hard rules enforced after the 2026-03-07 triage:\n\n{rule_list}\n\n"
        f"Plus 3 principles: Schema Discovery, Archive Fetch, and Batched Migration.\n\n"
        f"These exist because violations caused 464 edge functions, 171 GB database, and $5,600/month burn.",
        "system_rules",
    ))

    pairs.append(make_pair(
        "List all the hard rules.",
        f"The 15 hard rules:\n\n{rule_list}",
        "system_rules",
    ))

    pairs.append(make_pair(
        "What are the three critical principles?",
        "1. **Schema Discovery**: Never pre-define a schema before seeing actual data. Sample first, then design.\n"
        "2. **Archive Fetch**: Never use raw `fetch()` — use `archiveFetch()` to auto-archive pages. Fetch once, extract forever.\n"
        "3. **Batched Migration**: Never run unbounded UPDATE/DELETE. Batch in 1,000-row chunks with `pg_sleep(0.1)` between batches.",
        "system_rules",
    ))

    # 11. Parameterized table-specific batching scenarios
    for table, size in TABLES.items():
        if table in ("vehicles", "vehicle_images", "auction_comments", "vehicle_observations"):
            pairs.append(make_pair(
                f"I need to update rows in `{table}`.",
                f"Hard Rule #8: `{table}` has {size} rows. Batch in 1,000-row chunks:\n\n"
                f"```sql\nDO $$\nDECLARE affected INT;\nBEGIN\n  LOOP\n    UPDATE {table} SET column = value\n"
                f"    WHERE id IN (SELECT id FROM {table} WHERE condition LIMIT 1000);\n"
                f"    GET DIAGNOSTICS affected = ROW_COUNT;\n    EXIT WHEN affected = 0;\n"
                f"    PERFORM pg_sleep(0.1);\n  END LOOP;\nEND $$;\n```\n\n"
                f"After EVERY batch, check: `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';`",
                "system_rules",
            ))

            pairs.append(make_pair(
                f"I need to delete from `{table}`.",
                f"Hard Rule #8: `{table}` has {size} rows. Never unbounded DELETE.\n\n"
                f"```sql\nDO $$\nDECLARE affected INT;\nBEGIN\n  LOOP\n    DELETE FROM {table}\n"
                f"    WHERE id IN (SELECT id FROM {table} WHERE condition LIMIT 1000);\n"
                f"    GET DIAGNOSTICS affected = ROW_COUNT;\n    EXIT WHEN affected = 0;\n"
                f"    PERFORM pg_sleep(0.1);\n  END LOOP;\nEND $$;\n```",
                "system_rules",
            ))

            pairs.append(make_pair(
                f"Can I run ALTER TABLE on `{table}`?",
                f"Hard Rule #11: Check active queries first.\n\n"
                f"```sql\nSELECT count(*) FROM pg_stat_activity\nWHERE state='active' AND query ILIKE '%{table}%';\n```\n\n"
                f"If > 2, WAIT. `{table}` has {size} rows — DDL will acquire AccessExclusive lock that blocks all reads/writes.\n\n"
                f"After DDL: `NOTIFY pgrst, 'reload schema';` (Rule #15).",
                "system_rules",
            ))

    # 12. Real-world situation: "What rules apply here?"
    situation_rules = [
        ("I have a list of 20,000 BaT URLs to extract. What's the fastest way?",
         "Several rules apply:\n\n1. **Rule #4**: Use `archiveFetch()` for each URL, not raw `fetch()`\n2. **Rule #3**: Don't cron this faster than every 5 minutes — use a queue instead\n3. **Rule #8**: If you're inserting into `import_queue`, batch the inserts\n4. **Rule #1**: Use `complete-bat-import` — don't build a new extractor\n\nBest approach: bulk insert URLs into `import_queue` (batched 1,000 at a time), let the existing worker (`haiku-extraction-worker`) process them."),
        ("The database is running slow. What should I check?",
         "Several rules guide diagnostics:\n\n1. **Rule #13**: Check for duplicate analytics queries: `SELECT left(query,80) FROM pg_stat_activity WHERE state='active';`\n2. **Rule #14**: Check for lock cascades: `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';`\n3. **Rule #11**: Check for DDL blocking: look for AccessExclusive locks\n4. **Rule #12**: Check for queries exceeding timeouts\n\nAlso check queue health with `ralph-wiggum-rlm-extraction-coordinator` brief and stale locks with `queue_lock_health` view."),
        ("I want to deploy a new feature end-to-end.",
         "Rules checklist for new features:\n\n1. **Rule #1**: Check TOOLS.md for existing functions. Register new ones.\n2. **Rule #2**: If you need new tables, justify in migration comment.\n3. **Rule #4**: Use `archiveFetch()` for any external URLs.\n4. **Rule #5**: Use shared Supabase client, not inline `createClient`.\n5. **Rule #6**: Use shared CORS headers.\n6. **Rule #7**: Use JSR imports, not deno.land.\n7. **Rule #9**: Register scripts in package.json.\n8. **Rule #15**: After any DDL: `NOTIFY pgrst, 'reload schema';`"),
    ]
    for q, a in situation_rules:
        pairs.append(make_pair(q, a, "system_rules"))

    # 13. "Which rule did I violate?" — post-hoc diagnosis
    violation_diagnosis = [
        ("The API went down after I ran a migration.",
         "You likely violated Hard Rule #11 (DDL during active queries) and #15 (didn't reload PostgREST).\n\nImmediate fix:\n```sql\nNOTIFY pgrst, 'reload schema';\n```\n\nThen investigate:\n```sql\nSELECT left(query, 100), state FROM pg_stat_activity WHERE state = 'active';\n```\n\nPrevention: always check active queries before DDL, and always NOTIFY after."),
        ("My UPDATE has been running for 10 minutes.",
         "You violated Hard Rule #8 (unbounded writes) and possibly #12 (timeout should have killed it at 120s, unless you overrode it).\n\n1. Check if it's still running: `SELECT * FROM pg_stat_activity WHERE state='active' AND query ILIKE '%UPDATE%';`\n2. If needed, cancel it: `SELECT pg_cancel_backend(<pid>);`\n3. Redo with batching: 1,000-row chunks with pg_sleep(0.1)\n\nA properly batched 500K-row update takes ~1 minute, not 10."),
        ("Other agents are complaining about locks after my write.",
         "Hard Rule #14: You should have checked locks immediately after writing.\n\nCheck now:\n```sql\nSELECT pid, state, wait_event_type, left(query, 80)\nFROM pg_stat_activity\nWHERE wait_event_type = 'Lock';\n```\n\nIf your write is still holding locks, it was probably unbounded (Rule #8 violation). Cancel it if needed: `SELECT pg_cancel_backend(<pid>);`"),
        ("My cron job is running every minute and the costs spiked.",
         "Hard Rule #3 violation. Crons faster than 5 minutes waste compute for negligible benefit.\n\nFix: update the cron schedule:\n```sql\nSELECT cron.unschedule(<job_id>);\nSELECT cron.schedule('my-job', '*/15 * * * *', $$SELECT my_function()$$);\n```\n\nDuring triage, changing 25 crons from 1-2 min to 5+ min had zero impact on data freshness but saved significant compute."),
    ]
    for q, a in violation_diagnosis:
        pairs.append(make_pair(q, a, "system_rules"))

    # 14. Rule interaction with vehicle operations
    for vehicle, source in random.sample(VEHICLE_EXAMPLES, min(8, len(VEHICLE_EXAMPLES))):
        pairs.append(make_pair(
            f"I want to extract this {vehicle} from {source} — what rules should I follow?",
            f"For extracting a {vehicle} from {source}:\n\n"
            f"1. **Rule #1**: Use the existing {source} extractor from TOOLS.md, don't build a new one\n"
            f"2. **Rule #4**: Use `archiveFetch()` to archive the listing page\n"
            f"3. **Rule #8**: If batch importing, insert to `import_queue` in 1,000-row chunks\n"
            f"4. **Rule #14**: After any DB writes, check locks\n\n"
            f"Pipeline: `archiveFetch()` → extract → `import_queue` → `haiku-extraction-worker` → enrichment.",
            "system_rules",
        ))

    # 15. Massive parameterized expansion — rule × table × action
    write_actions = [
        "UPDATE {table} SET status = 'archived'",
        "DELETE FROM {table} WHERE created_at < '2024-01-01'",
        "UPDATE {table} SET auction_source = 'new_value'",
        "INSERT INTO {table} SELECT * FROM staging_table",
        "DELETE FROM {table} WHERE status = 'duplicate'",
        "UPDATE {table} SET nuke_estimate = NULL",
        "DELETE FROM {table} WHERE vehicle_id IS NULL",
        "UPDATE {table} SET data_quality_score = 0",
    ]

    for table, size in TABLES.items():
        for action_template in random.sample(write_actions, min(4, len(write_actions))):
            action = action_template.format(table=table)
            pairs.append(make_pair(
                f"I need to run: {action}",
                f"Rules to follow for `{table}` ({size} rows):\n\n"
                f"1. **Rule #8**: Batch in 1,000-row chunks — never unbounded on `{table}`\n"
                f"2. **Rule #14**: Check locks after EVERY batch\n"
                f"3. **Rule #12**: Don't override the 120s timeout — if it times out, batch smaller\n\n"
                f"```sql\nDO $$\nDECLARE affected INT;\nBEGIN\n  LOOP\n"
                f"    {action}\n    WHERE id IN (SELECT id FROM {table} WHERE <condition> LIMIT 1000);\n"
                f"    GET DIAGNOSTICS affected = ROW_COUNT;\n    EXIT WHEN affected = 0;\n"
                f"    PERFORM pg_sleep(0.1);\n  END LOOP;\nEND $$;\n```",
                "system_rules",
            ))

    # 16. "What rule applies?" — parameterized with various scenarios
    rule_application_scenarios = []
    for table in ["vehicles", "vehicle_images", "auction_comments", "import_queue"]:
        rule_application_scenarios.extend([
            (f"I'm about to ALTER TABLE {table} ADD COLUMN new_field TEXT.",
             f"Rule #11: Check active queries on `{table}` first. Rule #15: Run `NOTIFY pgrst, 'reload schema'` after."),
            (f"I want to run SELECT count(*) FROM {table}.",
             f"Rule #13: Check if another agent is already running this query. For fast estimates, use `pg_class.reltuples`."),
            (f"I just inserted 500 rows into {table}.",
             f"Rule #14: Check locks immediately: `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';`"),
        ])

    for q, a in rule_application_scenarios:
        pairs.append(make_pair(q, a, "system_rules"))

    # 17. Edge function scenarios — which rules apply?
    edge_functions = [
        "extract-vehicle-data-ai", "complete-bat-import", "extract-cars-and-bids-core",
        "compute-vehicle-valuation", "haiku-extraction-worker", "photo-pipeline-orchestrator",
        "extract-auction-comments", "decode-vin-and-update", "enrich-factory-specs",
    ]
    for func in edge_functions:
        pairs.append(make_pair(
            f"I need to modify `{func}`. What rules apply?",
            f"When modifying `{func}`:\n\n"
            f"1. **Rule #1**: It's already registered in TOOLS.md — don't create a duplicate\n"
            f"2. **Rule #4**: If it fetches URLs, use `archiveFetch()`\n"
            f"3. **Rule #5**: Use shared Supabase client from `_shared/supabaseClient.ts`\n"
            f"4. **Rule #6**: Use shared CORS from `_shared/cors.ts`\n"
            f"5. **Rule #7**: Use JSR imports, not deno.land\n"
            f"6. After deploying: `supabase functions deploy {func} --no-verify-jwt`\n"
            f"7. If it changes schema: `NOTIFY pgrst, 'reload schema'` (Rule #15)",
            "system_rules",
        ))

    # 18. Frequency-based questions
    freq_questions = [
        "How often should health monitoring run?",
        "How often should data quality checks run?",
        "How often should stale lock cleanup run?",
        "How often should queue processing run?",
        "How often should extraction crons run?",
        "How often should cost audits run?",
        "What's the minimum cron frequency?",
    ]
    for q in freq_questions:
        pairs.append(make_pair(
            q,
            "Hard Rule #3: Minimum every 5 minutes. Recommended intervals:\n\n"
            "- **Queue processing**: 5-10 min\n"
            "- **Health monitoring**: 10-15 min\n"
            "- **Data quality checks**: 15-30 min\n"
            "- **Stale lock cleanup**: hourly (cron job 188)\n"
            "- **Cleanup/maintenance**: hourly or daily\n"
            "- **Cost audits**: daily\n\n"
            "The triage found 25 crons at 1-2 min frequency — all were changed to 5+ min with zero impact.",
            "system_rules",
        ))

    random.shuffle(pairs)
    return pairs[:limit]
