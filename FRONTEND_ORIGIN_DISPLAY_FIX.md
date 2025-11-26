# Frontend Origin Display - Why It Looks the Same

## Current Status

**Database:** ✅ Fixed - `profile_origin = 'dropbox_import'`  
**Frontend Code:** ✅ Ready - Shows "Dropbox" badge for `dropbox_import`  
**User Experience:** ⚠️ May look the same due to cache

## Why It Might Look the Same

### 1. Browser Cache
The vehicle data might be cached in the browser. The frontend queries use `.select('*')` which includes `profile_origin`, but if the page was loaded before the migration, it might be showing cached data.

**Fix:** Hard refresh the page (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)

### 2. Frontend Badge Display

The badge should show "Dropbox" when `profile_origin = 'dropbox_import'`:

```tsx
// VehicleHeader.tsx line 732-746
{vehicle && (vehicle as any).profile_origin && (
  <div style={{ fontSize: '7pt', color: mutedTextColor, padding: '1px 6px', background: 'var(--grey-100)', borderRadius: '3px', whiteSpace: 'nowrap' }}>
    {(() => {
      const origin = (vehicle as any).profile_origin;
      const originLabels: Record<string, string> = {
        'bat_import': 'BAT',
        'dropbox_import': 'Dropbox',  // ← Should show this
        'url_scraper': 'Scraped',
        'manual_entry': 'Manual',
        'api_import': 'API'
      };
      return originLabels[origin] || origin;
    })()}
  </div>
)}
```

**If `profile_origin = 'dropbox_import'`, it should display "Dropbox"**

### 3. Missing Origin Label

If the vehicle still shows `profile_origin = 'bulk_import_legacy'` (which isn't in the map), it would display the raw value "bulk_import_legacy" instead of a nice label.

**But the migration changed it to `'dropbox_import'`, so this shouldn't be the issue.**

## What Should Change

**Before:**
- Badge might show "bulk_import_legacy" (raw value, not in map)
- Or no badge if `profile_origin` was null/empty

**After:**
- Badge should show "Dropbox" (from the originLabels map)
- Badge appears next to vehicle name in header

## Verification Steps

1. **Check database directly:**
   ```sql
   SELECT profile_origin, discovery_source, uploaded_by 
   FROM vehicles 
   WHERE id = '59743025-be7a-466f-abba-6bf0be29f33f';
   ```
   Should return: `dropbox_import`, `dropbox_bulk_import`, user ID

2. **Hard refresh the page:**
   - Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
   - This clears browser cache

3. **Check browser console:**
   - Open DevTools → Console
   - Look for the vehicle object
   - Check if `vehicle.profile_origin = 'dropbox_import'`

4. **Check Network tab:**
   - Open DevTools → Network
   - Reload page
   - Find the vehicles query
   - Check response - does it include `profile_origin: "dropbox_import"`?

## If Still Not Showing

If the badge still doesn't show "Dropbox" after hard refresh:

1. **Check if query includes profile_origin:**
   - The query uses `.select('*')` which should include it
   - But verify in Network tab

2. **Check if badge is rendering:**
   - The condition is `vehicle && (vehicle as any).profile_origin`
   - If `profile_origin` is null/undefined, badge won't show

3. **Add missing origin labels:**
   If there are other origin types not in the map, add them:
   ```tsx
   const originLabels: Record<string, string> = {
     'bat_import': 'BAT',
     'dropbox_import': 'Dropbox',
     'url_scraper': 'Scraped',
     'manual_entry': 'Manual',
     'api_import': 'API',
     'bulk_import_legacy': 'Legacy Import', // Add if needed
     'automated_import_legacy': 'Auto Import' // Add if needed
   };
   ```

## Expected Result

After hard refresh, the vehicle header should show:
- Vehicle name: "1996 GMC Suburban K2500"
- Badge: "Dropbox" (gray badge next to name)
- This indicates it came from Dropbox bulk import

## Current Database State

✅ `profile_origin = 'dropbox_import'`  
✅ `discovery_source = 'dropbox_bulk_import'`  
✅ `uploaded_by = '0b9f107a-d124-49de-9ded-94698f63c1c4'`  
✅ `origin_metadata` has full tracking info

The data is correct - it's just a matter of the frontend loading the updated data.

