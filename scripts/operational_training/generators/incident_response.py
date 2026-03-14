"""Generate incident response training examples.

Teaches the model how to diagnose and recover from real platform incidents.
"""

import random
from ..parsers.done_md_parser import DoneEntry
from .tool_routing import make_pair


# Hardcoded incident patterns mined from DONE.md and operational history
KNOWN_INCIDENTS = [
    {
        "symptom": "Images stuck in 'processing' status for days. 28,149 vehicle_images haven't moved.",
        "diagnosis": "Stale locks. Processing workers crashed or timed out without releasing their locks.",
        "fix": "Use the stale lock infrastructure:\n\n"
               "```sql\n-- Check stale locks (dry run)\nSELECT * FROM release_stale_locks(dry_run:=true);\n\n"
               "-- Release locks older than 30 minutes\nSELECT * FROM release_stale_locks();\n\n"
               "-- Check the lock health view\nSELECT * FROM queue_lock_health;\n```\n\n"
               "There's also an hourly cron (job 188) that auto-releases stale locks. Verify it's running.",
        "prevention": "The stale lock cron should catch most cases. If you see recurring stale locks, check the worker function for timeout/crash patterns.",
    },
    {
        "symptom": "API returning PGRST002 errors. REST endpoints are down.",
        "diagnosis": "PostgREST schema cache is stale — usually caused by DDL changes (CREATE TABLE, ALTER TABLE, CREATE INDEX) that ran while PostgREST was caching.",
        "fix": "Immediately reload the schema:\n\n"
               "```sql\nNOTIFY pgrst, 'reload schema';\n```\n\n"
               "Then identify what DDL caused it:\n"
               "```sql\nSELECT left(query, 100), state, query_start\nFROM pg_stat_activity\nWHERE query ILIKE '%ALTER%' OR query ILIKE '%CREATE%' OR query ILIKE '%DROP%'\nORDER BY query_start DESC LIMIT 5;\n```",
        "prevention": "Hard Rule #11: Don't run DDL while other queries are active. Check active queries first.",
    },
    {
        "symptom": "Monthly bill spiked from $3,000 to $5,600.",
        "diagnosis": "Multiple causes: 25 cron jobs at 1-2 min frequency, 464 edge functions (many duplicates), AI image analysis at $0.002/image on 33M images, unbounded queries.",
        "fix": "Triage approach:\n"
               "1. Check cron frequencies: `SELECT * FROM cron.job WHERE schedule LIKE '*/1%' OR schedule LIKE '*/2%';`\n"
               "2. Audit edge functions: `supabase functions list` — target ~50 active\n"
               "3. Check AI costs: `check-image-vehicle-match` was $2,100/mo alone\n"
               "4. Review DB size: `SELECT pg_size_pretty(pg_database_size('postgres'));`\n"
               "5. Pause expensive pipelines: set `NUKE_ANALYSIS_PAUSED` flag",
        "prevention": "Hard Rule #3 (no crons < 5min), Rule #1 (no new functions without retiring one). Regular cost audits.",
    },
    {
        "symptom": "ConceptCarz data has 374K vehicles with fabricated prices. They're polluting market comparables.",
        "diagnosis": "ConceptCarz is an encyclopedia, not an auction. Their 'prices' are editorial estimates, not real sales. These were imported as if they were auction results.",
        "fix": "Mark ConceptCarz vehicles appropriately:\n"
               "```sql\nDO $$\nDECLARE affected INT;\nBEGIN\n  LOOP\n    UPDATE vehicles SET sale_price = NULL, price_source = 'editorial_estimate'\n"
               "    WHERE id IN (\n      SELECT id FROM vehicles WHERE auction_source = 'conceptcarz' AND sale_price IS NOT NULL LIMIT 1000\n"
               "    );\n    GET DIAGNOSTICS affected = ROW_COUNT;\n    EXIT WHEN affected = 0;\n    PERFORM pg_sleep(0.1);\n  END LOOP;\nEND $$;\n```\n\n"
               "Exclude from comps queries: `WHERE auction_source != 'conceptcarz'`",
        "prevention": "Schema Discovery Principle: understand the source before importing. Not all prices are transaction prices.",
    },
    {
        "symptom": "BaT has 3.9x duplication — same vehicles appear multiple times with different IDs.",
        "diagnosis": "Multiple extraction runs created duplicate vehicle records for the same BaT listing URL.",
        "fix": "Use the dedup pipeline:\n"
               "1. Identify duplicates: match on `source_url` or `vin + year + make + model`\n"
               "2. Keep the record with the most data (highest `completion_percentage`)\n"
               "3. Merge child records (images, comments, observations) to the keeper\n"
               "4. Mark duplicates: `UPDATE vehicles SET status = 'duplicate' WHERE id IN (...)`\n"
               "5. Batch delete (Hard Rule #8 — 1,000 at a time)",
        "prevention": "Use `content_hash` deduplication on ingest. The `ingest-observation` function does this automatically via SHA256 hash.",
    },
    {
        "symptom": "Import queue is backing up. 5,000+ pending records.",
        "diagnosis": "Check worker health: is `continuous-queue-processor` running? Are workers crashing? Are there stale locks?",
        "fix": "Diagnostic steps:\n"
               "```sql\n-- Check queue state\nSELECT status, count(*) FROM import_queue GROUP BY status;\n\n"
               "-- Check for stale locks\nSELECT * FROM queue_lock_health;\n\n"
               "-- Release stale locks if found\nSELECT * FROM release_stale_locks();\n\n"
               "-- Check worker cron\nSELECT jobid, schedule, command FROM cron.job WHERE command ILIKE '%queue%';\n```\n\n"
               "If the cron is running but queue isn't draining, check `haiku-extraction-worker` logs for errors.",
        "prevention": "Monitor queue depth. Set alerts when pending > 1,000. Release stale locks hourly (cron job 188).",
    },
    {
        "symptom": "Vehicles being created with parts listings as vehicles — wheels, manuals, pedal cars showing up as vehicle records.",
        "diagnosis": "The extraction pipeline doesn't have strong enough document type classification. Parts and memorabilia from auction sites get extracted as vehicles.",
        "fix": "The Haiku extraction worker should catch this:\n"
               "1. Quality score < 0.6 should reject non-vehicle listings\n"
               "2. Check for keywords: 'wheels', 'manual', 'pedal car', 'memorabilia', 'literature'\n"
               "3. If year is null AND model contains product descriptions, reject\n\n"
               "For existing bad records:\n"
               "```sql\nUPDATE vehicles SET status = 'rejected'\nWHERE id IN (\n  SELECT id FROM vehicles\n  WHERE model ILIKE '%wheels%' OR model ILIKE '%manual%' OR model ILIKE '%pedal%'\n  LIMIT 1000\n);\n```",
        "prevention": "Improve Haiku extraction prompts to classify document type before extracting fields.",
    },
    {
        "symptom": "New BAT vehicles have 0 comments and 0 images — skeleton records.",
        "diagnosis": "The extraction pipeline ran the initial import but didn't follow through with `extract-auction-comments` and image ingestion.",
        "fix": "Re-run the full pipeline for these vehicles:\n"
               "1. Find skeletons:\n"
               "```sql\nSELECT v.id, v.year, v.make, v.model\nFROM vehicles v\nWHERE v.auction_source = 'bat' AND v.status = 'active'\n  AND NOT EXISTS (SELECT 1 FROM auction_comments ac WHERE ac.vehicle_id = v.id)\nLIMIT 100;\n```\n\n"
               "2. Get their source URLs from vehicle_events:\n"
               "```sql\nSELECT ve.source_url FROM vehicle_events ve WHERE ve.vehicle_id = '<id>';\n```\n\n"
               "3. Re-run `complete-bat-import` for each URL (it calls extract-bat-core + extract-auction-comments).",
        "prevention": "Monitor extraction completeness. A BaT vehicle without comments is incomplete — flag for re-extraction.",
    },
    {
        "symptom": "Database size is 171 GB and growing. Storage costs are escalating.",
        "diagnosis": "Multiple factors: listing_page_snapshots (79 GB), 473K duplicate vehicles with child records, 483 empty tables, large indexes on unused columns.",
        "fix": "Storage reduction plan:\n"
               "1. **Duplicate vehicles**: Delete child records first (vehicle_images, auction_comments, etc.), then vehicles with status='duplicate' in 1,000-row batches\n"
               "2. **listing_page_snapshots**: Implement retention policy — keep only last 90 days, archive to cold storage\n"
               "3. **Empty tables**: `DROP TABLE` the 483 empty tables (check they're truly unused first)\n"
               "4. **VACUUM FULL**: After large deletes, run VACUUM FULL on affected tables to reclaim disk space\n"
               "5. **Unused indexes**: Identify and drop: `SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE idx_scan = 0;`",
        "prevention": "Monitor DB size weekly. Set retention policies on all data tables. Don't create tables without a cleanup plan.",
    },
    {
        "symptom": "Edge function deploys are failing with 'too many functions' error.",
        "diagnosis": "Supabase has a limit on the number of deployed edge functions. The platform had 464 (259 were eventually archived).",
        "fix": "Audit and consolidate:\n"
               "1. List all functions: `supabase functions list`\n"
               "2. Check TOOLS.md for canonical functions\n"
               "3. Identify duplicates (e.g., `bat-extract`, `bat-simple-extract`, `extract-bat-core` all doing similar things)\n"
               "4. Delete unused: `supabase functions delete <name>`\n"
               "5. Target: ~50 active functions",
        "prevention": "Hard Rule #1: Don't create new functions without retiring old ones. Maintain TOOLS.md as the source of truth.",
    },
    {
        "symptom": "Vehicle valuation estimates are wildly wrong — $200K Civic, $5K 911.",
        "diagnosis": "The valuation function is using ConceptCarz editorial estimates as comparable sales, or it's pulling comps from the wrong Y/M/M.",
        "fix": "1. Check what comps were used:\n"
               "```sql\nSELECT * FROM vehicle_valuations WHERE vehicle_id = '<id>';\n```\n\n"
               "2. Exclude ConceptCarz from comps:\n"
               "```sql\n-- Comps query should include:\nWHERE auction_source != 'conceptcarz'\n  AND reserve_status != 'reserve_not_met'\n  AND sale_price IS NOT NULL\n```\n\n"
               "3. Re-run `compute-vehicle-valuation` after fixing the comp pool.",
        "prevention": "Always filter comps to real auction sales only. Exclude ConceptCarz, RNM vehicles, and NULL prices.",
    },
    {
        "symptom": "Cron jobs consuming 40% of compute budget. 131 active jobs.",
        "diagnosis": "Too many crons, running too frequently. Some at 1-minute intervals for non-time-sensitive tasks.",
        "fix": "Audit and consolidate:\n"
               "```sql\n-- Find frequent crons\nSELECT jobid, schedule, command, active\nFROM cron.job\nWHERE schedule LIKE '*/1 %' OR schedule LIKE '*/2 %'\nORDER BY schedule;\n\n"
               "-- Change interval\nSELECT cron.unschedule(<jobid>);\nSELECT cron.schedule('job-name', '*/15 * * * *', $$SELECT function()$$);\n```\n\n"
               "Target: 50-60 active crons, none faster than 5 minutes.",
        "prevention": "Hard Rule #3: No crons faster than 5 minutes. Most should be 10-15 min. Use event-driven architecture instead.",
    },
    {
        "symptom": "photo-pipeline-orchestrator is processing the same images repeatedly.",
        "diagnosis": "The orchestrator isn't properly marking images as completed, or the selection query doesn't exclude already-processed images.",
        "fix": "Check processing status distribution:\n"
               "```sql\nSELECT ai_processing_status, count(*)\nFROM vehicle_images\nGROUP BY ai_processing_status;\n```\n\n"
               "If images are cycling between 'pending' and 'processing':\n"
               "1. Check for stale locks: `SELECT * FROM queue_lock_health;`\n"
               "2. Release stale locks: `SELECT * FROM release_stale_locks();`\n"
               "3. Check the worker for error patterns in logs",
        "prevention": "Ensure worker properly sets ai_processing_status='completed' after processing. Use content_hash to skip already-processed images.",
    },
    {
        "symptom": "Multiple Claude agents stepping on each other's work — editing the same files, running duplicate migrations.",
        "diagnosis": "No coordination between concurrent sessions. Agents don't check ACTIVE_AGENTS.md or recent session logs.",
        "fix": "Coordination protocol:\n"
               "1. Check `.claude/ACTIVE_AGENTS.md` before starting work\n"
               "2. Register yourself with task + files you'll touch\n"
               "3. Check recent sessions: `cat ~/.claude/projects/-Users-skylar-nuke/sessions-index.json | jq '.entries[-3:]'`\n"
               "4. Claim specific areas — don't overlap with other agents\n"
               "5. De-register when done",
        "prevention": "Always follow the SESSION START RITUAL from CLAUDE.md. Check ACTIVE_AGENTS.md and recent session logs before starting any work.",
    },
    {
        "symptom": "FK constraint errors when trying to delete vehicles.",
        "diagnosis": "Child tables (vehicle_images, auction_comments, vehicle_events, vehicle_observations, etc.) have foreign key constraints referencing the vehicles table.",
        "fix": "Delete child records FIRST, then vehicles:\n\n"
               "```sql\n-- Delete children in correct order\nDELETE FROM vehicle_images WHERE vehicle_id IN (SELECT id FROM vehicles WHERE status = 'duplicate' LIMIT 100);\n"
               "DELETE FROM auction_comments WHERE vehicle_id IN (SELECT id FROM vehicles WHERE status = 'duplicate' LIMIT 100);\n"
               "DELETE FROM vehicle_events WHERE vehicle_id IN (SELECT id FROM vehicles WHERE status = 'duplicate' LIMIT 100);\n"
               "DELETE FROM vehicle_observations WHERE vehicle_id IN (SELECT id FROM vehicles WHERE status = 'duplicate' LIMIT 100);\n"
               "-- Now delete the vehicles\n"
               "DELETE FROM vehicles WHERE id IN (SELECT id FROM vehicles WHERE status = 'duplicate' LIMIT 100);\n```\n\n"
               "Batch all deletes in 100-1,000 row chunks.",
        "prevention": "Always check FK constraints before bulk deletes: `SELECT * FROM information_schema.referential_constraints WHERE constraint_schema = 'public' AND referenced_table_name = 'vehicles';`",
    },
    {
        "symptom": "Database queries timing out at 15 seconds for authenticated users.",
        "diagnosis": "The `authenticated` role has a 15s statement_timeout. This is by design to protect the REST API.",
        "fix": "Don't change the timeout (Hard Rule #12). Fix the query instead:\n\n"
               "1. Check the query plan: `EXPLAIN ANALYZE <query>;`\n"
               "2. Add missing indexes\n"
               "3. Narrow the WHERE clause\n"
               "4. Use cursor-based pagination instead of OFFSET\n"
               "5. If the query truly needs > 15s, run it as the `postgres` role (120s limit) via direct psql/MCP, not the API",
        "prevention": "Design API queries to complete in < 5s. Use indexes, pagination, and pre-computed aggregates.",
    },
]

