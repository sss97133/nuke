# Discovered Vehicles Fix - URL Finds Should Not Be in Contributing

## Problem

URL-found vehicles (from Craigslist, marketplace, etc.) were incorrectly showing up in the "contributing" tab when they should only be in "discovered". Users wanted:
1. URL-found vehicles should NOT appear in "contributing"
2. "Discovered" tab should have filters for different discovery sources (Craigslist, Marketplace, etc.)

## Solution

### 1. Fixed Categorization Logic

**Before**: All vehicles uploaded by user (`uploaded_by` or `user_id`) went into "contributing" if no explicit relationship existed.

**After**: Vehicles are checked for URL discovery indicators:
- `discovery_url` exists
- `discovery_source` exists  
- `profile_origin === 'url_scraper'` or `'bat_import'`

If any of these are true, the vehicle is **skipped** from contributing and only appears in "discovered".

### 2. Added Discovery Source Tracking

Updated queries to include:
- `discovery_source` from `discovered_vehicles` table
- `discovery_url` and `discovery_source` from `vehicles` table
- `profile_origin` from `vehicles` table

Discovery source is inferred from URL if not explicitly set:
- `craigslist.org` → "Craigslist"
- `marketplace` → "Marketplace"
- `autotrader` → "AutoTrader"
- `cars.com` → "Cars.com"
- Other URLs → "External URL"

### 3. Added Discovery Source Filters

**New UI**: When viewing "Discovered" tab, users see filter buttons for:
- **ALL** - Show all discovered vehicles
- **CRAIGSLIST** - Only Craigslist finds
- **MARKETPLACE** - Only marketplace finds
- **AUTOTRADER** - Only AutoTrader finds
- **CARS.COM** - Only Cars.com finds
- **EXTERNAL URL** - Other URL finds

Filters are dynamically generated based on what discovery sources exist in the user's discovered vehicles.

## Code Changes

### Vehicles.tsx

1. **Updated vehicle queries** to include discovery fields:
```typescript
.select('*, discovery_url, discovery_source, profile_origin')
```

2. **Added URL detection logic** in contributing section:
```typescript
const isUrlFound = !!(
  vehicle.discovery_url || 
  vehicle.discovery_source || 
  vehicle.profile_origin === 'url_scraper' ||
  vehicle.profile_origin === 'bat_import'
);

if (isUrlFound) {
  // Skip - should only be in discovered
  return;
}
```

3. **Added discovery source to VehicleRelationship**:
```typescript
context: discoverySource || undefined
```

4. **Added discovery source filter state**:
```typescript
const [discoverySourceFilter, setDiscoverySourceFilter] = useState<string | null>(null);
```

5. **Added filter UI** in discovered tab:
- Shows filter buttons for each unique discovery source
- Filters vehicles by `relationship.context`

6. **Updated discovered vehicles processing** to extract and store discovery source from multiple sources (discovered_vehicles table, vehicles table, or inferred from URL)

## How It Works

### Vehicle Categorization Flow

```
User uploads vehicle
  ↓
Check: Has discovery_url or discovery_source?
  ↓ YES → Skip contributing, only add to discovered_vehicles
  ↓ NO → Check: Has explicit relationship?
    ↓ YES → Use that relationship
    ↓ NO → Add to contributing (manual upload)
```

### Discovery Source Priority

1. `discovered_vehicles.discovery_source` (explicit)
2. `vehicles.discovery_source` (from vehicle record)
3. Inferred from `vehicles.discovery_url` (URL pattern matching)

### Filtering

When viewing "Discovered" tab:
- Shows all discovered vehicles by default
- User can filter by source (Craigslist, Marketplace, etc.)
- Filter buttons dynamically generated from available sources
- Search still works across all filters

## Benefits

1. **Cleaner Contributing Tab**: Only shows vehicles user actually uploaded manually (not URL finds)
2. **Better Organization**: Discovered vehicles can be filtered by where they were found
3. **Accurate Categorization**: URL finds are properly separated from manual contributions
4. **User Control**: Easy to filter discovered vehicles by source

## Testing

To verify the fix:
1. Add a vehicle via URL (Craigslist, marketplace, etc.)
2. Check "Contributing" tab - should NOT appear
3. Check "Discovered" tab - should appear
4. Check discovery source filter - should show appropriate source button
5. Filter by source - should only show vehicles from that source

## Files Modified

- `nuke_frontend/src/pages/Vehicles.tsx`
  - Updated vehicle queries to include discovery fields
  - Added URL detection logic
  - Added discovery source tracking
  - Added discovery source filter UI
  - Updated filtering logic

## Summary

URL-found vehicles are now properly excluded from "contributing" and only appear in "discovered" with source-specific filters. This keeps the contributing tab clean for actual manual contributions while making it easy to organize and filter discovered vehicles by where they were found.

