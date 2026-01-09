# Platform-Native Tier System Implementation Guide

## Summary

The platform-native tier system extends the existing commercial tier system with 6 analysis layers that reward users for daily documentation, build quality, material provenance, and platform engagement. This enables users to progress from F → A tiers based on platform usage, even without commercial sales activity.

---

## What Was Implemented

### 1. Database Schema Extensions

**Added to `seller_tiers` table:**
- `platform_tier` (F, E, D, C, B, A)
- `platform_score` (0-100 integer)
- `platform_tier_breakdown` (JSONB with per-layer scores)
- `platform_tier_updated_at` (timestamp)
- S-tier eligibility tracking columns (for future)

**Added to `buyer_tiers` table:**
- Same platform tier columns (users can be both sellers and buyers)

**Indexes:**
- Added indexes on `platform_tier` and `platform_score` for efficient queries

### 2. Platform Analysis Layers (6 Functions)

**Layer 1: Daily Documentation Engagement (0-25 points)**
- Function: `calculate_daily_engagement_layer(p_user_id, p_vehicle_id)`
- Measures: Consecutive days with uploads, items per day, temporal decay
- Rewards: Daily uploads for 30+ days = 15 pts, 10+ items/day = 10 pts

**Layer 2: Documentation Quality & Depth (0-20 points)**
- Function: `calculate_doc_quality_layer(p_user_id, p_vehicle_id)`
- Measures: Image count, receipt count, timeline completeness, quality multipliers
- Rewards: 300+ images = 8 pts, 50+ receipts = 6 pts, 150+ events = 6 pts

**Layer 3: Build Recency & Temporal Value (0-15 points)**
- Function: `calculate_temporal_value_layer(p_user_id, p_vehicle_id)`
- Measures: Build recency, real-time vs. retroactive documentation, EXIF date matching
- Rewards: Recent build (2 years) documented daily = 10 pts, real-time docs = 5 pts

**Layer 4: Material Quality & Parts Provenance (0-15 points)**
- Function: `calculate_material_quality_layer(p_vehicle_id)`
- Measures: OEM percentage, parts verification, receipt quality
- Rewards: 80%+ OEM parts = 8 pts, 75+ tagged parts = 4 pts, receipts with part numbers = 3 pts

**Layer 5: Restorer/Builder Verification (0-10 points)**
- Function: `calculate_verification_layer(p_user_id, p_vehicle_id)`
- Measures: Verified organization, builder track record, platform integration
- Rewards: Verified professional = 5 pts, 10+ builds with 80+ quality = 5 pts

**Layer 6: External Integration & Streaming (0-10 points)**
- Function: `calculate_integration_layer(p_user_id, p_vehicle_id)`
- Measures: Instagram integration, auto-sync, streaming sessions, video documentation
- Rewards: Auto-sync Instagram with 30+ posts = 6 pts, multiple streaming sessions = 4 pts

### 3. Main Calculation Function

**`calculate_platform_tier_score(p_user_id, p_vehicle_id)`**
- Aggregates all 6 layers
- Returns JSONB with tier, score, and breakdown
- Assigns tier: F (0-19), E (20-34), D (35-49), C (50-64), B (65-79), A (80-100)

### 4. Refresh Functions

**`refresh_platform_tier(p_user_id)`**
- Calculates and updates platform tier for a user
- Updates both `seller_tiers` and `buyer_tiers` tables
- Stores breakdown JSONB for transparency

**`refresh_all_platform_tiers()`**
- Bulk refresh for all users (use sparingly)
- Returns count of refreshed users and errors

### 5. Automatic Triggers

**Trigger Functions:**
- `trigger_refresh_platform_tier()` - Fires on platform activity
- **Debouncing:** Max once per 5 minutes per user (prevents excessive calculations)

**Triggers:**
- `refresh_tier_on_image_upload` - On `vehicle_images` INSERT
- `refresh_tier_on_timeline_event` - On `vehicle_timeline_events` INSERT
- `refresh_tier_on_receipt_upload` - On `vehicle_receipts` INSERT

---

## How to Use

### 1. Apply Migration

```bash
# Apply the migration
supabase db push

# Or manually apply
psql $DATABASE_URL -f supabase/migrations/20251229000000_platform_native_tier_system.sql
```

### 2. Initial Population

After applying the migration, populate platform tiers for existing users:

```sql
-- Refresh all platform tiers (this can take a while for many users)
SELECT refresh_all_platform_tiers();
```

### 3. Manual Refresh (Single User)

```sql
-- Refresh platform tier for a specific user
SELECT refresh_platform_tier('user-id-here');

-- Check result
SELECT 
  seller_id,
  platform_tier,
  platform_score,
  platform_tier_breakdown
FROM seller_tiers
WHERE seller_id = 'user-id-here';
```

### 4. Check Tier Breakdown

```sql
-- See detailed breakdown for a user
SELECT 
  seller_id,
  platform_tier,
  platform_score,
  jsonb_pretty(platform_tier_breakdown) as breakdown
FROM seller_tiers
WHERE seller_id = 'user-id-here';
```

### 5. Diagnostic Queries

Use the diagnostic queries file to understand tier distribution and issues:

```sql
-- Run diagnostics
\i supabase/sql/helpers/diagnose_tier_system.sql
```

---

## Tier Assignment Logic

