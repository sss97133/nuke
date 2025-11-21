# Link Viva! Las Vegas Autos Vehicles

## Current Status
- **70 vehicles** currently linked to Viva! Las Vegas Autos
- **Expected**: ~53 BAT profiles + Dropbox imports

## Origin Tracking Migration
Created migration `20251121000001_vehicle_origin_tracking.sql` that:
1. Adds `profile_origin` column to track source (bat_import, dropbox_import, manual_entry, etc.)
2. Adds `origin_organization_id` to link vehicles to their source organization
3. Adds `origin_metadata` JSONB for additional origin details
4. Auto-links vehicles to organizations based on origin
5. Backfills existing vehicles with origin data

## Multi-Business Location
- **Viva! Las Vegas Autos**: 707 Yucca St, Boulder City, NV
- **Ernie's Upholstery**: 707 Yucca Street (same location, ~50m apart)
- Both businesses share the same physical location

## Next Steps

### 1. Verify Origin Tracking
```sql
SELECT 
  profile_origin,
  COUNT(*) as count,
  COUNT(CASE WHEN origin_organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf' THEN 1 END) as linked_to_viva
FROM vehicles
WHERE created_at >= '2024-01-01'
GROUP BY profile_origin;
```

### 2. Find Missing BAT Vehicles
```sql
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.bat_listing_title,
  v.bat_seller,
  v.created_at
FROM vehicles v
LEFT JOIN organization_vehicles ov ON ov.vehicle_id = v.id 
  AND ov.organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'
WHERE (v.discovery_source ILIKE '%bat%' OR v.discovery_url ILIKE '%bringatrailer%')
  AND v.created_at >= '2024-01-01'
  AND ov.id IS NULL
ORDER BY v.created_at DESC;
```

### 3. Find Missing Dropbox Vehicles
```sql
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.import_source,
  v.created_at
FROM vehicles v
LEFT JOIN organization_vehicles ov ON ov.vehicle_id = v.id 
  AND ov.organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'
WHERE (v.import_source = 'dropbox' OR v.discovery_source ILIKE '%dropbox%')
  AND ov.id IS NULL
ORDER BY v.created_at DESC;
```

### 4. Handle Multi-Business Location
Vehicles at 707 Yucca St could belong to:
- **Viva! Las Vegas Autos** (dealer/consignment)
- **Ernie's Upholstery** (service provider)

Need to determine relationship based on:
- Vehicle type (upholstery work → Ernie's, dealer inventory → Viva)
- Image GPS data
- Timeline events
- Receipts/documents