# Additional diagnostic question templates
DIAGNOSTIC_TEMPLATES = [
    ("What do I check when {symptom}?", "symptom"),
    ("How do I troubleshoot {symptom}?", "symptom"),
    ("{symptom} — what's going on?", "symptom"),
    ("Help! {symptom}", "symptom"),
    ("I'm seeing {symptom}. How do I fix it?", "symptom"),
]

# Generic operational Q&A
OPERATIONAL_QA = [
    (
        "The platform seems slow. How do I diagnose it?",
        "Diagnostic checklist:\n\n"
        "1. **Check active queries:**\n"
        "```sql\nSELECT pid, state, wait_event_type, age(now(), query_start) as duration, left(query, 80)\n"
        "FROM pg_stat_activity\nWHERE state = 'active' AND pid != pg_backend_pid()\nORDER BY query_start;\n```\n\n"
        "2. **Check locks:**\n"
        "```sql\nSELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock';\n```\n\n"
        "3. **Check DB size:**\n"
        "```sql\nSELECT pg_size_pretty(pg_database_size('postgres'));\n```\n\n"
        "4. **Check queue health:**\n"
        "```bash\ncurl -s \"$SUPABASE_URL/functions/v1/ralph-wiggum-rlm-extraction-coordinator\" \\\n"
        "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
        "  -H \"Content-Type: application/json\" \\\n"
        "  -d '{\"action\": \"brief\"}' | jq\n```\n\n"
        "5. **Check stale locks:**\n"
        "```sql\nSELECT * FROM queue_lock_health;\n```\n\n"
        "Common causes: unbounded queries, lock cascades, stale locks, DDL during active queries.",
    ),
    (
        "How do I check the overall system health?",
        "Three commands:\n\n"
        "1. **Coordination brief** (queue health, errors, recommendations):\n"
        "```bash\ncurl -s -X POST \"$SUPABASE_URL/functions/v1/ralph-wiggum-rlm-extraction-coordinator\" \\\n"
        "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
        "  -H \"Content-Type: application/json\" \\\n"
        "  -d '{\"action\": \"brief\"}' | jq\n```\n\n"
        "2. **Database stats** (counts, sizes):\n"
        "```bash\ncurl -s \"$SUPABASE_URL/functions/v1/db-stats\" \\\n"
        "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" | jq\n```\n\n"
        "3. **Data quality** (per-source grades):\n"
        "```bash\ncurl -s -X POST \"$SUPABASE_URL/functions/v1/data-quality-monitor\" \\\n"
        "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
        "  -H \"Content-Type: application/json\" \\\n"
        "  -d '{\"action\": \"alerts\"}' | jq\n```",
    ),
    (
        "How do I check what's currently running in the database?",
        "```sql\n-- Active queries\nSELECT pid, state, wait_event_type,\n"
        "  age(now(), query_start) as duration,\n"
        "  left(query, 100) as query\n"
        "FROM pg_stat_activity\n"
        "WHERE state != 'idle' AND pid != pg_backend_pid()\n"
        "ORDER BY query_start;\n\n"
        "-- Lock waiters\nSELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock';\n\n"
        "-- Long-running queries (> 30s)\nSELECT pid, age(now(), query_start), left(query, 80)\n"
        "FROM pg_stat_activity\n"
        "WHERE state = 'active' AND age(now(), query_start) > interval '30 seconds';\n```",
    ),
    (
        "How do I kill a runaway query?",
        "1. Find the query:\n"
        "```sql\nSELECT pid, state, age(now(), query_start), left(query, 100)\n"
        "FROM pg_stat_activity\nWHERE state = 'active'\nORDER BY query_start;\n```\n\n"
        "2. Try graceful cancel first:\n"
        "```sql\nSELECT pg_cancel_backend(<pid>);\n```\n\n"
        "3. If it doesn't respond, force terminate:\n"
        "```sql\nSELECT pg_terminate_backend(<pid>);\n```\n\n"
        "Note: `pg_cancel_backend` sends a cancel signal (safe). `pg_terminate_backend` kills the connection (may leave partial work).",
    ),
    (
        "How do I check if cron jobs are running properly?",
        "```sql\n-- List all active crons\nSELECT jobid, schedule, command, active, jobname\n"
        "FROM cron.job\nWHERE active = true\nORDER BY jobid;\n\n"
        "-- Check recent job runs\nSELECT jobid, command, status, return_message,\n"
        "  start_time, end_time\nFROM cron.job_run_details\n"
        "ORDER BY start_time DESC\nLIMIT 20;\n\n"
        "-- Find failing crons\nSELECT jobid, command, count(*) as failures\n"
        "FROM cron.job_run_details\nWHERE status = 'failed'\n"
        "  AND start_time > now() - interval '24 hours'\n"
        "GROUP BY jobid, command\nORDER BY failures DESC;\n```",
    ),
    (
        "How do I check edge function logs?",
        "Use the Supabase MCP or CLI:\n\n"
        "```bash\n# Via CLI\nsupabase functions logs <function-name>\n\n"
        "# Via MCP\nmcp__supabase__get_logs(service='edge-function')\n\n"
        "# Via curl (last 100 entries)\ncurl -s \"$SUPABASE_URL/functions/v1/<function-name>\" \\\n"
        "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
        "  --head\n```\n\n"
        "For debugging extraction issues, check `haiku-extraction-worker` and `sonnet-supervisor` logs.",
    ),
    (
        "How do I check the import queue status?",
        "```sql\n-- Queue state summary\nSELECT status, count(*) FROM import_queue GROUP BY status ORDER BY count(*) DESC;\n\n"
        "-- Stuck/stale items\nSELECT id, listing_url, status, claimed_at,\n"
        "  age(now(), claimed_at) as claim_age\n"
        "FROM import_queue\n"
        "WHERE status = 'processing' AND claimed_at < now() - interval '30 minutes';\n\n"
        "-- Recent failures\nSELECT id, listing_url, error_message, created_at\n"
        "FROM import_queue\n"
        "WHERE status = 'failed'\nORDER BY created_at DESC\nLIMIT 10;\n```\n\n"
        "If many items are stuck in 'processing', release stale locks: `SELECT * FROM release_stale_locks();`",
    ),
    (
        "How do I check the BaT extraction queue?",
        "```sql\n-- Queue status\nSELECT status, count(*) FROM bat_extraction_queue GROUP BY status;\n\n"
        "-- Stuck items\nSELECT * FROM bat_extraction_queue\nWHERE status = 'processing'\n"
        "  AND updated_at < now() - interval '30 minutes';\n\n"
        "-- Recent completions\nSELECT listing_url, status, completed_at\n"
        "FROM bat_extraction_queue\nWHERE completed_at IS NOT NULL\n"
        "ORDER BY completed_at DESC\nLIMIT 10;\n```",
    ),
    (
        "What should I do during a production incident?",
        "Incident response protocol:\n\n"
        "1. **ASSESS** — What's broken?\n"
        "   - API errors? → Check PostgREST: `NOTIFY pgrst, 'reload schema';`\n"
        "   - Slow? → Check locks: `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';`\n"
        "   - Queue backup? → Check stale locks: `SELECT * FROM queue_lock_health;`\n\n"
        "2. **STABILIZE** — Stop the bleeding\n"
        "   - Kill runaway queries: `SELECT pg_cancel_backend(<pid>);`\n"
        "   - Release stale locks: `SELECT * FROM release_stale_locks();`\n"
        "   - Pause pipelines if needed: set `NUKE_ANALYSIS_PAUSED` flag\n\n"
        "3. **FIX** — Address root cause\n"
        "   - Batch any unbounded writes (Rule #8)\n"
        "   - Add missing indexes\n"
        "   - Fix broken extraction logic\n\n"
        "4. **PREVENT** — Don't let it happen again\n"
        "   - Document in DONE.md\n"
        "   - Add monitoring/alerts\n"
        "   - Update hard rules if needed",
    ),
    (
        "How do I know if the stale lock cron is working?",
        "Check cron job 188:\n\n"
        "```sql\n-- Is it active?\nSELECT * FROM cron.job WHERE jobid = 188;\n\n"
        "-- Recent runs\nSELECT status, return_message, start_time, end_time\n"
        "FROM cron.job_run_details\nWHERE jobid = 188\n"
        "ORDER BY start_time DESC\nLIMIT 5;\n```\n\n"
        "Also check the lock health view:\n"
        "```sql\nSELECT * FROM queue_lock_health;\n```\n\n"
        "If stale_count > 0, the cron isn't cleaning up fast enough — consider running it more frequently (but still ≥ 5 min per Rule #3).",
    ),
    (
        "Extraction quality has dropped — new vehicles have less data than before.",
        "Diagnostic approach:\n\n"
        "1. **Compare recent vs old quality:**\n"
        "```sql\nSELECT\n"
        "  CASE WHEN created_at > now() - interval '7 days' THEN 'last_7d' ELSE 'older' END as period,\n"
        "  avg(data_quality_score)::int,\n"
        "  count(*) FILTER (WHERE description IS NOT NULL) * 100 / count(*) as desc_pct,\n"
        "  count(*) FILTER (WHERE vin IS NOT NULL) * 100 / count(*) as vin_pct\n"
        "FROM vehicles WHERE status = 'active'\nGROUP BY 1;\n```\n\n"
        "2. **Check enrichment pipeline:**\n"
        "- Is the extraction worker running? Check logs\n"
        "- Are enrichment crons active? Check `cron.job`\n"
        "- Is `NUKE_ANALYSIS_PAUSED` set?\n\n"
        "3. **Check source changes:**\n"
        "- BaT/C&B may have changed their HTML structure\n"
        "- The source extractor may need updating\n"
        "- Re-run a test extraction on a known URL to compare",
    ),
    (
        "How do I recover from a botched migration?",
        "1. **Check if the migration is still running:**\n"
        "```sql\nSELECT pid, state, left(query, 100), age(now(), query_start)\n"
        "FROM pg_stat_activity WHERE state = 'active';\n```\n\n"
        "2. **Cancel if needed:**\n"
        "```sql\nSELECT pg_cancel_backend(<pid>);\n```\n\n"
        "3. **Check for partial writes:**\n"
        "```sql\n-- How many rows were affected?\nSELECT count(*) FROM vehicles WHERE <condition>;\n```\n\n"
        "4. **Revert if possible:**\n"
        "- If the migration was in a transaction, it auto-rolled back on cancel\n"
        "- If it was batched (DO $$ loop), partial batches are committed — you may need a reverse migration\n\n"
        "5. **Reload PostgREST if DDL was involved:**\n"
        "```sql\nNOTIFY pgrst, 'reload schema';\n```",
    ),
    (
        "How do I check database table sizes?",
        "```sql\n-- Top tables by size\nSELECT relname as table_name,\n"
        "  pg_size_pretty(pg_total_relation_size(relid)) as total_size,\n"
        "  pg_size_pretty(pg_relation_size(relid)) as data_size,\n"
        "  pg_size_pretty(pg_indexes_size(relid)) as index_size\n"
        "FROM pg_catalog.pg_statio_user_tables\n"
        "ORDER BY pg_total_relation_size(relid) DESC\n"
        "LIMIT 20;\n\n"
        "-- Total database size\nSELECT pg_size_pretty(pg_database_size('postgres'));\n\n"
        "-- Tables with no rows\nSELECT relname FROM pg_class\n"
        "WHERE relkind = 'r' AND reltuples = 0\n"
        "  AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');\n```",
    ),
    (
        "How do I monitor extraction throughput?",
        "Check extraction rates over time:\n\n"
        "```sql\n-- Vehicles created per day (last 7 days)\nSELECT date_trunc('day', created_at) as day,\n"
        "  count(*) as vehicles_created,\n"
        "  avg(data_quality_score)::int as avg_quality\n"
        "FROM vehicles\nWHERE created_at > now() - interval '7 days'\n"
        "GROUP BY 1 ORDER BY 1;\n\n"
        "-- Queue drain rate\nSELECT date_trunc('hour', completed_at) as hour,\n"
        "  count(*) as completed\n"
        "FROM import_queue\nWHERE completed_at > now() - interval '24 hours'\n"
        "GROUP BY 1 ORDER BY 1;\n```\n\n"
        "Or use the coordination brief for real-time status.",
    ),
]

