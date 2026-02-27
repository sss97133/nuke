# Agent Registry

Agents coordinate via Supabase tables: `agent_registry`, `agent_tasks`, `agent_context`

## Quick Commands

```bash
# Check system status
cd /Users/skylar/nuke && dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/rpc/get_agent_system_status" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | jq

# See pending tasks
cd /Users/skylar/nuke && dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/agent_tasks?status=eq.pending&order=priority.desc" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | jq

# Add a task
cd /Users/skylar/nuke && dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/agent_tasks" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "{\"title\": \"TASK_TITLE\", \"agent_type\": \"AGENT_ID\", \"priority\": 80}"'
```

## Active Agent Types (as of 2026-02-27)

| ID | Name | Focus | Persona File |
|----|------|-------|-------------|
| `cwfto` | CWFTO | Workforce transformation | `.claude/agents/cwfto/CLAUDE.md` |
| `coo` | COO | Operations, coordination | `.claude/agents/coo/CLAUDE.md` |
| `cto` | CTO | Architecture, infrastructure | `.claude/agents/cto/CLAUDE.md` |
| `cfo` | CFO | Finance, cost analysis | `.claude/agents/cfo/CLAUDE.md` |
| `cpo` | CPO | Product, UX | `.claude/agents/cpo/CLAUDE.md` |
| `cdo` | CDO | Data, quality | `.claude/agents/cdo/CLAUDE.md` |
| `vp-ai` | VP AI | YONO, ML models | `.claude/agents/vp-ai/CLAUDE.md` |
| `vp-platform` | VP Platform | Infrastructure, perf, security | `.claude/agents/vp-platform/CLAUDE.md` |
| `vp-extraction` | VP Extraction | Scraping, import queue | `.claude/agents/vp-extraction/CLAUDE.md` |
| `vp-deal-flow` | VP Deal Flow | Transfers, marketplace | `.claude/agents/vp-deal-flow/CLAUDE.md` |
| `vp-orgs` | VP Orgs | Organizations, dealers | `.claude/agents/vp-orgs/CLAUDE.md` |
| `vp-docs` | VP Docs | SDK, API docs | `.claude/agents/vp-docs/CLAUDE.md` |
| `vp-photos` | VP Photos | Images, YONO vision | `.claude/agents/vp-photos/CLAUDE.md` |
| `vp-vehicle-intel` | VP Vehicle Intel | Comps, valuations, signals | `.claude/agents/vp-vehicle-intel/CLAUDE.md` |
| `worker` | Worker | General tasks, queue work | `.claude/agents/worker/CLAUDE.md` |

## Legacy Agent Types (DEPRECATED — remapped 2026-02-27)

These types existed in older `agent_tasks` records. All tasks using them have been remapped to active types.

| Legacy Type | Remapped To | Rationale |
|-------------|-------------|-----------|
| `oracle` | `vp-platform` | DB infrastructure, indexes, schema |
| `guardian` | `vp-platform` | Security, rate limiting, RLS policies |
| `sentinel` | `vp-platform` | Health checks, monitoring, metrics |
| `harvester` | `vp-extraction` | Data collection, scraper operations |
| `curator` | `vp-vehicle-intel` | Data quality, dedup, validation |
| `boss` | `coo` | Coordination (from original registry) |
| `scribe` | `vp-docs` | Documentation (from original registry) |

## Workflow

1. **Boss/COO** reviews priorities and routes tasks
2. **VPs** claim tasks via `claim_next_task(agent_type, session_id)`
3. **Workers** handle general tasks, queue processing, data fixes
4. **Specialists** update status to `in_progress`, then `completed`
5. Register in `.claude/ACTIVE_AGENTS.md`, append to `DONE.md` when done
