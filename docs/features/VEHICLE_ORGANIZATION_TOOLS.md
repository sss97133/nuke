# Vehicle Organization Tools

## Overview

Added comprehensive organization tools to help users manage and organize vehicles across multiple business contexts. The system now supports both automatic organization (via GPS/receipt matching) and manual organization tools.

## What Was Built

### 1. Database Schema
- **`user_vehicle_preferences` table**: Stores manual organization preferences
  - `is_favorite`: Mark vehicles as favorites
  - `is_hidden`: Hide from personal view (still visible in org context)
  - `collection_name`: Custom collections (e.g., "Project Cars", "For Sale")
  - `notes`: Personal notes about vehicles
  - `display_order`: Custom sort order

### 2. Organization Context Filter
**Component**: `OrganizationContextFilter.tsx`

Allows users to filter vehicles by business context:
- **Personal View**: Shows all vehicles (default)
- **Organization View**: Shows only vehicles linked to selected organization

**Features**:
- Quick switch between personal and organization contexts
- Shows vehicle count per organization
- Displays organization logos

### 3. Manual Organization Toolbar
**Component**: `VehicleOrganizationToolbar.tsx`

Per-vehicle toolbar with manual organization tools:
- **FAVORITE**: Mark/unmark as favorite
- **HIDE**: Hide from personal view (still visible in organization context)
- **COLLECTION**: Add to custom collection or create new collection
- Shows existing collections in dropdown
- Quick remove from collection

### 4. Bulk Actions Toolbar
**Component**: `BulkActionsToolbar.tsx`

Bulk operations for multiple selected vehicles:
- **FAVORITE/UNFAVORITE**: Bulk favorite management
- **HIDE/UNHIDE**: Bulk hide/show
- **ADD TO COLLECTION**: Add multiple vehicles to collection
- **REMOVE FROM COLLECTION**: Remove from collections
- **DESELECT ALL**: Clear selection

### 5. Preference Filters
Added to Vehicles page:
- **ALL**: Show all vehicles (respects hidden filter)
- **FAVORITES**: Show only favorited vehicles
- **HIDDEN**: Show only hidden vehicles
- **COLLECTION**: Filter by specific collection (dropdown)

### 6. Selection System
- Checkbox on each vehicle card for bulk selection
- Selection persists across filters
- Bulk actions toolbar appears when vehicles are selected

## How It Works

### Organization Context Filtering

When a user selects an organization:
1. System queries `organization_vehicles` table for vehicles linked to that organization
2. Filters all relationship types (owned, contributing, etc.) to only show org-linked vehicles
3. Preference filters (favorites, hidden) are disabled in org context
4. Vehicles are still visible even if marked as "hidden" in personal view

### Manual Organization

Users can manually organize vehicles:
1. **Favorites**: Quick access to important vehicles
2. **Hidden**: Hide vehicles from personal view (e.g., old projects, sold vehicles)
3. **Collections**: Group vehicles by theme (e.g., "Restoration Projects", "Daily Drivers")

### Automatic vs Manual

- **Automatic**: GPS/receipt matching links vehicles to organizations via `organization_vehicles`
- **Manual**: User preferences stored in `user_vehicle_preferences` for personal organization

Both systems work together:
- Automatic linking shows vehicles in organization context
- Manual preferences organize personal view
- Hidden vehicles still appear in organization context

## Usage Examples

### Example 1: Filter by Business
```
1. User associated with "Viva Las Vegas Autos" and "My Personal Garage"
2. Click "Viva Las Vegas Autos" in organization filter
3. See only vehicles linked to that business
4. Switch back to "Personal" to see all vehicles
```

### Example 2: Create Collection
```
1. Select multiple vehicles
2. Click "ADD TO COLLECTION"
3. Type "Restoration Projects"
4. All selected vehicles added to collection
5. Filter by "COLLECTION" → "Restoration Projects" to see only those
```

### Example 3: Hide Old Projects
```
1. Find vehicles from old projects
2. Click "HIDE" on each (or select multiple and bulk hide)
3. Vehicles disappear from personal view
4. Still visible when viewing organization context
5. Can view hidden vehicles by filtering "HIDDEN"
```

### Example 4: Favorite Important Vehicles
```
1. Mark important vehicles as favorites
2. Filter by "FAVORITES" for quick access
3. Favorites automatically sort to top of list
```

## Technical Details

### Database Migration
File: `supabase/migrations/20250127_user_vehicle_preferences.sql`

**RLS Policies**:
- Users can only view/edit their own preferences
- Full CRUD access to own preferences

**Indexes**:
- `user_id` for fast user lookups
- `vehicle_id` for fast vehicle lookups
- Partial indexes on `is_favorite`, `is_hidden`, `collection_name` for filtered queries

### Component Integration

**Vehicles.tsx**:
- Added organization context state
- Added preference filter state
- Added selection state
- Updated `loadVehicleRelationships` to filter by organization
- Added `loadVehiclePreferences` function
- Updated filtering logic to respect preferences

**Vehicle Cards**:
- Added selection checkbox
- Added organization toolbar below each card
- Selection persists across filters

## Next Steps

### Potential Enhancements
1. **Collection Management**: UI to rename/delete collections
2. **Smart Collections**: Auto-create collections based on vehicle attributes
3. **Export Collections**: Export collection to CSV/PDF
4. **Collection Sharing**: Share collections with team members
5. **Bulk Relationship Editing**: Change relationship types in bulk
6. **Organization Defaults**: Set default view per organization

### Migration Required

The migration file has been created but needs to be applied:
```bash
# Apply migration
supabase migration up
```

Or via Supabase dashboard:
1. Go to Database → Migrations
2. Apply `20250127_user_vehicle_preferences.sql`

## Files Created/Modified

### New Files
- `supabase/migrations/20250127_user_vehicle_preferences.sql`
- `nuke_frontend/src/components/vehicles/OrganizationContextFilter.tsx`
- `nuke_frontend/src/components/vehicles/VehicleOrganizationToolbar.tsx`
- `nuke_frontend/src/components/vehicles/BulkActionsToolbar.tsx`

### Modified Files
- `nuke_frontend/src/pages/Vehicles.tsx`

## Summary

The system now provides comprehensive organization tools that work alongside automatic organization:

1. **Organization Context**: Filter vehicles by business
2. **Manual Organization**: Favorites, collections, hide
3. **Bulk Operations**: Manage multiple vehicles at once
4. **Smart Filtering**: Combine relationship types with preferences

Users can now effectively manage large vehicle lists across multiple business contexts without being overwhelmed by all vehicles they've ever worked on.

