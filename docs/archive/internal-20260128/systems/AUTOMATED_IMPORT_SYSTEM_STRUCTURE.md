# Automated Import System Structure & Access Model

## Current State: Where Vehicles Exist

### Vehicle Lifecycle for Automated Imports

1. **Creation** (via `scrape-all-craigslist-squarebodies`)
   - `uploaded_by`: System user ID (e.g., `system@n-zero.dev` or admin user)
   - `user_id`: Generated column (auto-set from `uploaded_by` or NULL)
   - `is_public`: `true` ✅
   - `status`: `'active'` ✅ (fixed)
   - `discovery_source`: `'craigslist_scrape'`
   - `profile_origin`: `'craigslist_scrape'`
   - `origin_metadata`: Contains listing URL, import timestamp

2. **Current Location**: Vehicles exist in the `vehicles` table with:
   - ✅ Public visibility (`is_public = true`)
   - ✅ Active status (`status = 'active'`)
   - ⚠️ **Limbo state**: No clear ownership/organization attribution
   - ⚠️ **System user attribution**: `uploaded_by` points to system/admin user

## Who Can Access Them

### Public Access (Anonymous Users)
- ✅ **Can VIEW**: All vehicles with `is_public = true` (via RLS policy)
- ❌ **Cannot EDIT**: Must be authenticated
- ❌ **Cannot DELETE**: Must be owner/creator/admin

### Authenticated Users
- ✅ **Can VIEW**: All public vehicles + their own private vehicles
- ✅ **Can EDIT**: Any vehicle (Wikipedia model - per `20251024_simple_vehicle_rls.sql`)
- ❌ **Cannot DELETE**: Only creator (`uploaded_by`) or admin can delete

### System/Admin Users
- ✅ **Full access**: Service role bypasses all RLS policies
- ✅ **Can create/update/delete**: Via edge functions

## System Structure

### RLS Policies (Row Level Security)

**Current Active Policy** (from `20251024_simple_vehicle_rls.sql`):
```sql
-- 1. Anyone can view any vehicle (public read)
CREATE POLICY "Anyone can view vehicles" ON vehicles FOR SELECT USING (true);

-- 2. Authenticated users can create vehicles
CREATE POLICY "Authenticated users can create vehicles" 
  ON vehicles FOR INSERT TO authenticated 
  WITH CHECK (auth.uid() IS NOT NULL);

-- 3. ANY authenticated user can edit ANY vehicle (Wikipedia model)
CREATE POLICY "Any authenticated user can edit vehicles" 
  ON vehicles FOR UPDATE TO authenticated 
  USING (auth.uid() IS NOT NULL);

-- 4. Only creator or admins can delete
CREATE POLICY "Vehicle creators can delete" 
  ON vehicles FOR DELETE TO authenticated 
  USING (auth.uid() = user_id OR auth.uid() = uploaded_by OR is_admin);
```

**Conflicting Policy** (from `20251020000001_public_vehicle_reads.sql`):
```sql
-- This policy ONLY shows vehicles with is_public = true
CREATE POLICY "Public can view all vehicles" 
  ON vehicles FOR SELECT 
  USING (is_public = true);
```

**⚠️ CONFLICT**: Two SELECT policies exist - one allows all, one filters by `is_public`.

### Permission Layers

1. **Direct Ownership**:
   - `user_id`: Generated column (legacy, auto-set)
   - `owner_id`: Explicit ownership (for verified owners)
   - `uploaded_by`: Who created/imported (NOT ownership)

2. **Contributor System**:
   - `vehicle_contributors`: User roles (owner, mechanic, photographer, etc.)
   - `vehicle_user_permissions`: Granular permissions
   - `vehicle_contributor_roles`: Time-based role assignments

3. **Organization System**:
   - `organization_vehicles`: Links vehicles to organizations
   - `organization_contributors`: Organization member roles
   - `origin_organization_id`: Source organization for imports

4. **Verification System**:
   - `ownership_verifications`: Legal ownership proof
   - `vehicle_user_has_access()`: Function checks all permission sources

## What's Missing for Smoother Functionality

### 1. **Organization Attribution** ⚠️ CRITICAL
**Problem**: Automated imports create vehicles with `uploaded_by = system_user` but no organization link.

**Solution**: 
- Create a "Craigslist Scraper" organization
- Link all `discovery_source = 'craigslist_scrape'` vehicles to this org
- Set `origin_organization_id` on insert

**Code Change Needed**:
```typescript
// In scrape-all-craigslist-squarebodies/index.ts
// After finding importUserId, find or create organization:
const { data: scraperOrg } = await supabase
  .from('organizations')
  .select('id')
  .eq('name', 'Craigslist Scraper')
  .maybeSingle();

let orgId = scraperOrg?.id;
if (!orgId) {
  const { data: newOrg } = await supabase
    .from('organizations')
    .insert({
      name: 'Craigslist Scraper',
      organization_type: 'automation',
      is_public: true
    })
    .select('id')
    .single();
  orgId = newOrg.id;
}

// Then in vehicleInsert:
vehicleInsert.origin_organization_id = orgId;
```

