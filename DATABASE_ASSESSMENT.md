# Database Assessment Report

## Overview

This assessment reviews the database structure, migrations, and key tables for the Nuke platform.

## Key Tables

### Core Vehicle Tables
1. **vehicles** - Main vehicle profiles
   - Primary key: `id` (UUID)
   - Key fields: `year`, `make`, `model`, `vin`, `discovery_url`, `profile_origin`
   - Relationships: `uploaded_by`, `user_id`

2. **vehicle_images** - Vehicle photos and documentation
   - Primary key: `id` (UUID)
   - Foreign key: `vehicle_id` → vehicles
   - Key fields: `image_url`, `angle`, `category`, `ai_scan_metadata`, `ai_last_scanned`
   - Indexes: vehicle_id, angle, category

3. **vehicle_valuations** - AI-generated valuations
   - Primary key: `id` (UUID)
   - Foreign key: `vehicle_id` → vehicles
   - Key fields: `estimated_value`, `confidence_score`, `components`, `environmental_context`

### Analysis & Queue Tables
4. **analysis_queue** - Analysis request queue (NEW)
   - Primary key: `id` (UUID)
   - Foreign key: `vehicle_id` → vehicles
   - Key fields: `status`, `priority`, `llm_provider`, `llm_model`, `analysis_tier`
   - Statuses: pending, processing, completed, failed, retrying

5. **timeline_events** - Vehicle history timeline
   - Primary key: `id` (UUID)
   - Foreign key: `vehicle_id` → vehicles
   - Key fields: `event_type`, `event_date`, `title`, `description`, `source`

### Supporting Tables
6. **profiles** - User profiles
7. **ghost_users** - Anonymous photographers
8. **market_data** - Market pricing data
9. **receipts** - Build receipts
10. **build_line_items** - Parts inventory

## Recent Migrations

### 2025-01-30: Analysis Queue System
- `20250130_create_analysis_queue.sql` - Creates analysis_queue table
- `20250130_auto_queue_analysis_triggers.sql` - Auto-queue triggers
- `20250130_setup_analysis_queue_cron.sql` - Cron job setup

### Key Features Added
- LLM provider/model selection support
- Analysis tier tracking
- Retry logic with exponential backoff
- Priority system (1-10)
- Full error logging

## Database Health Checks Needed

### 1. Indexes
- Verify indexes exist on:
  - `vehicles.discovery_url` (for duplicate detection)
  - `vehicle_images.vehicle_id` (for queries)
  - `analysis_queue.status, priority, next_retry_at` (for queue processing)
  - `vehicle_valuations.vehicle_id, valuation_date` (for latest valuation)

### 2. Foreign Keys
- Verify all foreign keys are properly set up
- Check CASCADE rules for deletions

### 3. RLS Policies
- Verify Row-Level Security is enabled
- Check policies for:
  - `vehicles` (users can see their vehicles)
  - `vehicle_images` (users can see images for their vehicles)
  - `analysis_queue` (users can see their analyses)
  - `vehicle_valuations` (users can see valuations for their vehicles)

### 4. Data Integrity
- Check for orphaned records:
  - `vehicle_images` without valid `vehicle_id`
  - `timeline_events` without valid `vehicle_id`
  - `vehicle_valuations` without valid `vehicle_id`
- Check for missing required fields:
  - `vehicles` without `year`, `make`, `model`
  - `timeline_events` without `title` or `source`

### 5. Performance
- Check table sizes
- Identify large tables that may need partitioning
- Review slow queries
- Check for missing indexes on frequently queried columns

## Recommended Queries to Run

