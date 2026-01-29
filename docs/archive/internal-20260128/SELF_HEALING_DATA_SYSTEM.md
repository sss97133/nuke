## 🔧 Self-Healing Data Quality System

**The system that automates what you used to do manually:**

1. ✅ Detects incomplete data (quality scoring)
2. ✅ Tracks extraction provenance (when, how, by what version)
3. ✅ Auto-backfills when scrapers improve
4. ✅ Shows diffs (what changed)
5. ✅ Flags low-confidence data for review

---

## 🚀 Quick Start

### **1. Apply the Migration**

```bash
cd /Users/skylar/nuke

# Option A: Supabase Dashboard (Recommended)
# Go to SQL Editor → Run: supabase/migrations/20251202_extraction_provenance_system.sql

# Option B: CLI
npx supabase db push
```

### **2. Deploy Edge Functions**

```bash
# Deploy the improved KSL scraper
npx supabase functions deploy scrape-vehicle

# Deploy the backfill processor
npx supabase functions deploy process-backfill-queue
```

### **3. Register the New Scraper Version** (Triggers Auto-Backfill)

```bash
node scripts/deploy-scraper-version.js ksl_scraper v3.2.1 --fields=vin --priority=1
```

**What happens:**
- ✅ Registers new version in `scraper_versions` table
- ✅ **Auto-queues ALL KSL vehicles missing VINs** for backfill
- ✅ Shows count of queued vehicles

###4. Process the Backfill Queue**

```bash
# Manual (one-time)
npx supabase functions invoke process-backfill-queue

# Automatic (cron - every 5 minutes)
# See "Automatic Processing" section below
```

---

## 📖 Use Cases

### **Use Case 1: Single Vehicle Audit**

**Scenario:** You found vehicle `27cbe9de-8dba-4025-a830-af8b37d3069e` is missing VIN

```bash
# See what's missing (dry run)
node scripts/backfill-single-vehicle.js 27cbe9de-8dba-4025-a830-af8b37d3069e --dry-run

# Output shows:
#   ✨ VIN: (none) → "1GCDC14HXFS135837"
#   ✨ Seller: (none) → "lesly"

# Apply the fix
node scripts/backfill-single-vehicle.js 27cbe9de-8dba-4025-a830-af8b37d3069e --auto
```

---

### **Use Case 2: You Fixed a Scraper**

**Scenario:** You added legacy VIN support to KSL scraper

**Old workflow (manual):**
1. Fix scraper ✅
2. Wonder which vehicles need re-scraping ❓
3. Manually check random vehicles 😫
4. Update one-by-one 💀

**New workflow (automated):**
```bash
# 1. Fix scraper
# (edit supabase/functions/scrape-vehicle/index.ts)

# 2. Deploy
npx supabase functions deploy scrape-vehicle

# 3. Register version (AUTO-QUEUES affected vehicles!)
node scripts/deploy-scraper-version.js ksl_scraper v3.2.1 --fields=vin --priority=1

# Output:
# ✅ Version registered
# ✅ Auto-queued 47 vehicles for backfill

# 4. Process queue
npx supabase functions invoke process-backfill-queue

# Output:
# ✅ 47 vehicles processed
# ✅ 41 VINs added
# ✅ 6 already had VINs
```

**Result:** All 47 KSL vehicles missing VINs are now updated. Zero manual work.

---

### **Use Case 3: Find All Low-Quality KSL Vehicles**

```sql
-- Which KSL vehicles are incomplete?
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  v.listing_url,
  q.overall_score,
  q.issues
FROM vehicles v
JOIN vehicle_quality_scores q ON q.vehicle_id = v.id
WHERE v.listing_url LIKE '%cars.ksl.com%'
  AND q.overall_score < 60
ORDER BY q.overall_score ASC
LIMIT 20;
```

**Then backfill them all:**
```sql
-- Queue all low-quality KSL vehicles
INSERT INTO backfill_queue (vehicle_id, reason, priority, source_url, triggered_by)
SELECT 
  v.id,
  'low_quality_score',
  3,
  v.listing_url,
  'manual'
FROM vehicles v
JOIN vehicle_quality_scores q ON q.vehicle_id = v.id
WHERE v.listing_url LIKE '%cars.ksl.com%'
  AND q.overall_score < 60
ON CONFLICT DO NOTHING;

-- Process them
-- npx supabase functions invoke process-backfill-queue
```

---

## 📊 Monitoring

### **Check Queue Status**

```sql
-- Dashboard view
SELECT * FROM backfill_dashboard;

-- Output:
-- status     | reason           | count | avg_quality_score
-- -----------|------------------|-------|------------------
-- pending    | scraper_improved | 47    | 42.3
-- completed  | scraper_improved | 123   | 81.5
-- failed     | low_quality_score| 3     | 38.0
```

### **Check Extraction History for a Vehicle**

```sql
SELECT * FROM get_extraction_history('27cbe9de-8dba-4025-a830-af8b37d3069e');

-- Output shows:
-- field_name | field_value        | extraction_method   | confidence_score | extracted_at
-- -----------|--------------------|---------------------|------------------|-------------
-- vin        | 1GCDC14HXFS135837 | automated_backfill  | 0.90             | 2025-12-02
-- seller_name| lesly              | automated_backfill  | 0.30             | 2025-12-02
```

### **Low-Confidence Data (Needs Review)**

```sql
SELECT * FROM low_confidence_extractions LIMIT 20;

-- Shows all data extracted with confidence < 0.6
-- Example: Single-name sellers, partial data, etc.
```

---

## ⚙️ Automatic Processing (Cron)

### **Option A: Supabase pg_cron**