# Symptom variations for known incidents
SYMPTOM_VARIATIONS = {
    "stale_locks": [
        "Images are stuck in processing",
        "Queue items aren't moving",
        "Processing records are older than 30 minutes",
        "Workers seem to have crashed",
        "Lock health view shows stale counts",
    ],
    "pgrst": [
        "PGRST002 errors on the API",
        "REST endpoints are returning 500 errors",
        "Supabase API is broken after a migration",
        "PostgREST isn't seeing my new table",
        "API returns schema errors",
    ],
    "cost_spike": [
        "Our Supabase bill is too high",
        "Costs doubled this month",
        "The AI pipeline is too expensive",
        "We need to reduce platform costs",
        "What's driving our monthly spend?",
    ],
    "queue_backup": [
        "Import queue has thousands of pending items",
        "Queue processing is stuck",
        "New extractions aren't being processed",
        "The extraction pipeline is backed up",
        "Pending count in import_queue keeps growing",
    ],
    "duplicates": [
        "Same vehicle appears multiple times",
        "Duplicate records in the database",
        "How do I dedup vehicles?",
        "BaT listings were imported twice",
        "Seeing 3-4 records for the same car",
    ],
}


def generate_incident_response(done_entries: list[DoneEntry], limit: int = 2000) -> list[dict]:
    pairs = []

    # 1. Known incident patterns (detailed, manually crafted)
    for incident in KNOWN_INCIDENTS:
        # Symptom → full response
        pairs.append(make_pair(
            incident["symptom"],
            f"**Diagnosis:** {incident['diagnosis']}\n\n"
            f"**Fix:**\n{incident['fix']}\n\n"
            f"**Prevention:** {incident['prevention']}",
            "incident_response",
        ))

        # "How do I fix X?"
        short_symptom = incident["symptom"].split(".")[0]
        pairs.append(make_pair(
            f"How do I fix: {short_symptom}?",
            f"{incident['fix']}\n\n{incident['prevention']}",
            "incident_response",
        ))

        # "What caused X?"
        pairs.append(make_pair(
            f"What caused: {short_symptom}?",
            f"**Diagnosis:** {incident['diagnosis']}\n\n**Prevention:** {incident['prevention']}",
            "incident_response",
        ))

    # 2. Symptom variations — same problem, different phrasing
    stale_lock_incident = KNOWN_INCIDENTS[0]
    for variation in SYMPTOM_VARIATIONS.get("stale_locks", []):
        pairs.append(make_pair(
            variation,
            f"This sounds like stale locks. {stale_lock_incident['diagnosis']}\n\n{stale_lock_incident['fix']}",
            "incident_response",
        ))

    pgrst_incident = KNOWN_INCIDENTS[1]
    for variation in SYMPTOM_VARIATIONS.get("pgrst", []):
        pairs.append(make_pair(
            variation,
            f"{pgrst_incident['diagnosis']}\n\nImmediate fix:\n```sql\nNOTIFY pgrst, 'reload schema';\n```\n\n{pgrst_incident['prevention']}",
            "incident_response",
        ))

    cost_incident = KNOWN_INCIDENTS[2]
    for variation in SYMPTOM_VARIATIONS.get("cost_spike", []):
        pairs.append(make_pair(
            variation,
            f"{cost_incident['diagnosis']}\n\n{cost_incident['fix']}",
            "incident_response",
        ))

    queue_incident = KNOWN_INCIDENTS[5]
    for variation in SYMPTOM_VARIATIONS.get("queue_backup", []):
        pairs.append(make_pair(
            variation,
            f"{queue_incident['diagnosis']}\n\n{queue_incident['fix']}",
            "incident_response",
        ))

    dup_incident = KNOWN_INCIDENTS[4]
    for variation in SYMPTOM_VARIATIONS.get("duplicates", []):
        pairs.append(make_pair(
            variation,
            f"{dup_incident['diagnosis']}\n\n{dup_incident['fix']}",
            "incident_response",
        ))

    # 3. Operational Q&A
    for q, a in OPERATIONAL_QA:
        pairs.append(make_pair(q, a, "incident_response"))

    # 4. From DONE.md incidents
    incidents = [e for e in done_entries if e.is_incident]

    for entry in incidents[:200]:
        details_text = "\n".join(f"- {d}" for d in entry.details[:5]) if entry.details else ""
        metrics_text = ""
        if entry.metrics:
            metrics_text = "\n\nMetrics: " + ", ".join(f"{k}: {v}" for k, v in entry.metrics.items())

        if entry.details:
            pairs.append(make_pair(
                f"Tell me about the {entry.area} work from {entry.date}: {entry.title}",
                f"**[{entry.area}] {entry.title}** ({entry.date})\n\n{details_text}{metrics_text}\n\n"
                f"This was part of operational maintenance to keep the platform healthy.",
                "incident_response",
            ))

        if entry.metrics:
            before_keys = [k for k in entry.metrics if k.startswith("before_")]
            for bk in before_keys:
                unit = bk.replace("before_", "")
                ak = f"after_{unit}"
                if ak in entry.metrics:
                    pairs.append(make_pair(
                        f"What was the result of the {entry.area} {entry.title.lower().split('—')[0].strip()}?",
                        f"Went from {entry.metrics[bk]} {unit} to {entry.metrics[ak]} {unit}.\n\n"
                        f"Details:\n{details_text}" if details_text else
                        f"Reduced from {entry.metrics[bk]} to {entry.metrics[ak]} {unit}.",
                        "incident_response",
                    ))

    # 5. Combined diagnostic questions with templates
    for incident in KNOWN_INCIDENTS:
        short = incident["symptom"].split(".")[0].lower()
        for template, _ in DIAGNOSTIC_TEMPLATES:
            pairs.append(make_pair(
                template.format(symptom=short),
                f"**Diagnosis:** {incident['diagnosis']}\n\n{incident['fix']}",
                "incident_response",
            ))

    random.shuffle(pairs)
    return pairs[:limit]