```sql
-- 1. Table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- 2. Vehicle statistics
SELECT 
  COUNT(*) as total_vehicles,
  COUNT(DISTINCT uploaded_by) as unique_uploaders,
  COUNT(*) FILTER (WHERE profile_origin = 'craigslist_scrape') as craigslist_vehicles
FROM vehicles;

-- 3. Image analysis status
SELECT 
  COUNT(*) as total_images,
  COUNT(*) FILTER (WHERE ai_scan_metadata IS NOT NULL) as analyzed,
  COUNT(*) FILTER (WHERE angle IS NOT NULL) as angle_classified
FROM vehicle_images
WHERE is_document IS NULL OR is_document = false;

-- 4. Analysis queue status
SELECT 
  status,
  COUNT(*) as count,
  AVG(retry_count) as avg_retries
FROM analysis_queue
GROUP BY status;

-- 5. Missing indexes check
SELECT
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation
FROM pg_stats
WHERE schemaname = 'public'
  AND tablename IN ('vehicles', 'vehicle_images', 'analysis_queue')
  AND n_distinct > 100
ORDER BY n_distinct DESC;

-- 6. Orphaned records
SELECT 'vehicle_images' as table_name, COUNT(*) as orphaned
FROM vehicle_images vi
LEFT JOIN vehicles v ON vi.vehicle_id = v.id
WHERE v.id IS NULL
UNION ALL
SELECT 'timeline_events', COUNT(*)
FROM timeline_events te
LEFT JOIN vehicles v ON te.vehicle_id = v.id
WHERE v.id IS NULL
UNION ALL
SELECT 'vehicle_valuations', COUNT(*)
FROM vehicle_valuations vv
LEFT JOIN vehicles v ON vv.vehicle_id = v.id
WHERE v.id IS NULL;

-- 7. Missing required fields
SELECT 'vehicles' as table_name, COUNT(*) as missing_data
FROM vehicles
WHERE year IS NULL OR make IS NULL OR model IS NULL
UNION ALL
SELECT 'timeline_events', COUNT(*)
FROM timeline_events
WHERE title IS NULL OR source IS NULL;
```

## Action Items

1. ✅ **Analysis Queue Table** - Created and ready
2. ⏳ **Run Health Checks** - Execute recommended queries
3. ⏳ **Verify Indexes** - Ensure all critical indexes exist
4. ⏳ **Check RLS Policies** - Verify security policies
5. ⏳ **Data Integrity** - Fix any orphaned records
6. ⏳ **Performance Tuning** - Optimize slow queries

## Migration Status

**Total Migrations**: 294 SQL files

### Recent Critical Migrations (2025-01-30)
- ✅ `20250130_create_analysis_queue.sql` - Analysis queue system
- ✅ `20250130_auto_queue_analysis_triggers.sql` - Auto-queue triggers
- ✅ `20250130_setup_analysis_queue_cron.sql` - Cron setup

### Key System Migrations
- ✅ `20250129_create_cl_listing_queue.sql` - Craigslist scraping queue
- ✅ `20250129_create_get_image_scan_stats.sql` - Image analysis stats
- ✅ `20250118_timeline_events_schema.sql` - Timeline system
- ✅ `20250117_vehicle_images_table.sql` - Image storage

## Potential Issues to Check

### 1. Duplicate Table Definitions
- Multiple migrations may define the same tables
- Check for conflicts in: `vehicles`, `vehicle_images`, `timeline_events`

### 2. Missing Foreign Keys
- Verify all `vehicle_id` references have proper CASCADE rules
- Check for orphaned records

### 3. Index Coverage
- Ensure indexes exist on frequently queried columns:
  - `vehicles.discovery_url`
  - `vehicle_images.vehicle_id, angle, category`
  - `analysis_queue.status, priority, next_retry_at`
  - `vehicle_valuations.vehicle_id, valuation_date`

### 4. RLS Policy Coverage
- All tables should have RLS enabled
- Policies should allow:
  - Users to see their own data
  - Service role to manage system data
  - Public read access where appropriate

## Next Steps

1. **Connect to Supabase** with proper credentials
2. **Run health check queries** (see above)
3. **Review migration order** - ensure no conflicts
4. **Check for orphaned records** - fix data integrity
5. **Verify indexes** - add missing ones
6. **Test RLS policies** - ensure proper access control
7. **Document findings** in this report

