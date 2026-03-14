"""Generate session pattern training examples.

Distills real Claude Code session logs into prescriptive operational workflows.
Also generates synthetic workflow examples for common operational patterns.
"""

import random
from ..parsers.session_log_parser import SessionExchange
from .tool_routing import make_pair


def condense_tool_sequence(exchange: SessionExchange) -> str:
    """Convert a raw tool sequence into a prescriptive workflow description."""
    steps = []
    seen_patterns = set()

    i = 0
    while i < len(exchange.tool_details):
        detail = exchange.tool_details[i]
        name = detail["name"]
        summary = detail.get("summary", {})

        # Group consecutive reads into one step
        if name == "Read":
            files = [summary.get("file", "unknown")]
            while i + 1 < len(exchange.tool_details) and exchange.tool_details[i + 1]["name"] == "Read":
                i += 1
                files.append(exchange.tool_details[i].get("summary", {}).get("file", "unknown"))
            if len(files) > 1:
                steps.append(f"Read {len(files)} files for context: {', '.join(f[-30:] for f in files[:3])}")
            else:
                steps.append(f"Read `{files[0][-50:]}`")

        # Group consecutive greps/globs
        elif name in ("Grep", "Glob"):
            pattern = summary.get("pattern", "")
            if f"{name}:{pattern}" not in seen_patterns:
                steps.append(f"Search codebase: `{name}` for `{pattern[:50]}`")
                seen_patterns.add(f"{name}:{pattern}")

        # SQL queries
        elif name == "mcp__claude_ai_Supabase__execute_sql":
            query = summary.get("query", "")[:100]
            steps.append(f"Run SQL: `{query}`")

        # Bash commands
        elif name == "Bash":
            cmd = summary.get("command", "")[:100]
            if "curl" in cmd and "functions/v1/" in cmd:
                func = cmd.split("functions/v1/")[-1].split('"')[0].split("'")[0]
                steps.append(f"Call edge function: `{func}`")
            elif "modal" in cmd:
                steps.append(f"Modal command: `{cmd[:80]}`")
            elif "git" in cmd:
                steps.append(f"Git: `{cmd[:60]}`")
            elif "supabase" in cmd:
                steps.append(f"Supabase CLI: `{cmd[:60]}`")
            else:
                steps.append(f"Shell: `{cmd[:60]}`")

        # Edit/Write
        elif name in ("Edit", "Write"):
            file = summary.get("file", summary.get("file_path", "unknown"))
            steps.append(f"{'Edit' if name == 'Edit' else 'Create'} `{str(file)[-50:]}`")

        # MCP tools
        elif name.startswith("mcp__"):
            short_name = name.replace("mcp__claude_ai_Supabase__", "supabase.")
            steps.append(f"MCP: `{short_name}`")

        # Task/subagent
        elif name == "Task":
            steps.append("Launch subagent for research")

        else:
            if name not in seen_patterns:
                steps.append(f"Use `{name}`")
                seen_patterns.add(name)

        i += 1

    return "\n".join(f"{j+1}. {s}" for j, s in enumerate(steps[:15]))


