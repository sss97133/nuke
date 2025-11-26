# GPS-Based Organization Auto-Assignment

## Overview

Added automatic organization assignment based on GPS coordinates from vehicle images. This helps users "offload" work vehicles from their personal view by automatically associating them with the proper businesses.

## What Was Built

### 1. Database Functions

**`find_suggested_organizations_for_vehicle`**
- Scans all GPS coordinates from vehicle images
- Finds nearby organizations within specified distance (default 500m)
- Returns suggestions with confidence scores, distances, and image counts
- Considers user's organization memberships to suggest `work_location` vs `service_provider`

**`bulk_assign_vehicles_to_orgs_by_gps`**
- Bulk assigns multiple vehicles to organizations based on GPS
- Configurable max distance and min confidence thresholds
- Returns assignment results with success/failure reasons

### 2. Offload Vehicle Button
**Component**: `OffloadVehicleButton.tsx`

Allows users to completely remove vehicles from personal view:
- Removes from `discovered_vehicles` (personal relationships)
- Marks as hidden in preferences
- Removes personal ownership (but keeps vehicle in system)
- Vehicle still visible in organization contexts if linked

### 3. GPS Organization Suggestions
**Component**: `GPSOrganizationSuggestions.tsx`

Shows suggested organizations for each vehicle:
- Displays nearby organizations based on image GPS coordinates
- Shows distance, confidence score, and image count
- One-click assignment to suggested organization
- Only shows if vehicle has GPS coordinates in images

### 4. Bulk GPS Assignment
**Component**: `BulkGPSAssignment.tsx`

Bulk tool for auto-assigning multiple vehicles:
- Scans selected vehicles for GPS coordinates
- Configurable max distance (default 500m) and min confidence (default 50%)
- Shows assignment results with success/failure
- Assigns to nearest organization with sufficient confidence

## How It Works

### Automatic GPS Matching

1. **Image Upload**: When images with GPS coordinates are uploaded, the existing trigger `auto_tag_organization_from_gps` automatically links vehicles to nearby organizations (within 500m)

2. **Manual Suggestions**: The new `find_suggested_organizations_for_vehicle` function scans ALL images for a vehicle and finds all nearby organizations, not just the closest one

3. **Bulk Assignment**: Users can select multiple vehicles and bulk-assign them to organizations based on GPS coordinates

### Offload Process

When a user clicks "OFFLOAD":
1. Removes personal relationship (`discovered_vehicles`)
2. Marks as hidden in preferences
3. Removes personal ownership (if user uploaded it)
4. Vehicle stays in system but is no longer "yours"
5. Still visible in organization contexts if linked

### GPS-Based Assignment Logic

```
For each vehicle:
  1. Get all GPS coordinates from vehicle_images
  2. For each coordinate:
     - Find organizations within max_distance (default 500m)
     - Calculate confidence: (1 - distance/max_distance) * 100
     - If user is member of org → suggest "work_location"
     - Otherwise → suggest "service_provider"
  3. Return best matches sorted by confidence
```

## Usage Examples

### Example 1: Offload Work Vehicle
```
1. User sees vehicle from work in personal view
2. Clicks "OFFLOAD" button on vehicle card
3. Confirms removal
4. Vehicle disappears from personal view
5. Still visible when viewing organization context
```

### Example 2: Auto-Assign by GPS
```
1. User selects 20 vehicles
2. Clicks "AUTO-ASSIGN BY GPS" in bulk toolbar
3. System scans GPS coordinates from vehicle images
4. Finds nearby organizations (within 500m)
5. Assigns vehicles to organizations with >50% confidence
6. Shows results: "✓ 15 assigned, ✗ 5 failed (no GPS data)"
```

### Example 3: GPS Suggestions
```
1. User views vehicle card
2. System shows "Suggested Organizations (GPS-based)"
3. Lists nearby organizations with:
   - Distance (e.g., "150m away")
   - Confidence (e.g., "85% confidence")
   - Image count (e.g., "3 images")
4. User clicks "ASSIGN" to link vehicle
```

## Technical Details

### Database Migration
File: `supabase/migrations/20250127_gps_organization_suggestions.sql`

**Functions**:
- `find_suggested_organizations_for_vehicle`: Returns suggested orgs for a vehicle
- `bulk_assign_vehicles_to_orgs_by_gps`: Bulk assigns vehicles to orgs

**Security**: Both functions use `SECURITY DEFINER` to access organization data

### Component Integration

**Vehicles.tsx**:
- Added `BulkGPSAssignment` to bulk actions
- Added `GPSOrganizationSuggestions` to each vehicle card
- Shows suggestions below vehicle card

**VehicleOrganizationToolbar.tsx**:
- Added `OffloadVehicleButton` component
- Appears at bottom of toolbar

## Configuration

### GPS Assignment Settings

**Max Distance** (default: 500m)
- Maximum distance to consider for organization matching
- Increase for rural areas, decrease for dense urban areas

**Min Confidence** (default: 50%)
- Minimum confidence score to auto-assign
- Higher = more strict (fewer false positives)
- Lower = more lenient (more assignments)

### Confidence Score Calculation

```
confidence = (1 - distance / max_distance) * 100

Examples:
- 0m away = 100% confidence
- 250m away (half max) = 50% confidence
- 500m away (max) = 0% confidence
```

## Next Steps

### Potential Enhancements
1. **Historical GPS Tracking**: Track vehicle location over time
2. **Multi-Location Support**: Handle vehicles that move between locations
3. **Collaborator Matching**: Match based on collaborators at same address
4. **Time-Based Matching**: Consider when images were taken (work hours vs off-hours)
5. **Address Geocoding**: Geocode addresses from receipts/documents
6. **Manual Override**: Allow users to override auto-assignments

### Migration Required

Apply the migration:
```bash
supabase migration up
```

Or via Supabase dashboard:
1. Go to Database → Migrations
2. Apply `20250127_gps_organization_suggestions.sql`

## Files Created/Modified

### New Files
- `supabase/migrations/20250127_gps_organization_suggestions.sql`
- `nuke_frontend/src/components/vehicles/OffloadVehicleButton.tsx`
- `nuke_frontend/src/components/vehicles/GPSOrganizationSuggestions.tsx`
- `nuke_frontend/src/components/vehicles/BulkGPSAssignment.tsx`

### Modified Files
- `nuke_frontend/src/pages/Vehicles.tsx`
- `nuke_frontend/src/components/vehicles/VehicleOrganizationToolbar.tsx`

## Summary

The system now provides:

1. **Automatic GPS Matching**: Existing trigger auto-links vehicles when images with GPS are uploaded
2. **Manual Suggestions**: Shows suggested organizations based on all GPS coordinates
3. **Bulk Assignment**: Auto-assign multiple vehicles to organizations
4. **Offload Tool**: Remove vehicles from personal view while keeping in system

Users can now:
- See suggested organizations for each vehicle
- Bulk-assign work vehicles to proper businesses
- Offload annoying vehicles from personal view
- Let GPS coordinates do the work automatically

This solves the problem of work vehicles cluttering personal views by automatically associating them with the proper businesses based on where photos were taken.

