# Simple Metrics - Table-Based Completeness

## The Real Metric: How Many Tables Are Filled

You're right - forget complicated dashboards. Just measure: **How many tables have data?**

## Quick Check

```sql
-- Count rows in each table
SELECT 'vehicle_images' as table_name, COUNT(*) as rows FROM vehicle_images
UNION ALL
SELECT 'timeline_events', COUNT(*) FROM timeline_events
UNION ALL
SELECT 'receipts', COUNT(*) FROM receipts
UNION ALL
SELECT 'image_tags', COUNT(*) FROM image_tags
UNION ALL
SELECT 'vehicle_spid_data', COUNT(*) FROM vehicle_spid_data
UNION ALL
SELECT 'image_question_answers', COUNT(*) FROM image_question_answers
ORDER BY rows DESC;
```

## Per-Vehicle Completeness (Simple)

```sql
SELECT 
  year || ' ' || make || ' ' || model as vehicle,
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as images,
  (SELECT COUNT(*) FROM timeline_events WHERE vehicle_id = v.id) as timeline,
  (SELECT COUNT(*) FROM receipts WHERE vehicle_id = v.id) as receipts,
  (SELECT COUNT(*) FROM image_tags WHERE vehicle_id = v.id) as tags,
  CASE WHEN EXISTS(SELECT 1 FROM vehicle_spid_data WHERE vehicle_id = v.id) THEN 1 ELSE 0 END as spid
FROM vehicles v
ORDER BY (images + timeline + receipts + tags + spid) DESC
LIMIT 20;
```

## What Matters

**Good Vehicle Profile:**
- ✅ 10+ images
- ✅ 5+ timeline events  
- ✅ 3+ receipts
- ✅ SPID data
- ✅ 20+ image tags

**Poor Vehicle Profile:**
- 0-5 images
- 0-2 timeline events
- 0 receipts
- No SPID

## Current System Issues

**Processing stopped** because:
1. High failure rate (~85%)
2. Either rate limiting or API key issue
3. Need to debug before continuing

**24 images DID process successfully** - system works, just needs tuning.

## Simplest Way Forward

Skip the complicated tiered system for now. Just:

1. Use the simple Edge Function that works
2. Process images one table at a time
3. Measure: "How many rows added to each table?"

Want me to create a dead-simple processor that just fills tables and shows progress?

