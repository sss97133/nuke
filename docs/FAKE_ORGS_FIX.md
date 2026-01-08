# Fix for Fake Organizations Created by process-import-queue

## Problem

The `process-import-queue` function was creating invalid/fake organizations due to:
1. **Missing validation**: Organizations could be created with `business_name: null` if only a website was provided
2. **Weak website validation**: Only checked if URL started with "http", not full URL format validation
3. **Race conditions**: Parallel processing could create duplicate organizations for the same dealer
4. **No deduplication**: Missing checks before insert could create duplicates

## Solution

### 1. Enhanced Validation (`supabase/functions/process-import-queue/index.ts`)

**Changes made:**
- Added strict `isValidWebsite()` function that validates full URL format
- Enhanced `isValidBusinessName()` to reject URLs in business names
- **Critical fix**: Now requires `business_name` to be non-null before creating any organization
- If website exists but name doesn't, extracts and validates a name from the domain
- Final validation gate prevents creation if no valid `business_name` exists

**Key validation rules:**
```typescript
// Website must be a valid URL format
function isValidWebsite(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  return /^https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(url.trim());
}

// Business name cannot be null when creating org
if (!finalBusinessName) {
  console.warn(`⚠️ Skipping org creation: final validation failed - no valid business_name`);
}
```

### 2. Race Condition Prevention

**Changes made:**
- Added pre-insert checks for existing organizations by website and name
- Prevents duplicate creation when multiple parallel workers process the same dealer
- Updates missing website if organization found by name

**Implementation:**
```typescript
// Check for existing org by website first (strongest match)
if (hasWebsite) {
  const { data: existingByWebsite } = await supabase
    .from('businesses')
    .select('id, business_name')
    .eq('website', dealerWebsite)
    .maybeSingle();
  
  if (existingByWebsite) {
    // Use existing org, don't create duplicate
    newOrg = existingByWebsite;
  }
}

// Fallback: check by name before creating
if (!newOrg) {
  const { data: existingByName } = await supabase
    .from('businesses')
    .select('id, website')
    .ilike('business_name', finalBusinessName)
    .maybeSingle();
  
  if (existingByName) {
    // Use existing org, update website if missing
    newOrg = existingByName;
  } else {
    // Only create if doesn't exist
    const insertResult = await supabase.from('businesses').insert(orgData);
  }
}
```

### 3. Cleanup Tools

#### SQL Script: `scripts/cleanup-fake-orgs-import-queue.sql`

**Features:**
- Identifies fake organizations by issue type (null name, too short, contains URL, invalid website)
- Finds duplicates (by website or name)
- Identifies safe-to-delete organizations (no dependencies)
- DRY-RUN mode by default for safety

**Usage:**
```sql
-- 1. Identify fake orgs (DRY RUN)
-- Run the SELECT queries in the script

-- 2. Review results, then enable DELETE section
-- Remove comments from the DELETE block and set a created_at cutoff
```

#### Node.js Script: `scripts/identify-and-cleanup-fake-orgs.js`

**Features:**
- Identifies fake organizations
- Checks dependencies before deletion
- Dry-run mode by default
- Batch deletion with progress tracking

**Usage:**
```bash
# Identify fake orgs (read-only)
node scripts/identify-and-cleanup-fake-orgs.js

# Dry run cleanup (won't delete, shows what would be deleted)
node scripts/identify-and-cleanup-fake-orgs.js --cleanup

# Actually delete fake orgs (no dry-run)
node scripts/identify-and-cleanup-fake-orgs.js --cleanup --no-dry-run
```

#### Edge Function: `supabase/functions/cleanup-fake-orgs/index.ts`

**Features:**
- REST API endpoint for cleanup
- Identify or cleanup operations
- Dry-run support

**Usage:**
```bash
# Identify fake orgs
curl "https://your-project.supabase.co/functions/v1/cleanup-fake-orgs?action=identify"

# Dry run cleanup
curl "https://your-project.supabase.co/functions/v1/cleanup-fake-orgs?action=cleanup&dry_run=true"

# Actually cleanup
curl -X POST "https://your-project.supabase.co/functions/v1/cleanup-fake-orgs?action=cleanup&dry_run=false" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```

## What Constitutes a "Fake" Organization?

Organizations are considered fake/invalid if they have:
1. **Null business_name** - Missing required identifier
2. **Too short name** - Less than 3 characters
3. **Name contains URL** - Business name is actually a URL string
4. **Invalid website format** - Website doesn't match valid URL pattern

**Safe to delete criteria:**
- Must have no dependencies:
  - No organization_contributors
  - No organization_vehicles (active)
  - No organization_images
  - No business_team_data
  - No business_ownership
  - No business_user_roles

## Testing

After deploying fixes:

1. **Monitor logs** for warnings like:
   ```
   ⚠️ Skipping org creation: final validation failed - no valid business_name
   ```

2. **Run cleanup** to remove existing fake orgs:
   ```bash
   node scripts/identify-and-cleanup-fake-orgs.js --cleanup --no-dry-run
   ```

3. **Verify** that new organizations created have valid data:
   - Check that all have non-null `business_name`
   - Verify no duplicates are created
   - Confirm website URLs are properly formatted

## Prevention

The fixes prevent future fake org creation by:
- ✅ Requiring valid `business_name` before any insert
- ✅ Validating website URL format strictly
- ✅ Checking for existing orgs before insert (race condition prevention)
- ✅ Better error logging for debugging

## Rollback

If issues occur, you can revert the changes to `process-import-queue/index.ts`:
- Remove the `isValidWebsite()` function
- Revert validation logic to previous version
- Remove race condition checks (though these are safe to keep)

The cleanup tools are read-only unless explicitly enabled, so they're safe to run anytime.