```sql
-- Run backfill processor every 5 minutes
SELECT cron.schedule(
  'process-backfill-queue',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := 'https://YOUR_PROJECT.supabase.co/functions/v1/process-backfill-queue',
    headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
  );$$
);

-- Check cron jobs
SELECT * FROM cron.job;

-- View cron run history
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

### **Option B: GitHub Actions (Every 10 min)**

`.github/workflows/process-backfill-queue.yml`:
```yaml
name: Process Backfill Queue
on:
  schedule:
    - cron: '*/10 * * * *'  # Every 10 minutes
  workflow_dispatch:  # Manual trigger

jobs:
  process:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: supabase/setup-cli@v1
      - run: |
          npx supabase functions invoke process-backfill-queue \
            --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
```

---

## 🗄️ Database Schema

### **`extraction_metadata`** - Provenance Tracking
Tracks WHEN, HOW, BY WHAT VERSION each field was extracted

| Column | Type | Description |
|--------|------|-------------|
| `vehicle_id` | UUID | Target vehicle |
| `field_name` | TEXT | Field extracted: 'vin', 'mileage', etc. |
| `field_value` | TEXT | Snapshot of value |
| `extraction_method` | TEXT | 'ksl_scraper', 'manual_fix', etc. |
| `scraper_version` | TEXT | 'v3.2.1' |
| `confidence_score` | NUMERIC | 0.0-1.0 (0.3 = uncertain, 0.9 = confident) |
| `extracted_at` | TIMESTAMPTZ | When extracted |

### **`scraper_versions`** - Version Registry
Tracks scraper improvements and triggers backfills

| Column | Type | Description |
|--------|------|-------------|
| `scraper_name` | TEXT | 'ksl_scraper', 'bat_scraper' |
| `version` | TEXT | Semantic version: 'v3.2.1' |
| `fields_affected` | TEXT[] | ['vin', 'mileage'] |
| `backfill_required` | BOOLEAN | If TRUE, auto-queues vehicles |
| `backfill_priority` | INTEGER | 1=critical, 10=low |

### **`backfill_queue`** - Automated Re-Extraction
Vehicles waiting to be re-scraped

| Column | Type | Description |
|--------|------|-------------|
| `vehicle_id` | UUID | Target vehicle |
| `reason` | TEXT | Why: 'scraper_improved', 'low_quality_score' |
| `status` | TEXT | 'pending', 'processing', 'completed', 'failed' |
| `changes_detected` | JSONB | Diff: `{vin: {old: null, new: "ABC123"}}` |
| `fields_updated` | TEXT[] | Which fields changed |

---

## 🎯 The Complete Workflow

```
┌─────────────────────────────────────────────────────┐
│  1. You fix a scraper (add legacy VIN support)     │
└──────────────────┬──────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────┐
│  2. Deploy & register version                       │
│     node scripts/deploy-scraper-version.js          │
└──────────────────┬──────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────┐
│  3. ✨ TRIGGER AUTO-QUEUES affected vehicles       │
│     (finds all KSL vehicles missing VINs)           │
└──────────────────┬──────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────┐
│  4. Backfill processor runs (cron every 5 min)      │
│     - Re-scrapes each vehicle                       │
│     - Compares old vs new data                      │
│     - Shows diff: "vin: (none) → ABC123"            │
│     - Updates vehicle                               │
│     - Logs extraction metadata                      │
│     - Recalculates quality score                    │
└──────────────────┬──────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────┐
│  5. ✅ All affected vehicles updated automatically │
│     Zero manual work after initial fix              │
└─────────────────────────────────────────────────────┘
```

---

## 🔍 Human Audit Layer

**Your role changes from "manual fixer" to "quality reviewer":**

1. **Monitor low-confidence extractions:**
   ```sql
   SELECT * FROM low_confidence_extractions;
   ```

2. **Review failed backfills:**
   ```sql
   SELECT * FROM backfill_queue WHERE status = 'failed';
   ```

3. **Spot-check quality improvements:**
   ```sql
   -- Vehicles improved after backfill
   SELECT v.id, v.year || ' ' || v.make || ' ' || v.model as vehicle,
          q.overall_score
   FROM vehicles v
   JOIN vehicle_quality_scores q ON q.vehicle_id = v.id
   WHERE EXISTS (
     SELECT 1 FROM backfill_queue bq
     WHERE bq.vehicle_id = v.id
     AND bq.status = 'completed'
     AND bq.processed_at > NOW() - INTERVAL '24 hours'
   )
   ORDER BY q.overall_score DESC;
   ```

---

## 🚨 Troubleshooting

### **"No vehicles were queued"**

Check which source the scraper affects:
```sql
SELECT COUNT(*) FROM vehicles WHERE listing_url LIKE '%cars.ksl.com%';
```

If 0, no KSL vehicles exist yet.

### **"Backfill failed"**

```sql
SELECT error_message FROM backfill_queue WHERE status = 'failed';
```

Common issues:
- Source URL 404 (listing removed)
- Scraper timeout
- Network error

### **"Quality score didn't improve"**

Check what changed:
```sql
SELECT changes_detected FROM backfill_queue
WHERE vehicle_id = '27cbe9de-8dba-4025-a830-af8b37d3069e';
```

If `{}`, no new data was found in the source.

---

## 📈 Success Metrics

Track improvement over time:

```sql
-- Average quality score trend
SELECT 
  DATE(updated_at) as date,
  AVG(overall_score) as avg_score,
  COUNT(*) FILTER (WHERE overall_score >= 80) as excellent_count
FROM vehicle_quality_scores
WHERE updated_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(updated_at)
ORDER BY date;
```

---

**🎉 You now have a self-healing data system that automatically fixes what it can, and flags what it can't for human review!**

