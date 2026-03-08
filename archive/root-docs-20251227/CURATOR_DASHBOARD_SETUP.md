# CURATOR DASHBOARD - Your Role

**You curate and configure, agents execute automatically.**

## ✅ **Autonomous System Now Running**

- **Database**: Autonomous agent tables created ✅
- **Agents**: Deployed and scheduled ✅  
- **Sources**: 10 premium auction sites pre-curated ✅
- **Schedule**: Every 4 hours + daily production runs ✅

## 🎯 **Your Curation Role**

### **1. Source Curation** 
**Manage which sites agents target**:

```sql
-- View curated sources
SELECT source_name, source_url, priority, expected_daily_vehicles, is_active 
FROM curated_sources 
ORDER BY priority DESC;

-- Add new premium source
INSERT INTO curated_sources (source_name, source_url, source_type, priority, expected_daily_vehicles, curation_notes)
VALUES ('New Auction House', 'https://example.com', 'auction_house', 8, 15, 'High-value European classics');

-- Adjust priorities
UPDATE curated_sources SET priority = 10 WHERE source_name = 'Mecum Auctions';
UPDATE curated_sources SET is_active = false WHERE source_name = 'Low Priority Site';
```

### **2. Agent Configuration**
**Configure how agents operate**:

```sql
-- View agent status
SELECT agent_name, is_active, last_run_at, success_count, failure_count 
FROM agent_configs;

-- Adjust extraction targets
UPDATE agent_configs 
SET config_json = jsonb_set(config_json, '{target_daily_vehicles}', '50000')
WHERE agent_name = 'premium-auction-extractor';

-- Change schedules
UPDATE agent_configs 
SET schedule_cron = '0 */2 * * *'  -- Every 2 hours instead of 4
WHERE agent_name = 'premium-auction-extractor';
```

### **3. Performance Monitoring**
**Track agent performance**:

```sql
-- Daily performance dashboard
SELECT 
  DATE(started_at) as date,
  agent_name,
  COUNT(*) as executions,
  AVG(vehicles_processed) as avg_vehicles,
  SUM(vehicles_processed) as total_vehicles,
  ROUND(AVG(CASE WHEN success THEN 100 ELSE 0 END), 1) as success_rate
FROM agent_execution_logs 
WHERE started_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(started_at), agent_name
ORDER BY date DESC, total_vehicles DESC;

-- Check if on track for 1M
SELECT 
  SUM(vehicles_processed) as last_24h_vehicles,
  SUM(vehicles_processed) * 30 as projected_monthly,
  CASE WHEN SUM(vehicles_processed) * 30 >= 1000000 THEN 'ON TRACK' ELSE 'BEHIND' END as status
FROM agent_execution_logs 
WHERE started_at >= NOW() - INTERVAL '24 hours';
```

## 🔧 **Curation Commands**

### **Add High-Value Sources**:
```sql
-- Add Hemmings (classic car marketplace)
INSERT INTO curated_sources VALUES (
  gen_random_uuid(),
  'Hemmings Motor News', 
  'https://www.hemmings.com/classifieds/',
  'marketplace',
  8,
  true,
  '{"extraction_type": "firecrawl_schema", "max_listings": 100}',
  false,
  '{}',
  25,
  'Premier classic car classifieds - high-quality listings',
  null,
  NOW(),
  NOW()
);
```

### **Prioritize Premium Sites**:
```sql
-- Boost premium auction houses
UPDATE curated_sources SET 
  priority = 10,
  expected_daily_vehicles = 50
WHERE source_name IN ('Mecum Auctions', 'Barrett-Jackson', 'RM Sotheby''s');
```

### **Configure Agent Behavior**:
```sql
-- More aggressive extraction
UPDATE agent_configs SET config_json = '{
  "target_daily_vehicles": 10000,
  "batch_size": 100,
  "max_concurrent": 5,
  "prioritize_high_priority_sources": true,
  "auto_create_organizations": true,
  "retry_failed_sources": true
}' WHERE agent_name = 'premium-auction-extractor';
```

## 📊 **Curation Dashboard Queries**

### **Source Performance**:
```sql
-- Which sources are producing vehicles?
SELECT 
  cs.source_name,
  cs.priority,
  cs.expected_daily_vehicles,
  COUNT(ael.vehicles_processed) as recent_runs,
  AVG(ael.vehicles_processed) as avg_extraction
FROM curated_sources cs
LEFT JOIN agent_execution_logs ael ON ael.execution_metadata->>'source_url' = cs.source_url
WHERE ael.started_at >= NOW() - INTERVAL '7 days'
GROUP BY cs.source_name, cs.priority, cs.expected_daily_vehicles
ORDER BY avg_extraction DESC NULLS LAST;
```

### **Agent Health**:
```sql
-- Are agents running consistently?
SELECT 
  agent_name,
  last_run_at,
  CASE WHEN last_run_at < NOW() - INTERVAL '6 hours' THEN 'STALE' ELSE 'ACTIVE' END as status,
  success_count,
  failure_count,
  ROUND(success_count::FLOAT / NULLIF(success_count + failure_count, 0) * 100, 1) as success_rate
FROM agent_configs;
```

## 🎯 **Your Curation Workflow**

### **Daily** (5 minutes):
1. **Check performance**: Are agents hitting daily targets?
2. **Review new sources**: Any high-value sites discovered?
3. **Adjust priorities**: Boost successful sources, demote failing ones

### **Weekly** (15 minutes):
1. **Source curation**: Add/remove sources based on performance  
2. **Agent tuning**: Adjust schedules and targets
3. **Quality review**: Check data quality from agents

### **Monthly** (30 minutes):
1. **Strategic curation**: Major source additions/removals
2. **Agent optimization**: Performance tuning
3. **Scale planning**: Adjust for growth

## ✅ **Agents Now Operating Autonomously**

**You set the strategy, agents execute it.**

- ⏰ **Every 4 hours**: Extract from curated premium sources
- 🌅 **Daily at 2 AM**: Full production run targeting 33k vehicles
- 📊 **Hourly**: Health monitoring and auto-repair
- 🔍 **As needed**: Auto-discovery when below targets

**Your job**: Curate sources, set priorities, monitor performance  
**Agent job**: Execute extraction consistently without manual intervention

**The system is now self-operating based on your curation.**