### Current Tiers (F → A)

```
F Tier: 0-19 points   (Entry - Minimal engagement)
E Tier: 20-34 points  (Beginner - Basic usage)
D Tier: 35-49 points  (Developing - Regular usage)
C Tier: 50-64 points  (Established - Active usage)
B Tier: 65-79 points  (Advanced - Deep engagement)
A Tier: 80-100 points (Expert - Platform-native excellence)
```

### Example Scoring

**High-Performing User (A Tier):**
- Daily uploads for 90 days: 25 pts
- 250 images, 45 receipts, 110 events: 18 pts
- Recent build, real-time docs: 10 pts
- 85% OEM parts, tagged: 12 pts
- Verified professional builder: 7 pts
- Instagram auto-sync, streaming: 8 pts
- **Total: 80 pts → A Tier**

**Low-Activity User (F Tier):**
- No daily usage: 0 pts
- 50 images only: 3 pts
- Old build, retroactive docs: 1 pt
- Visual-only assessment: 2 pts
- Unknown builder: 0 pts
- No integration: 0 pts
- **Total: 6 pts → F Tier**

---

## Performance Considerations

### Optimization Features

1. **Debounced Triggers:** Max once per 5 minutes per user
2. **Indexed Columns:** Fast queries on `platform_tier` and `platform_score`
3. **Incremental Calculation:** Functions support per-vehicle or per-user calculation

### Bulk Refresh Strategy

**When to run:**
- After initial migration (one-time)
- After major data imports
- After fixing data quality issues

**How to run safely:**
```sql
-- Run during low-traffic period
-- Monitor with:
SELECT COUNT(*) FROM seller_tiers WHERE platform_tier_updated_at IS NULL;

-- Run in batches if needed:
DO $$
DECLARE
  v_user RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_user IN 
    SELECT DISTINCT user_id FROM vehicles WHERE user_id IS NOT NULL LIMIT 100
  LOOP
    PERFORM refresh_platform_tier(v_user.user_id);
    v_count := v_count + 1;
    IF v_count % 10 = 0 THEN
      RAISE NOTICE 'Refreshed % users', v_count;
    END IF;
  END LOOP;
END $$;
```

---

## Testing

### Unit Tests

The existing test suite (`supabase/sql/helpers/test_tier_system.sql`) can be extended to test platform tiers:

```sql
-- Test platform tier calculation
SELECT calculate_platform_tier_score('test-user-id');

-- Test individual layers
SELECT calculate_daily_engagement_layer('test-user-id');
SELECT calculate_doc_quality_layer('test-user-id');
-- etc.
```

### Integration Tests

1. **Create test user with vehicles**
2. **Upload images/timeline events**
3. **Verify trigger fires and tier updates**
4. **Check tier breakdown matches expectations**

---

## Troubleshooting

### Common Issues

**1. Most users at F tier after migration**
- **Cause:** No platform activity data yet
- **Solution:** Normal - tiers will update as users engage

**2. Triggers not firing**
- **Check:** `SELECT * FROM information_schema.triggers WHERE trigger_name LIKE '%tier%';`
- **Fix:** Re-apply migration or manually create triggers

**3. Performance issues during bulk refresh**
- **Cause:** Too many users, complex calculations
- **Solution:** Run in batches, during off-peak hours

**4. Tier breakdown shows NULL or zeros**
- **Cause:** No data in one or more layers
- **Solution:** Normal for new users - will populate as they engage

### Diagnostic Queries

```sql
-- Check tier distribution
SELECT platform_tier, COUNT(*) 
FROM seller_tiers 
GROUP BY platform_tier;

-- Check users with high activity but low tier
SELECT 
  st.seller_id,
  st.platform_tier,
  st.platform_score,
  COUNT(DISTINCT vi.id) as images
FROM seller_tiers st
LEFT JOIN vehicles v ON st.seller_id = v.user_id
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
WHERE st.platform_tier IN ('F', 'E')
GROUP BY st.seller_id, st.platform_tier, st.platform_score
HAVING COUNT(DISTINCT vi.id) > 50
LIMIT 20;
```

---

## Next Steps

### Future Enhancements

1. **S-Tier Eligibility System:**
   - Track eligibility across specialization tracks
   - Invitation system when S-tier unlocks

2. **Specialization Tracks:**
   - Racing achievements track
   - Build quality track
   - Provenance track
   - Community contribution track

3. **Tier Benefits:**
   - Unlock features based on tier
   - Priority support
   - Early access to features

4. **Analytics Dashboard:**
   - Show tier distribution
   - Track tier progression over time
   - Identify top performers

5. **Historical Value Adjustment:**
   - Bonus for preserved original documentation
   - Penalty for retroactive-only documentation
   - Value restoration vs. modification

---

## Related Files

- **Migration:** `supabase/migrations/20251229000000_platform_native_tier_system.sql`
- **Architecture Docs:** `docs/systems/TIER_SYSTEM_ARCHITECTURE.md`
- **Diagnostics:** `supabase/sql/helpers/diagnose_tier_system.sql`
- **Tests:** `supabase/sql/helpers/test_tier_system.sql`
- **Original Framework:** `docs/TIERED_AUCTION_SYSTEM_FRAMEWORK.txt`

---

## Questions?

Check the architecture documentation or run diagnostic queries to understand tier calculations for specific users.