# Synthetic operational workflows for common patterns
SYNTHETIC_WORKFLOWS = [
    {
        "category": "extraction",
        "intent": "Extract a new BaT listing and get all the data",
        "workflow": (
            "To handle this extraction task, here's the workflow:\n\n"
            "1. Check TOOLS.md for the BaT extractor → `complete-bat-import`\n"
            "2. Call the edge function:\n"
            "```bash\ncurl -X POST \"$SUPABASE_URL/functions/v1/complete-bat-import\" \\\n"
            "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
            "  -H \"Content-Type: application/json\" \\\n"
            "  -d '{\"url\": \"<bat_url>\"}'\n```\n"
            "3. This triggers: `extract-bat-core` (description, images, price) + `extract-auction-comments`\n"
            "4. Verify extraction:\n"
            "```sql\nSELECT year, make, model, vin, sale_price, data_quality_score\nFROM vehicles WHERE source_url = '<bat_url>';\n```\n"
            "5. Run enrichment: `decode-vin-and-update`, `enrich-factory-specs`, `compute-vehicle-valuation`\n"
            "6. Check completeness: `calculate-profile-completeness`"
        ),
    },
    {
        "category": "extraction",
        "intent": "Import a batch of URLs from a new auction source",
        "workflow": (
            "To handle this extraction task, here's the workflow:\n\n"
            "1. Check TOOLS.md for an existing extractor for this source\n"
            "2. If no dedicated extractor, use `extract-vehicle-data-ai` (generic AI extraction)\n"
            "3. Batch insert URLs into import_queue (Rule #8 — 1,000 at a time):\n"
            "```sql\nINSERT INTO import_queue (listing_url, status, priority)\nSELECT url, 'pending', 100\nFROM unnest(ARRAY['url1', 'url2', ...]) as url;\n```\n"
            "4. Monitor queue drain:\n"
            "```sql\nSELECT status, count(*) FROM import_queue\nWHERE created_at > now() - interval '1 hour'\nGROUP BY status;\n```\n"
            "5. Check for stale locks if processing stalls:\n"
            "```sql\nSELECT * FROM queue_lock_health;\n```\n"
            "6. After import, run bulk enrichment on the new vehicles"
        ),
    },
    {
        "category": "extraction",
        "intent": "Extract a Cars & Bids listing",
        "workflow": (
            "For C&B extraction:\n\n"
            "1. Use `extract-cars-and-bids-core` (not BaT extractor)\n"
            "```bash\ncurl -X POST \"$SUPABASE_URL/functions/v1/extract-cars-and-bids-core\" \\\n"
            "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
            "  -H \"Content-Type: application/json\" \\\n"
            "  -d '{\"url\": \"<cab_url>\"}'\n```\n"
            "2. C&B has its own comment system — `extract-auction-comments` handles it\n"
            "3. Verify: check vehicle record for Y/M/M, VIN (92% expected), price (95% expected)\n"
            "4. Run enrichment pipeline: VIN decode → factory specs → valuation → completeness"
        ),
    },
    {
        "category": "extraction",
        "intent": "Extract from an unknown/unsupported auction site",
        "workflow": (
            "For unknown sources:\n\n"
            "1. Check TOOLS.md — it might already be supported\n"
            "2. If not, use Firecrawl to scrape:\n"
            "```bash\n# MCP\nmcp__firecrawl__scrape_url(url='<unknown_url>')\n```\n"
            "3. Pass content to generic AI extractor:\n"
            "```bash\ncurl -X POST \"$SUPABASE_URL/functions/v1/extract-vehicle-data-ai\" \\\n"
            "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
            "  -H \"Content-Type: application/json\" \\\n"
            "  -d '{\"url\": \"<unknown_url>\"}'\n```\n"
            "4. Important: use `archiveFetch()` not raw fetch (Rule #4)\n"
            "5. The Haiku worker auto-escalates to Sonnet if confidence < 0.9"
        ),
    },
    {
        "category": "database_investigation",
        "intent": "Investigate why vehicle data quality dropped",
        "workflow": (
            "Here's how to investigate this in the database:\n\n"
            "1. Compare recent vs historical quality:\n"
            "```sql\nSELECT\n  CASE WHEN created_at > now()-interval '7d' THEN 'week' ELSE 'older' END,\n"
            "  avg(data_quality_score)::int, count(*)\nFROM vehicles WHERE status='active'\nGROUP BY 1;\n```\n"
            "2. Check per-source breakdown:\n"
            "```sql\nSELECT auction_source, avg(data_quality_score)::int, count(*)\n"
            "FROM vehicles WHERE created_at > now()-interval '7d'\nGROUP BY 1 ORDER BY 2;\n```\n"
            "3. Check enrichment pipeline health — are crons running?\n"
            "```sql\nSELECT jobid, schedule, active FROM cron.job\nWHERE command ILIKE '%enrich%' OR command ILIKE '%valuation%';\n```\n"
            "4. Check for extraction errors:\n"
            "```sql\nSELECT status, count(*) FROM import_queue\nWHERE created_at > now()-interval '7d'\nGROUP BY status;\n```"
        ),
    },
    {
        "category": "database_investigation",
        "intent": "Check how many vehicles we have and their quality breakdown",
        "workflow": (
            "Here's how to investigate this in the database:\n\n"
            "1. Quick stats (use db-stats edge function for cached counts):\n"
            "```bash\ncurl -s \"$SUPABASE_URL/functions/v1/db-stats\" \\\n"
            "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" | jq\n```\n"
            "2. Per-source breakdown:\n"
            "```sql\nSELECT auction_source,\n  count(*) as total,\n"
            "  avg(data_quality_score)::int as avg_quality,\n"
            "  count(*) FILTER (WHERE data_quality_score >= 80) as grade_a\n"
            "FROM vehicles WHERE status = 'active'\nGROUP BY 1 ORDER BY total DESC;\n```\n"
            "3. Note: use `pg_class.reltuples` for fast approximate counts (Rule #13)"
        ),
    },
    {
        "category": "database_investigation",
        "intent": "Find vehicles that need enrichment",
        "workflow": (
            "Here's how to investigate this in the database:\n\n"
            "1. Vehicles with extraction but no enrichment:\n"
            "```sql\nSELECT id, year, make, model, auction_source, data_quality_score\nFROM vehicles\n"
            "WHERE status = 'active'\n  AND year IS NOT NULL AND make IS NOT NULL\n"
            "  AND data_quality_score < 60\nORDER BY data_quality_score ASC\nLIMIT 100;\n```\n"
            "2. Vehicles needing VIN decode:\n"
            "```sql\nSELECT id, year, make, model, vin\nFROM vehicles\n"
            "WHERE vin IS NOT NULL AND engine_type IS NULL AND status = 'active'\nLIMIT 100;\n```\n"
            "3. Vehicles needing valuation:\n"
            "```sql\nSELECT id, year, make, model\nFROM vehicles\n"
            "WHERE nuke_estimate IS NULL AND year IS NOT NULL AND status = 'active'\nLIMIT 100;\n```\n"
            "4. Run bulk enrichment on the results"
        ),
    },
    {
        "category": "database_operation",
        "intent": "Clean up duplicate vehicle records",
        "workflow": (
            "For this database operation:\n\n"
            "1. Find duplicates by source URL:\n"
            "```sql\nSELECT source_url, array_agg(vehicle_id) as ids, count(*)\n"
            "FROM vehicle_events\nWHERE source_url IS NOT NULL\n"
            "GROUP BY source_url HAVING count(*) > 1\nLIMIT 100;\n```\n"
            "2. For each duplicate group, keep the record with highest completion_percentage\n"
            "3. Merge child records to the keeper:\n"
            "```sql\nUPDATE vehicle_images SET vehicle_id = '<keeper_id>'\nWHERE vehicle_id = '<duplicate_id>';\n```\n"
            "4. Mark duplicates (batched, Rule #8):\n"
            "```sql\nUPDATE vehicles SET status = 'duplicate'\nWHERE id IN (SELECT id FROM vehicles WHERE ... LIMIT 1000);\n```\n"
            "5. Delete child records for duplicates, then delete the duplicate vehicles\n"
            "6. Check locks after each batch: `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';`"
        ),
    },
    {
        "category": "database_operation",
        "intent": "Backfill a column on the vehicles table",
        "workflow": (
            "For this database operation:\n\n"
            "1. Estimate scope:\n"
            "```sql\nSELECT count(*) FROM vehicles WHERE <condition>;\n```\n"
            "2. Test with small batch:\n"
            "```sql\nUPDATE vehicles SET column = value\nWHERE id IN (SELECT id FROM vehicles WHERE <condition> LIMIT 10);\n```\n"
            "3. Check execution time and lock impact\n"
            "4. Full batch migration (Rule #8):\n"
            "```sql\nDO $$\nDECLARE affected INT;\nBEGIN\n  LOOP\n"
            "    UPDATE vehicles SET column = value\n"
            "    WHERE id IN (SELECT id FROM vehicles WHERE <condition> LIMIT 1000);\n"
            "    GET DIAGNOSTICS affected = ROW_COUNT;\n"
            "    EXIT WHEN affected = 0;\n    PERFORM pg_sleep(0.1);\n  END LOOP;\nEND $$;\n```\n"
            "5. After completion: check locks, VACUUM if large delete"
        ),
    },
    {
        "category": "database_operation",
        "intent": "Add a new column to the vehicles table",
        "workflow": (
            "For this database operation:\n\n"
            "1. Check active queries (Rule #11):\n"
            "```sql\nSELECT count(*) FROM pg_stat_activity\nWHERE state='active' AND query ILIKE '%vehicles%';\n```\n"
            "2. If > 2 active, WAIT\n"
            "3. Apply migration:\n"
            "```sql\nALTER TABLE vehicles ADD COLUMN new_field TEXT;\n```\n"
            "4. Reload PostgREST (Rule #15):\n"
            "```sql\nNOTIFY pgrst, 'reload schema';\n```\n"
            "5. Register in pipeline_registry if the column is owned by a function:\n"
            "```sql\nINSERT INTO pipeline_registry (table_name, column_name, owned_by, description)\nVALUES ('vehicles', 'new_field', 'your-function', 'Description');\n```\n"
            "6. Backfill existing rows (batched, Rule #8)"
        ),
    },
    {
        "category": "incident_recovery",
        "intent": "API is returning errors — need to investigate and fix",
        "workflow": (
            "To recover from this issue:\n\n"
            "1. Check if it's PostgREST:\n"
            "```sql\nNOTIFY pgrst, 'reload schema';\n```\n"
            "2. Check for long-running queries:\n"
            "```sql\nSELECT pid, state, age(now(), query_start), left(query, 80)\n"
            "FROM pg_stat_activity WHERE state = 'active'\nORDER BY query_start;\n```\n"
            "3. Check for lock cascades:\n"
            "```sql\nSELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock';\n```\n"
            "4. Kill any runaway queries:\n"
            "```sql\nSELECT pg_cancel_backend(<pid>);\n```\n"
            "5. Release stale locks:\n"
            "```sql\nSELECT * FROM release_stale_locks();\n```"
        ),
    },
    {
        "category": "incident_recovery",
        "intent": "Queue processing is stuck — nothing is being extracted",
        "workflow": (
            "To recover from this issue:\n\n"
            "1. Check queue state:\n"
            "```sql\nSELECT status, count(*) FROM import_queue GROUP BY status;\n```\n"
            "2. Check for stale locks:\n"
            "```sql\nSELECT * FROM queue_lock_health;\n```\n"
            "3. Release stale locks:\n"
            "```sql\nSELECT * FROM release_stale_locks();\n```\n"
            "4. Check worker cron:\n"
            "```sql\nSELECT * FROM cron.job WHERE command ILIKE '%queue%';\n```\n"
            "5. Check worker logs for errors:\n"
            "```bash\nsupabase functions logs haiku-extraction-worker\n```\n"
            "6. If worker is crashing, check recent code changes"
        ),
    },
    {
        "category": "incident_recovery",
        "intent": "Database is running slow — queries are timing out",
        "workflow": (
            "To recover from this issue:\n\n"
            "1. Check active queries:\n"
            "```sql\nSELECT pid, state, wait_event_type, age(now(), query_start), left(query, 80)\n"
            "FROM pg_stat_activity WHERE state != 'idle'\nORDER BY query_start;\n```\n"
            "2. Check for lock cascades:\n"
            "```sql\nSELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock';\n```\n"
            "3. Check DB size:\n"
            "```sql\nSELECT pg_size_pretty(pg_database_size('postgres'));\n```\n"
            "4. Look for unbounded queries and cancel them:\n"
            "```sql\nSELECT pg_cancel_backend(<pid>);\n```\n"
            "5. Check if VACUUM is needed:\n"
            "```sql\nSELECT relname, n_dead_tup, last_autovacuum\nFROM pg_stat_user_tables\nORDER BY n_dead_tup DESC\nLIMIT 10;\n```"
        ),
    },
    {
        "category": "code_modification",
        "intent": "Update an edge function's extraction logic",
        "workflow": (
            "To make this code change:\n\n"
            "1. Read the current function:\n"
            "```bash\ncat supabase/functions/<function-name>/index.ts\n```\n"
            "2. Check TOOLS.md for the function's purpose and dependencies\n"
            "3. Read `_shared/` imports to understand shared utilities\n"
            "4. Make the edit\n"
            "5. Deploy:\n"
            "```bash\nsupabase functions deploy <function-name> --no-verify-jwt\n```\n"
            "6. Test with a known URL to verify the change works\n"
            "7. If DDL was involved, reload PostgREST:\n"
            "```sql\nNOTIFY pgrst, 'reload schema';\n```"
        ),
    },
    {
        "category": "code_modification",
        "intent": "Add a new extractor for a new auction source",
        "workflow": (
            "To make this code change:\n\n"
            "1. Check TOOLS.md — does an extractor already exist?\n"
            "2. Schema Discovery: sample 20-50 listings with Firecrawl first\n"
            "3. Create the function:\n"
            "```bash\nmkdir supabase/functions/extract-<source>/\n```\n"
            "4. Follow the pattern from an existing extractor (e.g., `extract-bat-core`)\n"
            "5. Use shared utilities:\n"
            "   - `_shared/archiveFetch.ts` for page fetching (Rule #4)\n"
            "   - `_shared/supabaseClient.ts` for DB access (Rule #5)\n"
            "   - `_shared/cors.ts` for CORS (Rule #6)\n"
            "6. Register in TOOLS.md (Rule #1)\n"
            "7. Deploy and test\n"
            "8. Consider retiring an old function to stay under ~50"
        ),
    },
    {
        "category": "deployment",
        "intent": "Deploy an updated edge function",
        "workflow": (
            "Deployment steps:\n\n"
            "1. Verify the code works locally (if possible)\n"
            "2. Deploy:\n"
            "```bash\ncd /Users/skylar/nuke\nsupabase functions deploy <function-name> --no-verify-jwt\n```\n"
            "3. Check deployment:\n"
            "```bash\nsupabase functions list | grep <function-name>\n```\n"
            "4. Test with a real request:\n"
            "```bash\ncurl -X POST \"$SUPABASE_URL/functions/v1/<function-name>\" \\\n"
            "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
            "  -H \"Content-Type: application/json\" \\\n"
            "  -d '{\"test\": true}'\n```\n"
            "5. Check logs for errors:\n"
            "```bash\nsupabase functions logs <function-name>\n```"
        ),
    },
    {
        "category": "data_cleanup",
        "intent": "Remove rejected/non-vehicle records from the database",
        "workflow": (
            "For this cleanup task:\n\n"
            "1. Find non-vehicle records:\n"
            "```sql\nSELECT id, make, model FROM vehicles\nWHERE model ILIKE '%wheels%' OR model ILIKE '%manual%'\n"
            "  OR model ILIKE '%pedal%' OR model ILIKE '%sign%'\nLIMIT 100;\n```\n"
            "2. Mark as rejected:\n"
            "```sql\nUPDATE vehicles SET status = 'rejected'\nWHERE id IN (SELECT id FROM vehicles WHERE ... LIMIT 1000);\n```\n"
            "3. Delete child records first (batched):\n"
            "```sql\nDELETE FROM vehicle_images WHERE vehicle_id IN\n"
            "(SELECT id FROM vehicles WHERE status = 'rejected' LIMIT 100);\n```\n"
            "4. Delete the rejected vehicles (batched, Rule #8)\n"
            "5. VACUUM after large deletes"
        ),
    },
    {
        "category": "system_health",
        "intent": "Run a full system health check",
        "workflow": (
            "To check system health:\n\n"
            "1. Coordination brief:\n"
            "```bash\ncurl -s -X POST \"$SUPABASE_URL/functions/v1/ralph-wiggum-rlm-extraction-coordinator\" \\\n"
            "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
            "  -d '{\"action\": \"brief\"}' | jq\n```\n"
            "2. DB stats:\n"
            "```bash\ncurl -s \"$SUPABASE_URL/functions/v1/db-stats\" \\\n"
            "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" | jq\n```\n"
            "3. Queue health:\n"
            "```sql\nSELECT status, count(*) FROM import_queue GROUP BY status;\n```\n"
            "4. Lock health:\n"
            "```sql\nSELECT * FROM queue_lock_health;\n```\n"
            "5. Active queries:\n"
            "```sql\nSELECT count(*) FROM pg_stat_activity WHERE state = 'active';\n```\n"
            "6. DB size:\n"
            "```sql\nSELECT pg_size_pretty(pg_database_size('postgres'));\n```"
        ),
    },
    {
        "category": "system_health",
        "intent": "Monitor extraction pipeline throughput",
        "workflow": (
            "To check system health:\n\n"
            "1. Extraction rate (last 24h):\n"
            "```sql\nSELECT date_trunc('hour', created_at), count(*)\n"
            "FROM vehicles WHERE created_at > now()-interval '24h'\nGROUP BY 1 ORDER BY 1;\n```\n"
            "2. Queue drain rate:\n"
            "```sql\nSELECT date_trunc('hour', completed_at), count(*)\n"
            "FROM import_queue WHERE completed_at > now()-interval '24h'\nGROUP BY 1 ORDER BY 1;\n```\n"
            "3. Quality of recent extractions:\n"
            "```sql\nSELECT auction_source, avg(data_quality_score)::int, count(*)\n"
            "FROM vehicles WHERE created_at > now()-interval '24h'\nGROUP BY 1;\n```\n"
            "4. Worker error rate:\n"
            "```sql\nSELECT status, count(*) FROM import_queue\n"
            "WHERE created_at > now()-interval '24h'\nGROUP BY status;\n```"
        ),
    },
]

