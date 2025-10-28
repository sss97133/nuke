# Mobile Timeline Debugging Guide

## Symptoms Checklist

When user reports "mobile timeline broken", check:

### 1. Visual Issues
- [ ] Timeline tab shows "Loading..." indefinitely
- [ ] Timeline tab is blank/empty
- [ ] Events don't display (years show but no data)
- [ ] Heatmap colors wrong
- [ ] Images don't load in event modals

### 2. Data Issues  
- [ ] No events loading (check console for count)
- [ ] Events loading but not grouping
- [ ] Years not expanding/collapsing
- [ ] Wrong vehicle ID being passed

### 3. Error Messages
- [ ] Console shows query errors
- [ ] RLS policy errors (permission denied)
- [ ] Network errors
- [ ] Type errors in grouping logic

## Debugging Steps

### Step 1: Check Console Logs
Look for these logs in browser console:
```
[MobileTimelineHeatmap] ===== LOADING TIMELINE DATA =====
[MobileTimelineHeatmap] Vehicle ID: [should show UUID]
[MobileTimelineHeatmap] ✅ Query successful
[MobileTimelineHeatmap] Events loaded: [should show number]
[MobileTimelineHeatmap] Grouped into years: [should show array]
```

### Step 2: Verify Vehicle ID
The vehicleId prop must be:
- Valid UUID format (with hyphens)
- Passed from MobileVehicleProfile correctly
- Not undefined/null

Check in console:
```javascript
// In browser console
console.log('Current URL:', window.location.href);
// Should show: /vehicle/{uuid}/mobile or similar
```

### Step 3: Test Query Manually
Run in Supabase SQL editor:
```sql
SELECT COUNT(*) 
FROM vehicle_timeline_events 
WHERE vehicle_id = 'YOUR_VEHICLE_ID';
```

Should return > 0 if vehicle has events.

### Step 4: Check RLS Policies
```sql
-- Test if you can read events
SELECT * 
FROM vehicle_timeline_events 
WHERE vehicle_id = 'YOUR_VEHICLE_ID'
LIMIT 1;
```

If this fails, RLS policies may be blocking access.

### Step 5: Check View Definition
```sql
-- Verify view exists and is valid
SELECT * FROM vehicle_timeline_events LIMIT 1;
```

Should return data with these computed fields:
- participant_count
- verification_count  
- service_info

## Common Issues & Fixes

### Issue: "No Timeline Events Found" but data exists

**Cause**: Vehicle ID mismatch or RLS blocking

**Fix**:
```typescript
// In MobileVehicleProfile.tsx, verify:
<MobileTimelineHeatmap vehicleId={vehicleId} />

// vehicleId should be from URL params
const { vehicleId } = useParams<{ vehicleId: string }>();
```

### Issue: Timeline loads but shows wrong data

**Cause**: Querying wrong table or view

**Fix**: Ensure using `vehicle_timeline_events` (enriched view), not `timeline_events` (base table)

### Issue: Events load but don't group by year

**Cause**: event_date format issue

**Fix**:
```typescript
// event_date should be DATE type, not timestamp
const date = new Date(event.event_date); // This must work
```

### Issue: Images don't show in event modal

**Cause**: image_urls array empty or malformed

**Fix**: Check event data structure:
```javascript
console.log('Event images:', event.image_urls);
// Should be array of strings: ["url1", "url2", ...]
```

## Quick Fixes

### Fix 1: Clear State and Reload
```typescript
// In component
useEffect(() => {
  if (vehicleId) {
    setYearData(new Map()); // Clear old data
    setLoading(true);
    loadTimelineData();
  }
}, [vehicleId]);
```

### Fix 2: Add Fallback for Empty Data
```typescript
if (years.length === 0) {
  return (
    <div>
      No events yet. Try:
      1. Adding photos to the vehicle
      2. Creating timeline events manually
      3. Check if vehicle ID is correct: {vehicleId}
    </div>
  );
}
```

### Fix 3: Force Re-render
```typescript
// Add key prop to force remount
<MobileTimelineHeatmap key={vehicleId} vehicleId={vehicleId} />
```

## Performance Issues

### Slow Loading
- Check event count (>1000 events may be slow)
- Add pagination if needed
- Limit initial query to current year

### Memory Issues  
- Large image_urls arrays can cause issues
- Consider lazy loading images
- Limit events shown per year

## Testing Checklist

Before marking as "fixed":
- [ ] Timeline loads in <2 seconds
- [ ] All years expand/collapse correctly
- [ ] Event modals open with images
- [ ] Colors reflect work intensity
- [ ] No console errors
- [ ] Works on different vehicles
- [ ] Works when logged in/out
- [ ] Mobile responsive (320px width)

## Emergency Rollback

If timeline is completely broken:

1. **Revert to basic version:**
```typescript
// In MobileVehicleProfile.tsx
{activeTab === 'timeline' && (
  <div>Timeline temporarily disabled for maintenance</div>
)}
```

2. **Use old MobileTimelineTab** (if it exists in git history)

3. **Fall back to desktop timeline** in mobile view

## Get Help

If still broken after trying above:
1. Check `/Users/skylar/nuke/TIMELINE_MOBILE_FIX_COMPLETE.md`
2. Review database view definition
3. Check for breaking migration changes
4. Test with different vehicles
5. Provide specific error messages and console logs

