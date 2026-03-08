# Nuke Sentinel

24/7 monitoring agent for the Nuke vehicle data platform.

## What It Does

1. **Tool Scout** - Finds new Claude tools, MCPs, AI resources on HN/GitHub
2. **Pipeline Monitor** - Watches extraction health, alerts on failures
3. **Source Hunter** - Discovers new vehicle data sources
4. **MCP Tester** - Evaluates new MCPs for usefulness

## Quick Start

```bash
# Check setup
cd /Users/skylar/nuke/agents/nuke-sentinel
python bootstrap.py

# Run locally (single cycle)
dotenvx run -- python runner.py --once

# Run locally (continuous)
dotenvx run -- python runner.py

# Deploy to Orgo
export ORGO_API_KEY="sk_live_..."
./deploy-orgo.sh
```

## File Structure

```
nuke-sentinel/
├── CLAUDE.md        # Agent instructions
├── config.json      # Configuration
├── bootstrap.py     # Setup/deployment
├── runner.py        # Main loop
├── deploy-orgo.sh   # Orgo deployment
├── tasks/           # Task queue (JSON)
├── logs/            # Execution logs
├── reports/         # Generated reports
├── alerts/          # Critical alerts
└── discoveries/     # New finds
```

## Tasks

| Task | Schedule | Purpose |
|------|----------|---------|
| tool-scout | 6 hours | Find new Claude/AI tools |
| pipeline-health | 30 mins | Check extraction status |
| source-discovery | daily | Find vehicle data sources |

## Configuration

Edit `config.json` to customize:
- Search keywords and sources
- Alert thresholds
- Notification channels
- Schedule intervals

## Environment Variables

Required:
- `VITE_SUPABASE_URL` - Nuke Supabase URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service key
- `ORGO_API_KEY` - Orgo workspace API key (for cloud deployment)

Optional:
- `ANTHROPIC_API_KEY` - For Claude API calls
- `TELEGRAM_BOT_TOKEN` - For Telegram alerts

## Alerts

Alerts are created when:
- Pipeline error rate > 10%
- Queue stalled > 60 minutes
- New domain starts failing

Alerts saved to `alerts/` and optionally sent to:
- Supabase `sentinel_alerts` table
- Telegram (if configured)

## Extending

Add new task types in `runner.py`:

```python
def run_my_task(self, task: dict) -> dict:
    # Your logic here
    return {"status": "completed"}

# Register in handlers dict
handlers = {
    "my-task": self.run_my_task,
    # ...
}
```

Create task file in `tasks/`:

```json
{
  "id": "004",
  "type": "my-task",
  "priority": 1,
  "schedule": "every 2 hours",
  "params": {},
  "status": "pending"
}
```

## Local Testing with Ollama

The agent can use local Ollama for analysis:

```bash
# Analyze findings with local LLM
ollama run llama3.1:8b "Analyze these tool scout findings for relevance to a vehicle data platform: ..."
```
