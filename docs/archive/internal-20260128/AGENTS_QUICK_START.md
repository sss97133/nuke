# Pipeline Agents Quick Start

**Goal: 1,000,000 profiles in 30 days (33,333 profiles/day)**

## Quick Deploy

```bash
# Deploy all agents
./scripts/deploy-agents.sh

# Run daily pipeline for 33k profiles
./scripts/run-daily-pipeline.sh
```

## Available Agents

### 🤖 Agent Orchestrator
**Main coordinator for all pipeline agents**

```bash
# Check all agent health
curl -X POST 'your-url/functions/v1/agent-orchestrator' \
  -d '{"action": "status"}'

# Get scale metrics (are we on track for 1M?)
curl -X POST 'your-url/functions/v1/agent-orchestrator' \
  -d '{"action": "scale_metrics"}'

# Run daily pipeline (33k profiles)
curl -X POST 'your-url/functions/v1/agent-orchestrator' \
  -d '{"action": "daily_pipeline_run", "params": {"target_profiles": 33333}}'

# Emergency debug when things break
curl -X POST 'your-url/functions/v1/agent-orchestrator' \
  -d '{"action": "emergency_debug"}'
```

### 🔍 Debug Agent
**Real-time diagnostics and bottleneck detection**

```bash
# Get pipeline performance metrics
curl -X POST 'your-url/functions/v1/agent-debug' \
  -d '{"action": "get_pipeline_metrics", "params": {"time_range": "1h"}}'

# Identify bottlenecks
curl -X POST 'your-url/functions/v1/agent-debug' \
  -d '{"action": "identify_bottlenecks"}'

# Generate scale report
curl -X POST 'your-url/functions/v1/agent-debug' \
  -d '{"action": "generate_scale_report"}'
```

### 🔥 Firecrawl Optimization Agent
**Optimizes extraction for 10k+ requests/day**

```bash
# Batch extract 1000 profiles
curl -X POST 'your-url/functions/v1/agent-firecrawl-optimization' \
  -d '{"action": "batch_extract", "params": {"target_profiles": 1000, "parallel_workers": 20}}'

# Optimize for scale
curl -X POST 'your-url/functions/v1/agent-firecrawl-optimization' \
  -d '{"action": "scale_optimization", "params": {"target_hourly_requests": 5000}}'

# Get optimization metrics
curl -X POST 'your-url/functions/v1/agent-firecrawl-optimization' \
  -d '{"action": "get_metrics"}'
```

### 🗄️ Database Optimizer Agent
**Handles 33k+ inserts/day and data quality**

```bash
# Optimize database for scale
curl -X POST 'your-url/functions/v1/agent-database-optimizer' \
  -d '{"action": "optimize_for_scale", "params": {"target_daily_profiles": 33333}}'

# Resolve data conflicts
curl -X POST 'your-url/functions/v1/agent-database-optimizer' \
  -d '{"action": "resolve_conflicts", "params": {"strategy": "auto"}}'

# Run daily optimization
curl -X POST 'your-url/functions/v1/agent-database-optimizer' \
  -d '{"action": "daily_optimization"}'
```

## Daily Workflow for 1M Profiles

### 1. Morning Check (Automated)
```bash
# Run this daily at 2 AM via cron
./scripts/run-daily-pipeline.sh
```

### 2. Monitor Progress
```bash
# Check if on track for 1M
curl -X POST 'your-url/functions/v1/agent-orchestrator' \
  -d '{"action": "scale_metrics"}' | jq '.performance.on_track_for_1m'
```

### 3. Debug Issues
```bash
# If behind target, debug bottlenecks
curl -X POST 'your-url/functions/v1/agent-debug' \
  -d '{"action": "emergency_diagnostic"}'
```

### 4. Scale Optimization
```bash
# If needed, optimize for higher throughput
curl -X POST 'your-url/functions/v1/agent-orchestrator' \
  -d '{"action": "scale_optimization"}'
```

## Key Metrics to Watch

| Metric | Target | Alert If |
|--------|--------|----------|
| Daily profiles | 33,333 | < 26,666 (80%) |
| Extraction success rate | 95% | < 90% |
| Average response time | < 2s | > 3s |
| Pipeline health score | 90%+ | < 80% |

## Scale Targets

- **Daily**: 33,333 profiles
- **Hourly**: 1,389 profiles  
- **Per minute**: 23 profiles
- **Monthly**: 1,000,000 profiles

## Troubleshooting

### Pipeline Running Slow?
```bash
# Check bottlenecks
curl -X POST 'your-url/functions/v1/agent-debug' \
  -d '{"action": "identify_bottlenecks"}'

# Optimize Firecrawl concurrency
curl -X POST 'your-url/functions/v1/agent-firecrawl-optimization' \
  -d '{"action": "tune_concurrency", "params": {"target_concurrent": 30}}'
```

### Database Issues?
```bash
# Check database health
curl -X POST 'your-url/functions/v1/agent-database-optimizer' \
  -d '{"action": "database_health_check"}'

# Run optimization
curl -X POST 'your-url/functions/v1/agent-database-optimizer' \
  -d '{"action": "performance_tuning"}'
```

### High Error Rates?
```bash
# Analyze error patterns
curl -X POST 'your-url/functions/v1/agent-debug' \
  -d '{"action": "analyze_error_patterns"}'
```

## Claude Integration

These agents are designed to be invoked by Claude for maintenance:

```
Hey Claude, can you check if the pipeline is on track for 1M profiles?
→ Claude calls agent-orchestrator with action "scale_metrics"

Claude, the extraction is running slow, can you debug it?
→ Claude calls agent-debug with action "identify_bottlenecks"

Claude, optimize the database for 50k profiles/day
→ Claude calls agent-database-optimizer with action "optimize_for_scale"
```

## Next Steps

1. **Deploy agents**: `./scripts/deploy-agents.sh`
2. **Test system**: Run a small batch extraction
3. **Schedule daily run**: Add to cron for 2 AM daily
4. **Monitor progress**: Check metrics daily
5. **Scale as needed**: Use agents to optimize bottlenecks

**Remember**: 33,333 profiles/day for 30 days = 1,000,000 profiles! 🚀
