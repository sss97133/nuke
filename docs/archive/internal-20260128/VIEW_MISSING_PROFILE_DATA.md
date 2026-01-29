# How to View Missing Profile Data

## Option 1: SQL Queries (Recommended - Most Detailed)

Run this in **Supabase Dashboard → SQL Editor**:

```sql
-- Paste contents of: scripts/check-missing-profile-data.sql
```

**Or run these quick queries:**

### Quick Overview - What's Missing:
```sql
-- Missing Data Summary
SELECT 
  'Missing VIN' as missing_field,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM vehicles v INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id WHERE q.status = 'complete'), 0), 1) as percentage
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND (v.vin IS NULL OR v.vin = '')
UNION ALL
SELECT 
  'Missing Mileage',
  COUNT(*),
  ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM vehicles v INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id WHERE q.status = 'complete'), 0), 1)
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND v.mileage IS NULL
UNION ALL
SELECT 
  'No Images',
  COUNT(DISTINCT v.id),
  ROUND(COUNT(DISTINCT v.id) * 100.0 / NULLIF((SELECT COUNT(*) FROM vehicles v INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id WHERE q.status = 'complete'), 0), 1)
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND NOT EXISTS (SELECT 1 FROM vehicle_images WHERE vehicle_id = v.id)
UNION ALL
SELECT 
  'No Comments',
  COUNT(DISTINCT v.id),
  ROUND(COUNT(DISTINCT v.id) * 100.0 / NULLIF((SELECT COUNT(*) FROM vehicles v INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id WHERE q.status = 'complete'), 0), 1)
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND NOT EXISTS (SELECT 1 FROM auction_comments WHERE vehicle_id = v.id)
ORDER BY count DESC;
```

### Detailed - Profiles Missing Data:
```sql
-- Show profiles with what's missing
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  q.bat_url,
  CASE WHEN v.vin IS NULL OR v.vin = '' THEN '❌' ELSE '✅' END as has_vin,
  CASE WHEN v.mileage IS NULL THEN '❌' ELSE '✅' END as has_mileage,
  CASE WHEN v.color IS NULL OR v.color = '' THEN '❌' ELSE '✅' END as has_color,
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
  (SELECT COUNT(*) FROM auction_comments WHERE vehicle_id = v.id) as comment_count
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
ORDER BY 
  CASE WHEN v.vin IS NULL OR v.vin = '' THEN 1 ELSE 2 END,
  CASE WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) = 0 THEN 1 ELSE 2 END
LIMIT 50;
```

### Worst Profiles (Most Missing):
```sql
-- Profiles with most missing data
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  q.bat_url,
  (
    CASE WHEN v.vin IS NULL OR v.vin = '' THEN 1 ELSE 0 END +
    CASE WHEN v.mileage IS NULL THEN 1 ELSE 0 END +
    CASE WHEN v.color IS NULL OR v.color = '' THEN 1 ELSE 0 END +
    CASE WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) = 0 THEN 3 ELSE 0 END +
    CASE WHEN NOT EXISTS (SELECT 1 FROM auction_comments WHERE vehicle_id = v.id) THEN 1 ELSE 0 END
  ) as missing_fields_count
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
ORDER BY missing_fields_count DESC
LIMIT 30;
```

---

## Option 2: UI View (Visual - See in Browser)

### View Individual Profiles:

1. **Get Vehicle IDs from SQL:**
   ```sql
   -- Get vehicle IDs from complete profiles
   SELECT v.id, v.year, v.make, v.model, q.bat_url
   FROM vehicles v
   INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
   WHERE q.status = 'complete'
   ORDER BY v.created_at DESC
   LIMIT 20;
   ```

2. **View in Browser:**
   ```
   Navigate to: /vehicle/{vehicle_id}
   
   Example: http://localhost:3000/vehicle/e41d1883-e1c5-4418-a094-42cf31c31472
   ```

3. **What to Check in UI:**
   - ✅ **Basic Info Section** - Shows VIN, mileage, color, transmission, engine
   - ✅ **Image Gallery** - Shows all vehicle images (count at top)
   - ✅ **Comments & Bids Section** - Shows auction comments
   - ✅ **Timeline Section** - Shows auction events
   - ✅ **Structured Data Card** - Shows auction metadata

### Find Profiles Missing Specific Data:

**Missing VIN:**
```sql
SELECT v.id, v.year, v.make, v.model, q.bat_url
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND (v.vin IS NULL OR v.vin = '')
LIMIT 10;
```

**No Images:**
```sql
SELECT v.id, v.year, v.make, v.model, q.bat_url
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND NOT EXISTS (SELECT 1 FROM vehicle_images WHERE vehicle_id = v.id)
LIMIT 10;
```

**No Comments:**
```sql
SELECT v.id, v.year, v.make, v.model, q.bat_url
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND NOT EXISTS (SELECT 1 FROM auction_comments WHERE vehicle_id = v.id)
LIMIT 10;
```

---

## Quick Command to Check One Profile:

```bash
# Get a vehicle ID from complete profiles
curl -s -X GET "https://qkgaybvrernstplzjaam.supabase.co/rest/v1/rpc/get_complete_profile_sample" \
  -H "Authorization: Bearer YOUR_KEY" | jq '.[0].id'

# Then visit: /vehicle/{that_id}
```

---

## What Each Field Means:

- **VIN** - Vehicle Identification Number (critical for identification)
- **Mileage** - Odometer reading
- **Color** - Vehicle color
- **Transmission** - Transmission type
- **Engine** - Engine description
- **Images** - Vehicle photos (should have 50-100+ for BaT listings)
- **Comments** - Auction comments from bidders
- **Bids** - Bid history from auction

---

## Best Practice:

1. **Run SQL first** - Get overview of what's missing across all profiles
2. **Check worst profiles** - Identify which ones need attention
3. **View in UI** - Open specific profiles to see what's missing visually
4. **Re-extract if needed** - If profiles are missing critical data, re-run extraction

---

## Files:

- **SQL Queries:** `scripts/check-missing-profile-data.sql`
- **UI Route:** `/vehicle/:vehicleId`
- **Vehicle Profile Component:** `nuke_frontend/src/pages/VehicleProfile.tsx`

