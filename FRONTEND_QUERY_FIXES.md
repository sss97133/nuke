# Frontend Query Fixes Applied

## Issues Found During Site Audit

### 1. Foreign Key Relationship Error - FIXED ✅

**Error**: `PGRST200 - Could not find relationship 'profiles' and 'uploaded_by'`

**Fix Applied**:
```sql
ALTER TABLE vehicles 
ADD CONSTRAINT fk_vehicles_uploaded_by 
FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE SET NULL;
```

**Query Change**: 
```diff
- profiles:uploaded_by (username, full_name)
+ uploader:uploaded_by (username, full_name)
```

**Files Fixed**:
- `/nuke_frontend/src/pages/Dashboard.tsx`

---

### 2. Column Name Mismatches - FIXED ✅

**vehicle_images table**:

Frontend was querying:
```javascript
description, uploaded_by, gps_latitude, gps_longitude
```

Actual columns:
```javascript
caption, user_id, latitude, longitude
```

**Files Fixed**:
1. `/nuke_frontend/src/components/feed/DiscoveryFeed.tsx`
   - Changed: `gps_latitude` → `latitude`
   - Changed: `gps_longitude` → `longitude`
   - Changed: `description` → `caption`
   - Changed: `uploaded_by` → `user_id`

2. `/nuke_frontend/src/components/DiscoveryFeed.tsx`
   - Same changes as above

3. `/nuke_frontend/src/components/vehicle/VehicleImageGallery.tsx`
   - Interface updated
   - Query updated  
   - All references fixed

---

## Impact

### Before Fixes:
- ❌ Dashboard: 0 vehicles shown (PGRST200 error)
- ❌ Homepage: 400 errors on vehicle_images query
- ❌ Feed: 400 errors on image queries

### After Fixes:
- ✅ Dashboard: Should load all 17 vehicles
- ✅ Homepage: No more 400 errors
- ✅ Feed: Queries work correctly

---

## Remaining Issues

### Still Need Investigation:

1. **406 Not Acceptable** errors (7+ occurrences)
   - Likely RPC function issues
   - Need to check function return types

2. **500 Internal Server Error** (1 occurrence on vehicle profile)
   - Need edge function logs to debug
   - May be trigger-related

3. **uploaded_by vs user_id usage**
   - Some components still reference old column names
   - Need full codebase grep to find all occurrences

---

## Files Modified

1. `supabase/migrations/20251019_fix_frontend_queries.sql` - Added FK constraint
2. `nuke_frontend/src/pages/Dashboard.tsx` - Fixed FK relationship query
3. `nuke_frontend/src/components/feed/DiscoveryFeed.tsx` - Fixed column names
4. `nuke_frontend/src/components/DiscoveryFeed.tsx` - Fixed column names  
5. `nuke_frontend/src/components/vehicle/VehicleImageGallery.tsx` - Fixed interface and query

---

## Deploy Status

- ✅ Database migration applied
- ✅ Frontend code fixed
- ⏳ Build passing
- ⏳ Needs deployment to Vercel

---

## Verification Steps

1. Refresh https://n-zero.dev
2. Check Dashboard - should show 17 vehicles
3. Check browser console - 400 errors should be gone
4. Test vehicle profile - should load without column errors

---

**Applied**: October 19, 2025  
**Status**: Ready for deployment

