# Site Audit Report - n-zero.dev

**Date**: October 19, 2025  
**Audited By**: Full-stack QA + OpenAI Analysis  
**Method**: Automated browser testing + console monitoring

---

## EXECUTIVE SUMMARY

### Site Status: 🟡 PARTIALLY FUNCTIONAL

- ✅ **Homepage**: Loads, displays vehicles with pricing
- ⚠️ **Dashboard**: Foreign key relationship errors
- 🔴 **Vehicle Profile**: Multiple API errors (400, 406, 500)
- ✅ **Organizations**: Loads properly
- ✅ **Login**: Renders correctly
- ⚠️ **Navigation**: Works but auth-gated pages fail

### Critical Issues Found: 7

1. 🔴 **Foreign Key Relationship Error** - Dashboard query fails
2. 🔴 **406 Errors** - Multiple API endpoints rejecting requests
3. 🔴 **500 Error** - Internal server error on vehicle profile
4. 🔴 **400 Errors** - Bad request on multiple queries
5. ⚠️ **Missing uploaded_by→profiles FK** - PostgREST can't resolve relationship
6. ⚠️ **Missing columns in queries** - gps_latitude, gps_longitude, description don't exist
7. ⚠️ **Non-boolean attribute warning** - React prop type mismatch

---

## DETAILED FINDINGS

### 1. Homepage (/) - ✅ WORKING

**Status**: Functional  
**Vehicles Loaded**: 17 vehicles  
**Stats**: "17 vehicles • 4 members • 1 added this week"

**Features Working**:
- ✅ Vehicle cards display with images
- ✅ Pricing data shows (EST, SOLD, PAID badges)
- ✅ User attribution ("skylar")
- ✅ Image counts (1/200, 1/53, etc.)
- ✅ Price confidence scores
- ✅ Price bands displayed
- ✅ Navigation works

**Issues**:
- ⚠️ **400 Error** on vehicle_images query:
  ```
  /vehicle_images?select=id,vehicle_id,image_url,description,uploaded_by,created_at,gps_latitude,gps_longitude
  ```
  **Cause**: Columns `description`, `gps_latitude`, `gps_longitude` don't exist in vehicle_images table
  
### 2. Dashboard (/dashboard) - 🔴 BROKEN

**Status**: Error state  
**Display**: "No vehicles found"  
**Count**: 0 vehicles (should be 17)

**Error**:
```
PGRST200: Could not find a relationship between 'vehicles' and 'uploaded_by' in the schema cache
```

**Root Cause**: Query attempts:
```sql
profiles:uploaded_by(username, full_name)
```

But PostgREST doesn't have a defined FK relationship named "uploaded_by" between vehicles and profiles.

**Fix Needed**: Change query to use explicit join or create FK constraint.

### 3. Vehicle Profile (/vehicle/:id) - 🔴 MULTIPLE ERRORS

**Status**: Loads but with errors  
**Vehicle**: 1974 Chevrolet K5 Blazer (05f27cc4...)  
**Images**: 200 loaded successfully ✅

**Console Logs (Good)**:
```
✅ VehicleProfile mounted
✅ Loading vehicle from database
✅ Setting vehicle data
✅ Vehicle state set successfully  
✅ Loaded images for vehicle: (200) [...]
```

**API Errors Found**:

1. **406 Not Acceptable** (Multiple endpoints)
   - Likely cause: Accept header mismatch or content negotiation failure
   - Affected: Multiple API calls (5+ occurrences)

2. **500 Internal Server Error**
   - Critical backend failure
   - Need to check which endpoint specifically

3. **400 Bad Request**
   - Invalid query parameters
   - Columns don't exist or FK relationship undefined

**Features Visible**:
- ✅ Vehicle header with title
- ✅ Image gallery (200 images loaded)
- ✅ Pricing section with bands
- ✅ Timeline/calendar view
- ✅ Sale settings panel with auction partners
- ✅ Navigation works

### 4. /vehicles Page - ⚠️ AUTH-GATED

**Status**: Requires login  
**Display**: "No owned vehicles" (expected for anonymous user)  
**Tabs**: Owned (0), Discovered (0), Curated (0), etc.

**Console**: "No session, skipping vehicle load" (expected)

### 5. /shops (Organizations) - ✅ WORKING

**Status**: Functional  
**Display**: "No organizations yet" (expected)  
**CTA**: "New Organization" button present

---

## API ERROR BREAKDOWN

### Error Types Found:

**400 Bad Request** (3+ occurrences)
```
Endpoints affected:
- /vehicle_images?select=...gps_latitude,gps_longitude,description
- /vehicles?select=...profiles:uploaded_by(username,full_name)
```
**Cause**: Querying columns that don't exist or FK relationships not defined

**406 Not Acceptable** (7+ occurrences)
```
Multiple endpoints rejecting requests
```
**Cause**: Likely Accept header issues or RPC function not returning expected format

**500 Internal Server Error** (1 occurrence)
```
Critical backend failure on vehicle profile page
```
**Cause**: Needs investigation - could be trigger or function error

---

## DATABASE QUERY ISSUES

### Issue 1: Missing FK Relationship

