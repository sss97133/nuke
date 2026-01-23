# Ralph Wiggum - BaT Backlog Loop

## Mission
Discover and queue all **not-yet-scraped** Bring a Trailer listing URLs.
Target scale: **~223k listings**.

## Constraints
- **Firecrawl budget cap: 30k credits**.
- Prefer **BaT API + Wayback CDX** (free) over Firecrawl.
- Avoid schema changes; operate via existing edge functions and queues.

## Core Loop
1. Run `bat-full-archive-crawler` (API discovery).
2. Run `bat-wayback-crawler` (Wayback CDX discovery).
3. Track `import_queue` counts for BaT listing URLs.
4. When discovery slows (<1% new URLs for 3 runs), pause discovery and focus on draining the queue.

## Success Metrics
- `import_queue` BaT total >= 223,000
- Discovery yields per run are stable (no spikes or regressions)
- Low Firecrawl usage

## Safety
- Do not call Firecrawl-heavy functions unless absolutely required.
- Log all discovery counts and queue stats.

## RLM_CONTEXT

{"type":"result","subtype":"success","is_error":false,"duration_ms":15594,"duration_api_ms":15578,"num_turns":1,"result":"## BaT Backlog Discovery & Ingestion - Consolidated Summary\n\n### Target & Budget\n- **Goal**: Queue ~223k BaT listing URLs\n- **Budget cap**: 30k Firecrawl credits (avoid unless discovery <1% for 3 runs)\n- **Priority**: BaT API + Wayback CDX (free) over Firecrawl\n\n---\n\n### Core Loop\n1. Run `bat-full-archive-crawler` (BaT API - free)\n2. Run `bat-wayback-crawler` (Wayback CDX - free)\n3. Track `import_queue` counts for BaT URLs\n4. **Pause trigger**: <1% new URLs for 3 consecutive runs → switch to queue draining\n\n---\n\n### Key Files\n- `supabase/functions/bat-full-archive-crawler/index.ts` - BaT search API crawler\n- `supabase/functions/bat-wayback-crawler/index.ts` - Wayback Machine CDX crawler\n- `supabase/functions/bat-archive-crawler/index.ts` - Firecrawl fallback (avoid)\n- `scripts/ralph-wiggum.sh` - Orchestration (`--bat-backlog`, `--bat-loop` flags)\n\n---\n\n### Concrete Tasks\n- **bat-full-archive-crawler**: Query BaT API with year range filters (9 ranges: 1900-2026), paginated at 48/page\n- **bat-wayback-crawler**: CDX API with `matchType: prefix`, 5 pages/run (up to 50k URLs), 1s rate limit\n- Deduplicate against `vehicles.bat_auction_url`, `vehicles.discovery_url`, `import_queue.listing_url`\n- Insert to `import_queue` in batches of 1000\n\n---\n\n### Testing Steps\n1. Check status: `{\"action\": \"status\"}` on both crawlers\n2. Run: `{\"pages_per_run\": 10}` for archive, `{\"pages_per_run\": 5}` for wayback\n3. Monitor `urls_queued` vs `urls_discovered` ratio\n4. Reset if needed: `{\"reset\": true}`\n\n---\n\n### Queue Monitoring\n```\nFilter: listing_url=ilike.%bringatrailer.com/listing/%\n```\n- Track: `pending_bat`, `total_bat` counts\n- State stored in `system_state` table (keys: `bat_archive_crawl`, `bat_wayback_crawl`)\n\n---\n\n### CLI Commands\n```bash\n./ralph-wiggum.sh --bat-backlog   # Single cycle\n./ralph-wiggum.sh --bat-loop      # Continuous loop\n```\n\n---\n\n### Blockers/Decisions\n- BaT API response structure may need adjustment\n- Wayback CDX returns stale/duplicate URLs - dedup required\n- Firecrawl requires `FIRECRAWL_API_KEY` env var (only use as last resort)\n\n---\n\n### Success Metrics\n- `import_queue` BaT total ≥ 223,000\n- Stable discovery yields (no spikes/regressions)\n- Minimal Firecrawl usage\n\n---\n\n### Next Actions\n1. Run `bat-wayback-crawler` with `{\"action\": \"status\"}` to check current state\n2. Run `bat-full-archive-crawler` with `{\"action\": \"status\"}`\n3. Execute discovery cycles, log `archive_queued` + `wayback_queued`\n4. Query `import_queue` for BaT pending count after each run","session_id":"027f62b3-b618-444e-968a-d29049084ea0","total_cost_usd":0.07160549999999999,"usage":{"input_tokens":3,"cache_creation_input_tokens":6504,"cache_read_input_tokens":18931,"output_tokens":859,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":6504}},"modelUsage":{"claude-opus-4-5-20251101":{"inputTokens":3,"outputTokens":859,"cacheReadInputTokens":18931,"cacheCreationInputTokens":6504,"webSearchRequests":0,"costUSD":0.07160549999999999,"contextWindow":200000,"maxOutputTokens":64000}},"permission_denials":[],"uuid":"6bb048f4-d94b-45f0-b87b-ab2a37918034"}

## RLM_INPUT_FILES

- scripts/rlm/bat_backlog_prompt.md

- supabase/functions/bat-full-archive-crawler/index.ts

- supabase/functions/bat-wayback-crawler/index.ts

- supabase/functions/bat-archive-crawler/index.ts

- scripts/ralph-wiggum.sh

- scripts/ralph-process-bat-queue.ts

- docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md

- docs/systems/IMPORT_QUEUE_ROUTING.md

- docs/BAT_EXTRACTION_MIGRATION_COMPLETE.md
