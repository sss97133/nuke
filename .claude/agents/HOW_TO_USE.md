# Agent Coordination - Quick Start

## When You Open a New Claude Session

Paste this to see what work is available:

```bash
cd /Users/skylar/nuke && dotenvx run -- bash -c 'PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "SELECT get_agent_system_status();"'
```

## Claim a Task

Tell Claude: "I'm acting as the **[oracle/guardian/sentinel/curator/harvester]** agent. Claim my next task."

Claude will run:
```sql
SELECT * FROM claim_next_task('oracle', 'session-xyz');
```

## Mark Task Complete

```sql
UPDATE agent_tasks SET status = 'completed', completed_at = NOW(), result = '{"notes": "what you did"}' WHERE id = 'task-uuid';
```

## Add a New Task

```sql
INSERT INTO agent_tasks (title, description, agent_type, priority)
VALUES ('Task title', 'What to do', 'oracle', 80);
```

## Current Priority Order

1. **oracle** - Database indexes & connection pooling (P95-90)
2. **guardian** - RLS policies & rate limiting (P85-80)
3. **sentinel** - Health checks & metrics (P75-70)
4. **harvester** - Extractor consolidation (P65-60)
5. **curator** - Deduplication & validation (P55-50)

## Tables

- `agent_registry` - Agent definitions
- `agent_tasks` - Work queue
- `agent_context` - Shared memory between agents
