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

## Agents

| ID | Name | Focus | Use When |
|----|------|-------|----------|
| `boss` | Architect | Coordination | Planning sessions, conflict resolution |
| `guardian` | Guardian | Security | Auth issues, RLS, rate limits |
| `oracle` | Oracle | Database | Slow queries, indexes, scaling |
| `sentinel` | Sentinel | Monitoring | Health checks, metrics, alerts |
| `curator` | Curator | Data Quality | Duplicates, conflicts, validation |
| `harvester` | Harvester | Extraction | Scraper issues, source health |
| `scribe` | Scribe | Documentation | API docs, runbooks |

## Workflow

1. **Boss** reviews `get_agent_system_status()`
2. **Boss** creates tasks with `agent_type` assignment
3. **Specialists** call `claim_next_task(agent_type, session_id)`
4. **Specialists** update status to `in_progress`, then `completed`
5. **Specialists** write findings to `agent_context` for others to read