### 2. **Clear Attribution in UI** ⚠️ IMPORTANT
**Problem**: Vehicles show "Uploaded by: system@n-zero.dev" which is confusing.

**Solution**:
- Show organization name instead: "Discovered via: Craigslist Scraper"
- Use `origin_metadata.discovery_source` for display
- Show "Automated Import" badge

**Frontend Change Needed**:
```typescript
// In VehicleProfile.tsx or VehicleCard.tsx
const attribution = vehicle.origin_organization_id 
  ? `Discovered via: ${organization.name}`
  : vehicle.discovery_source 
    ? `Discovered via: ${vehicle.discovery_source}`
    : `Uploaded by: ${uploaderName}`;
```

### 3. **Homepage Feed Filtering** ✅ FIXED
**Status**: Fixed - vehicles now have `status = 'active'` and appear in feed.

### 4. **RLS Policy Conflicts** ⚠️ NEEDS CLEANUP
**Problem**: Multiple conflicting SELECT policies exist.

**Solution**: 
- Drop old `"Public can view all vehicles"` policy (filters by `is_public`)
- Keep `"Anyone can view vehicles"` policy (allows all)
- OR: Keep both but make them consistent

**Migration Needed**:
```sql
-- Drop conflicting policy
DROP POLICY IF EXISTS "Public can view all vehicles" ON vehicles;

-- Ensure single consistent policy
-- (Already exists: "Anyone can view vehicles" USING (true))
```

### 5. **Timeline Event Creation** ⚠️ MISSING
**Problem**: Automated imports don't create timeline events.

**Solution**: Create timeline event on vehicle creation:
```typescript
// After vehicle insert:
await supabase.from('timeline_events').insert({
  vehicle_id: newVehicle.id,
  event_type: 'discovery',
  event_date: new Date().toISOString(),
  description: `Discovered via ${discovery_source}`,
  metadata: {
    discovery_url: listingUrl,
    automated: true,
    source: 'craigslist_scrape'
  }
});
```

### 6. **Image Download & Processing** ⚠️ NOT IMPLEMENTED
**Problem**: Vehicles are created but images aren't downloaded from listings.

**Solution**: 
- Download images from `scrapeData.data.images`
- Upload to Supabase Storage
- Link to `vehicle_images` table
- Trigger `analyze-image` edge function

**Code Needed**:
```typescript
// After vehicle creation:
if (scrapeData.data.images && scrapeData.data.images.length > 0) {
  for (const imageUrl of scrapeData.data.images) {
    // Download image
    const imageResponse = await fetch(imageUrl);
    const imageBlob = await imageResponse.blob();
    
    // Upload to storage
    const fileName = `${vehicleId}/${Date.now()}.jpg`;
    const { data: uploadData } = await supabase.storage
      .from('vehicle-images')
      .upload(fileName, imageBlob);
    
    // Create vehicle_image record
    await supabase.from('vehicle_images').insert({
      vehicle_id: vehicleId,
      image_url: uploadData.path,
      uploaded_by: importUserId,
      is_primary: false
    });
    
    // Trigger AI analysis
    await supabase.functions.invoke('analyze-image', {
      body: { vehicle_id: vehicleId, image_url: uploadData.path }
    });
  }
}
```

### 7. **Deduplication** ⚠️ BASIC ONLY
**Problem**: Only checks VIN and year/make/model - no image-based matching.

**Solution**: 
- Use `match-vehicles-by-images` edge function
- Compare listing images to existing vehicle images
- Merge duplicates before creating new vehicle

### 8. **Error Recovery & Retry** ⚠️ MISSING
**Problem**: If insert fails, no retry mechanism.

**Solution**:
- Log failed inserts to `failed_imports` table
- Retry queue for failed imports
- Admin dashboard to review failures

## Recommended Implementation Order

1. **Organization Attribution** (High Priority)
   - Creates clear ownership structure
   - Enables organization-based filtering
   - Improves UI attribution

2. **RLS Policy Cleanup** (High Priority)
   - Resolves conflicts
   - Ensures consistent access
   - Prevents future confusion

3. **Timeline Event Creation** (Medium Priority)
   - Tracks discovery history
   - Builds vehicle context
   - Enables user contribution tracking

4. **Image Download & Processing** (Medium Priority)
   - Completes vehicle profiles
   - Enables AI analysis
   - Improves feed appearance

5. **UI Attribution Improvements** (Low Priority)
   - Better user experience
   - Clearer data provenance
   - Professional appearance

6. **Advanced Deduplication** (Low Priority)
   - Prevents duplicates
   - Merges related vehicles
   - Improves data quality

## Current Vehicle State Summary

**16 vehicles created from Craigslist:**
- ✅ Visible in homepage feed (`is_public = true`, `status = 'active'`)
- ✅ Accessible to all users (public read)
- ✅ Editable by authenticated users (Wikipedia model)
- ⚠️ Attributed to system user (confusing)
- ⚠️ No organization link (limbo state)
- ⚠️ No timeline events (no history)
- ⚠️ No images (incomplete profiles)

**Next Steps**: Implement organization attribution and timeline events to complete the system.

