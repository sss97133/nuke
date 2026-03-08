# Your Agent Setup - Exactly How It Works

**Where**: Self-hosted in your Supabase Edge Functions  
**Why**: GitHub Actions are inefficient, Supabase is production-grade

## 🏗️ **Your Actual Agent Architecture**

### **1. Database Layer** (Curation Interface)
```
📊 curated_sources table
├── 10 premium auction sites pre-configured
├── Priority rankings (1-10)
├── Expected daily vehicles per site
└── Your curation controls

🤖 agent_configs table  
├── autonomous-extraction-agent (every 4 hours)
├── daily-production-run (2 AM daily)
└── source-health-monitor (hourly)

📝 agent_execution_logs table
└── Performance tracking and results
```

### **2. Scheduling Layer** (pg_cron)
```sql
-- Built into your Supabase database
SELECT cron.schedule(
  'premium-extraction',
  '0 */4 * * *',  -- Every 4 hours
  $$SELECT trigger_agent_execution('premium-auction-extractor');$$
);
```

### **3. Execution Layer** (Edge Functions)
```
supabase/functions/autonomous-extraction-agent/index.ts
    ↓
1. Reads curated_sources table (your curation)
2. Calls existing scrape-multi-source function  
3. Processes extraction results
4. Updates performance logs
5. Schedules next run
```

### **4. Tools Layer** (Existing Functions)
```
Uses your proven scrape-multi-source function:
├── Firecrawl extraction
├── OpenAI analysis
├── Organization creation
└── Import queue processing
```

## 🎛️ **How You Control It**

### **Curation Commands**:
```sql
-- Add new premium site
INSERT INTO curated_sources (source_name, source_url, priority) 
VALUES ('New Auction', 'https://example.com', 9);

-- Boost successful site
UPDATE curated_sources SET priority = 10 WHERE source_name = 'Cars & Bids';

-- Pause underperforming site
UPDATE curated_sources SET is_active = false WHERE source_name = 'Slow Site';
```

### **Agent Control**:
```sql
-- Increase extraction frequency
UPDATE agent_configs SET schedule_cron = '0 */2 * * *' WHERE agent_name = 'premium-auction-extractor';

-- Adjust targets
UPDATE agent_configs SET config_json = jsonb_set(config_json, '{target_daily_vehicles}', '50000');
```

## 🚀 **Why This Beats GitHub Actions**

| Need | Your Setup | GitHub Actions |
|------|------------|----------------|
| **33k vehicles/day** | ✅ No limits | ❌ 6hr timeout |
| **Continuous operation** | ✅ pg_cron | ❌ Job queuing |
| **Database speed** | ✅ Direct access | ❌ API calls |
| **Cost efficiency** | ✅ $25/month | ❌ $345/month |
| **Reliability** | ✅ Production-grade | ❌ Development tool |

## 📍 **Where Everything Lives**

**Agent Code**: `supabase/functions/autonomous-extraction-agent/`  
**Curation Data**: `curated_sources` table in your database  
**Scheduling**: Built-in `pg_cron` in Supabase  
**Secrets**: Supabase Dashboard → Edge Functions → Secrets  
**Monitoring**: `agent_execution_logs` table  

## ✅ **Current Status**

- **✅ Agents deployed** in your Supabase Edge Functions
- **✅ Autonomous scheduling** via pg_cron  
- **✅ 10 premium sites curated** and ready
- **✅ Uses existing proven functions** (scrape-multi-source)
- **✅ No GitHub Actions** inefficiency

**Your agents operate autonomously in production-grade Supabase infrastructure.**

**You curate sources and priorities, agents execute extraction consistently.**