# Question templates for synthetic workflows
WORKFLOW_QUESTION_TEMPLATES = [
    "How do I {intent}?",
    "What's the process for: {intent}?",
    "Walk me through {intent}.",
    "I need to {intent}. What are the steps?",
    "Best approach for {intent}?",
]


def generate_session_patterns(exchanges: list[SessionExchange], limit: int = 5000) -> list[dict]:
    pairs = []

    # 1. Real session exchanges — from parsed session logs
    by_category = {}
    for ex in exchanges:
        cat = ex.category_hint
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(ex)

    for cat, cat_exchanges in by_category.items():
        for ex in cat_exchanges:
            intent = ex.user_intent
            if len(intent) < 20:
                continue

            workflow = condense_tool_sequence(ex)
            if not workflow:
                continue

            response_parts = []

            if cat == "extraction":
                response_parts.append("To handle this extraction task, here's the workflow:\n")
            elif cat == "database_investigation":
                response_parts.append("Here's how to investigate this in the database:\n")
            elif cat == "database_operation":
                response_parts.append("For this database operation:\n")
            elif cat == "incident_recovery":
                response_parts.append("To recover from this issue:\n")
            elif cat == "code_modification":
                response_parts.append("To make this code change:\n")
            elif cat == "data_cleanup":
                response_parts.append("For this cleanup task:\n")
            elif cat == "system_health":
                response_parts.append("To check system health:\n")
            elif cat == "deployment":
                response_parts.append("Deployment steps:\n")
            else:
                response_parts.append("Here's the approach:\n")

            response_parts.append(workflow)

            if ex.final_response and len(ex.final_response) > 100:
                response_parts.append(f"\n\n**Result:** {ex.final_response[:500]}")

            response = "\n".join(response_parts)

            if len(response) > 100:
                pairs.append(make_pair(intent[:500], response[:2000], f"session_{cat}"))

    # 2. Synthetic workflows — common operational patterns
    for workflow_def in SYNTHETIC_WORKFLOWS:
        # Generate with multiple question templates
        for template in random.sample(WORKFLOW_QUESTION_TEMPLATES, min(3, len(WORKFLOW_QUESTION_TEMPLATES))):
            question = template.format(intent=workflow_def["intent"].lower())
            pairs.append(make_pair(
                question,
                workflow_def["workflow"],
                f"session_{workflow_def['category']}",
            ))

    # 3. Cross-category workflow combinations
    combo_workflows = [
        {
            "intent": "I found some bad data in the database and want to fix the extraction pipeline to prevent it",
            "workflow": (
                "This combines investigation + code change + cleanup:\n\n"
                "**Phase 1: Investigate**\n"
                "1. Query for bad records to understand the pattern\n"
                "2. Check the extraction logs for the source\n"
                "3. Identify root cause (parser bug, source HTML change, etc.)\n\n"
                "**Phase 2: Fix the Pipeline**\n"
                "1. Read the extractor code: `supabase/functions/<extractor>/index.ts`\n"
                "2. Fix the parsing logic\n"
                "3. Deploy: `supabase functions deploy <extractor> --no-verify-jwt`\n"
                "4. Test on a known URL\n\n"
                "**Phase 3: Clean Up Existing Bad Data**\n"
                "1. Mark bad records: `UPDATE vehicles SET status = 'rejected' WHERE ...` (batched, Rule #8)\n"
                "2. Re-extract from archived pages if possible: `readArchivedPage(url)`\n"
                "3. Check lock impact: `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';`"
            ),
            "category": "database_operation",
        },
        {
            "intent": "Set up monitoring for a new extraction source",
            "workflow": (
                "Steps:\n\n"
                "1. Create the extractor (if not in TOOLS.md)\n"
                "2. Register in TOOLS.md (Rule #1)\n"
                "3. Add quality expectations to the monitoring:\n"
                "```sql\n-- Track extraction quality for the new source\nSELECT\n"
                "  count(*) as total,\n  avg(data_quality_score)::int as avg_quality,\n"
                "  count(*) FILTER (WHERE vin IS NOT NULL) * 100.0 / count(*) as vin_pct\n"
                "FROM vehicles WHERE auction_source = '<new_source>'\n"
                "  AND created_at > now() - interval '7 days';\n```\n"
                "4. Set up a monitoring cron (≥ 5 min, Rule #3):\n"
                "```sql\nSELECT cron.schedule('monitor-new-source', '*/15 * * * *',\n"
                "  $$SELECT check_source_quality('new_source')$$);\n```\n"
                "5. Add alerts for quality drops"
            ),
            "category": "system_health",
        },
        {
            "intent": "Migrate vehicle data from one status to another in bulk",
            "workflow": (
                "For bulk status migration:\n\n"
                "1. Estimate scope:\n"
                "```sql\nSELECT count(*) FROM vehicles WHERE status = 'old_status';\n```\n"
                "2. Test with 10 rows:\n"
                "```sql\nUPDATE vehicles SET status = 'new_status'\nWHERE id IN (SELECT id FROM vehicles WHERE status = 'old_status' LIMIT 10);\n```\n"
                "3. Check execution time and locks\n"
                "4. Batch the full migration (Rule #8):\n"
                "```sql\nDO $$\nDECLARE affected INT;\nBEGIN\n  LOOP\n"
                "    UPDATE vehicles SET status = 'new_status'\n"
                "    WHERE id IN (SELECT id FROM vehicles WHERE status = 'old_status' LIMIT 1000);\n"
                "    GET DIAGNOSTICS affected = ROW_COUNT;\n    EXIT WHEN affected = 0;\n"
                "    PERFORM pg_sleep(0.1);\n  END LOOP;\nEND $$;\n```\n"
                "5. After: check locks, update pipeline_registry if needed, VACUUM"
            ),
            "category": "database_operation",
        },
    ]
    for combo in combo_workflows:
        for template in random.sample(WORKFLOW_QUESTION_TEMPLATES, min(2, len(WORKFLOW_QUESTION_TEMPLATES))):
            question = template.format(intent=combo["intent"].lower())
            pairs.append(make_pair(question, combo["workflow"], f"session_{combo['category']}"))

    random.shuffle(pairs)
    return pairs[:limit]
