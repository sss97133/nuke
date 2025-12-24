# Database Fill Accountability System

## The Goal

**Fill the database with accurate vehicle data at scale:**
- **Target**: Thousands of new profiles every couple hours
- **Minimum**: 2,000 vehicles every 2 hours = 24,000/day
- **Quality**: Accurate, complete data
- **Accountability**: Self-monitoring, self-improving, self-scaling

## The System

### Core Agent: `database-fill-agent`

**Runs every 2 hours automatically. Accountable for:**
1. Filling the database
2. Maintaining data quality
3. Scaling up when below target
4. Fixing issues automatically
5. Reporting on progress

**No manual intervention. Just fills the database.**

---

## How It Works

### Every 2 Hours:

```
1. ASSESS STATE
   ↓ How many vehicles? How many in queue? How many active sources?
   
2. PROCESS QUEUE
   ↓ Process existing import_queue aggressively (fast wins)
   
3. CHECK TARGET
   ↓ Are we on target? (2000+ vehicles this cycle)
   
4. ACTIVATE SOURCES
   ↓ If below target, activate all healthy sources
   
5. DISCOVER NEW
   ↓ If still below target, discover and ingest new sources
   
6. MONITOR QUALITY
   ↓ Check data quality, fix issues automatically
   
7. SCHEDULE NEXT
   ↓ Schedule next cycle in 2 hours
```

### Continuous Monitoring:

- **Vehicle count**: Track total vehicles in database
- **Queue depth**: Monitor import_queue size
- **Source health**: Track which sources are working
- **Data quality**: Monitor accuracy and completeness
- **Processing rate**: Track vehicles/hour

### Self-Scaling:

- **Below target?** → Discover more sources
- **Queue empty?** → Activate more sources
- **Sources failing?** → Fix or replace them
- **Quality low?** → Improve extraction patterns

---

## Accountability Metrics

### Primary Metrics (Tracked Every Cycle)

1. **Vehicles Added** (this cycle)
   - Target: 2000+
   - Actual: [tracked]
   - Gap: [calculated]

2. **Vehicles Queued** (this cycle)
   - Target: Enough to meet next cycle target
   - Actual: [tracked]

3. **Data Quality Score**
   - Target: 0.9+ (90%+ completeness)
   - Actual: [calculated]
   - Issues: [listed]

4. **Source Health**
   - Active sources: [count]
   - Healthy sources: [count]
   - Failing sources: [count]

5. **Processing Rate**
   - Vehicles/hour: [calculated]
   - Queue processing rate: [calculated]

### Secondary Metrics (Tracked Continuously)

- Total vehicles in database
- Pending queue items
- Active scrape sources
- Recent extraction success rate
- Data completeness by field
- Source reliability scores

---

## Self-Improvement Actions

### When Below Target:

1. **Scale Up Processing**
   - Increase batch sizes
   - Run more parallel workers
   - Process queue more aggressively

2. **Activate More Sources**
   - Enable all healthy sources
   - Increase extraction limits
   - Run sources more frequently

3. **Discover New Sources**
   - Auto-discover new marketplaces
   - Auto-discover new auction houses
   - Auto-discover new dealers

4. **Fix Broken Sources**
   - Re-analyze failing sources
   - Update extraction patterns
   - Replace with alternatives

### When Quality Low:

1. **Improve Extraction**
   - Update DOM selectors
   - Enhance AI extraction prompts
   - Add validation rules

2. **Fix Data Issues**
   - Backfill missing fields
   - Correct invalid data
   - Remove duplicates

3. **Enhance Validation**
   - Add stricter validation
   - Improve data cleaning
   - Increase confidence thresholds

---

## Implementation

### Database Tables

```sql
-- Cycle tracking
CREATE TABLE fill_cycles (
  id UUID PRIMARY KEY,
  cycle_id TEXT UNIQUE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  vehicles_added INTEGER,
  vehicles_queued INTEGER,
  sources_active INTEGER,
  sources_discovered INTEGER,
  data_quality_score DECIMAL,
  on_target BOOLEAN,
  next_actions TEXT[],
  errors TEXT[],
  metadata JSONB
);

-- Source health tracking
CREATE TABLE source_health (
  id UUID PRIMARY KEY,
  source_id UUID REFERENCES scrape_sources(id),
  cycle_id TEXT,
  vehicles_extracted INTEGER,
  success_rate DECIMAL,
  error_rate DECIMAL,
  avg_quality_score DECIMAL,
  status TEXT, -- 'healthy', 'degraded', 'failing'
  last_checked TIMESTAMPTZ
);

-- Quality metrics
CREATE TABLE quality_metrics (
  id UUID PRIMARY KEY,
  cycle_id TEXT,
  field_name TEXT,
  completeness DECIMAL,
  accuracy DECIMAL,
  sample_size INTEGER,
  issues TEXT[],
  measured_at TIMESTAMPTZ
);
```

### Cron Schedule

```yaml
# Run every 2 hours
database-fill-agent:
  schedule: "0 */2 * * *"
  function: database-fill-agent
  timeout: 300
```

### Monitoring Dashboard

Track in real-time:
- Current cycle progress
- Vehicles added today
- Queue depth
- Source health
- Data quality
- On/off target status

---

## Success Criteria

### Daily Targets:

- **Minimum**: 24,000 vehicles/day (2000 every 2 hours)
- **Stretch**: 50,000+ vehicles/day
- **Quality**: 90%+ data completeness
- **Uptime**: 95%+ cycle success rate

### Weekly Targets:

- **Total**: 168,000+ vehicles/week
- **New Sources**: 10+ new sources discovered and ingested
- **Quality**: Maintain 90%+ average quality
- **Reliability**: 95%+ source uptime

### Monthly Targets:

- **Total**: 720,000+ vehicles/month
- **Database Growth**: Consistent growth trajectory
- **Quality**: Improving or maintaining 90%+
- **Scale**: System handles growth without degradation

---

## Accountability Report

### Every Cycle (2 hours):

```json
{
  "cycle_id": "uuid",
  "started_at": "2025-12-24T18:00:00Z",
  "completed_at": "2025-12-24T18:15:00Z",
  "vehicles_added": 2150,
  "vehicles_queued": 3500,
  "total_progress": 5650,
  "target": 2000,
  "on_target": true,
  "data_quality": 0.92,
  "sources_active": 15,
  "sources_discovered": 2,
  "next_cycle": "2025-12-24T20:00:00Z"
}
```

### Daily Summary:

```json
{
  "date": "2025-12-24",
  "vehicles_added": 26450,
  "vehicles_queued": 12000,
  "cycles_completed": 12,
  "cycles_on_target": 11,
  "avg_quality": 0.91,
  "sources_active": 15,
  "sources_discovered": 3,
  "status": "ON_TARGET"
}
```

---

## The Promise

**This system is accountable for:**
- ✅ Filling the database continuously
- ✅ Maintaining data quality
- ✅ Scaling up automatically
- ✅ Fixing issues automatically
- ✅ Meeting targets consistently

**You don't need to:**
- ❌ Manually trigger ingestion
- ❌ Monitor sources
- ❌ Fix broken scrapers
- ❌ Discover new sources
- ❌ Check data quality

**Just check the dashboard to see progress.**

---

## Next Steps

1. **Deploy `database-fill-agent`**
2. **Set up cron schedule** (every 2 hours)
3. **Create monitoring dashboard**
4. **Let it run**

The system will:
- Fill the database
- Monitor itself
- Improve itself
- Scale itself
- Report on itself

**Accountable to the goal, not to manual instructions.**

