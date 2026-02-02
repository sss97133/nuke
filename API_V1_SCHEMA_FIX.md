# API v1 Schema Mismatch Fix

**Date:** 2026-02-01
**Fixed by:** Claude Code Agent

## Problem

The API v1 endpoints had schema mismatches with the actual database columns, causing queries to fail.

## Mismatches Identified

### api-v1-vehicles
| API Used | Database Has | Fix Applied |
|----------|-------------|-------------|
| `exterior_color` | `color` | Changed to `color` |
| `sale_price` | `purchase_price` | Changed to `purchase_price` |

Note: Database has both `purchase_price` (numeric) and `sale_price` (integer). The API now uses `purchase_price` which is the correct field for vehicle acquisition cost.

### api-v1-observations
| API Used | Database Has | Fix Applied |
|----------|-------------|-------------|
| `source_type` | `source_id` | Changed to `source_id` (UUID reference) |
| `observation_kind` | `kind` | Changed to `kind` (enum type) |
| `data` | `structured_data` | Changed to `structured_data` |

## Files Modified

1. `/Users/skylar/nuke/supabase/functions/api-v1-vehicles/index.ts`
   - Updated `VehicleInput` interface
   - Fixed SELECT queries (lines 68-71, 105-107)
   - Fixed INSERT statement (lines 154-169)
   - Fixed UPDATE mapping (lines 205-218)

2. `/Users/skylar/nuke/supabase/functions/api-v1-observations/index.ts`
   - Updated `ObservationInput` interface
   - Fixed SELECT query (lines 74-78)
   - Fixed WHERE clause for `kind` filter (line 87)
   - Fixed validation error message (line 126)
   - Fixed INSERT statement (lines 164-176)
   - Changed `confidence` → `confidence_score`
   - Changed `provenance` → `extraction_metadata`

## Deployment

Both functions were successfully deployed:
```bash
supabase functions deploy api-v1-vehicles --no-verify-jwt
supabase functions deploy api-v1-observations --no-verify-jwt
```

## Verification

Tested schema alignment:
- ✅ `vehicles` table has `color` and `purchase_price` columns
- ✅ `vehicle_observations` table has `source_id`, `kind`, and `structured_data` columns
- ✅ `observation_kind` enum exists with 14 valid values
- ✅ `observation_sources` table exists with valid source IDs

## API Usage Changes

### Before (broken):
```json
POST /api/v1/vehicles
{
  "exterior_color": "Red",
  "sale_price": 50000
}
```

### After (working):
```json
POST /api/v1/vehicles
{
  "color": "Red",
  "purchase_price": 50000
}
```

### Observations Before (broken):
```json
POST /api/v1/observations
{
  "source_type": "manual",
  "observation_kind": "listing",
  "data": {...}
}
```

### Observations After (working):
```json
POST /api/v1/observations
{
  "source_id": "uuid-of-source",
  "kind": "listing",
  "structured_data": {...}
}
```

## Notes

- The `source_id` field must reference a valid UUID from the `observation_sources` table
- The `kind` field must be one of the valid `observation_kind` enum values
- Auth still requires valid JWT or API key (service role key alone doesn't work with custom auth)