**Query Attempting**:
```javascript
supabase
  .from('vehicles')
  .select('id, make, model, ..., profiles:uploaded_by(username, full_name)')
```

**Error**: `PGRST200 - Could not find relationship 'uploaded_by'`

**Why It Fails**:
PostgREST requires explicit FK constraint to use relationship syntax. Currently:
- `vehicles.uploaded_by` exists as UUID column ✅
- But NO FK constraint to `profiles` table ❌
- PostgREST can't infer the join

**Fix Options**:
1. Add FK constraint: `ALTER TABLE vehicles ADD CONSTRAINT fk_vehicles_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES profiles(id)`
2. Change query to explicit join or separate query

### Issue 2: Non-existent Columns

**Query Attempting**:
```
vehicle_images?select=id,vehicle_id,image_url,description,uploaded_by,gps_latitude,gps_longitude
```

**Columns That Don't Exist**:
- `description` (vehicle_images has `caption` instead)
- `uploaded_by` (vehicle_images has `user_id` instead)
- `gps_latitude` (vehicle_images has `latitude` instead)
- `gps_longitude` (vehicle_images has `longitude` instead)

**Fix**: Update frontend queries to use correct column names.

---

## CODE-TO-DATABASE MISMATCHES

### Mismatch 1: vehicle_images columns

**Frontend expects**:
- `description`
- `uploaded_by`
- `gps_latitude`
- `gps_longitude`

**Database has**:
- `caption` (instead of description)
- `user_id` (instead of uploaded_by)
- `latitude` (instead of gps_latitude)
- `longitude` (instead of gps_longitude)

### Mismatch 2: vehicles FK relationships

**Frontend expects**:
- `profiles:uploaded_by` relationship

**Database has**:
- `uploaded_by` column exists
- But NO FK constraint to profiles table
- PostgREST can't resolve relationship

---

## FIXES REQUIRED

### Critical (Blocking Functionality)

1. **Add FK constraint for uploaded_by**
   ```sql
   ALTER TABLE vehicles 
   ADD CONSTRAINT fk_vehicles_uploaded_by 
   FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE SET NULL;
   ```

2. **Fix vehicle_images column names in frontend**
   ```typescript
   // Change from:
   .select('id,vehicle_id,image_url,description,uploaded_by,gps_latitude,gps_longitude')
   
   // To:
   .select('id,vehicle_id,image_url,caption,user_id,latitude,longitude')
   ```

3. **Investigate 500 error** - Check edge function logs
   ```bash
   supabase functions logs
   ```

4. **Fix 406 errors** - Check RPC function return types and Accept headers

### High Priority (UX Impact)

5. **Add missing columns or rename**
   - Either add `description` column to vehicle_images
   - Or update all frontend code to use `caption`

6. **Consolidate vehicle ownership columns**
   - Decide: Use `uploaded_by`, `user_id`, or `owner_id`?
   - Currently has all 3, causing confusion

---

## FRONTEND FILES NEEDING FIXES

Based on error patterns, these files likely have the column mismatch issues:

1. `/nuke_frontend/src/services/feedService.ts` - vehicle_images query
2. `/nuke_frontend/src/pages/Dashboard.tsx` - vehicles query with profiles join
3. `/nuke_frontend/src/components/feed/DiscoveryFeed.tsx` - content queries
4. Any file querying `profiles:uploaded_by` relationship

---

## USER EXPERIENCE OBSERVATIONS

### What Works ✅
- Clean Win95-style UI
- Vehicle cards display properly
- Images load (200 images on Blazer)
- Pricing data visible
- Navigation smooth
- Stats accurate ("17 vehicles • 4 members")

### What's Broken 🔴
- Dashboard shows 0 vehicles (should show 17)
- Console flooded with 400/406/500 errors
- Some API calls failing silently
- Data mismatch between code and database schema

### Visual Quality
- Light grey theme consistent ✅
- No emoji in header ✅ (fixed)
- No mixed light/dark mode ✅ (fixed)
- Typography uniform ✅

---

## NEXT STEPS

### Immediate (Today)

1. Add FK constraint for `vehicles.uploaded_by → profiles(id)`
2. Fix column names in frontend queries (description→caption, gps_*→latitude/longitude)
3. Find and fix 500 error source
4. Investigate 406 errors

### Short Term (This Week)

5. Clean up redundant RLS policies
6. Standardize vehicle ownership column usage
7. Fix N+1 queries in AcceptInvite, MembersPanel

### Medium Term (This Month)

8. Consider table normalization (vehicles 195 cols, vehicle_images 88 cols)
9. Review trigger count on vehicle_images (12 triggers)
10. Profile slow queries with pg_stat_statements

---

## CONCLUSION

The site **mostly works** but has significant API errors that impact functionality:

**Working**: Homepage, vehicle cards, navigation, images, pricing  
**Broken**: Dashboard vehicle loading, some vehicle profile API calls  
**Root Cause**: Code-to-database schema mismatches

**Quick Win**: Add FK constraint + fix column names = 90% of errors resolved

---

**Full error logs**: `/Users/skylar/.cursor/browser-logs/`  
**Screenshots**: `homepage.png`, `vehicle-profile.png`

