# Vehicle Origin Tracking Summary

## Migration Applied: `20251121000001_vehicle_origin_tracking.sql`

### What Was Added
1. **`profile_origin`** column: Tracks source (`bat_import`, `dropbox_import`, `manual_entry`, `url_scraper`, `api_import`)
2. **`origin_organization_id`** column: Links vehicle to source organization
3. **`origin_metadata`** JSONB: Stores additional origin details (BAT seller, Dropbox folder, etc.)
4. **Auto-link trigger**: Automatically creates `organization_vehicles` links when `origin_organization_id` is set

### Current Status

**Total Linked to Viva! Las Vegas Autos: 70 vehicles**
- **55 Dropbox imports** (all linked)
- **1 BAT import** (should be ~53 - need to find missing ones)
- **14 Manual entries** (linked during tenure)

### Missing BAT Vehicles

The issue: Most BAT vehicles were imported in bulk batches but don't have `discovery_source` set properly. They were created on `2025-11-02 22:11:18.777511` in a batch.

**Solution**: 
1. Update vehicles from bulk batch to have `profile_origin = 'bat_import'`
2. Set `origin_organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'`
3. Trigger will auto-link them

### Multi-Business Location

**707 Yucca St, Boulder City, NV** hosts:
- **Viva! Las Vegas Autos** (dealer/consignment) - `c433d27e-2159-4f8c-b4ae-32a5e44a77cf`
- **Ernie's Upholstery** (service provider) - `e796ca48-f3af-41b5-be13-5335bb422b41`
- Distance: ~62 meters apart (same location)

**Strategy for Multi-Business Location:**
- Vehicles can link to **multiple organizations** with different relationship types
- Use GPS data from images to auto-link based on location
- Use timeline events and receipts to determine relationship type
- Example: Upholstery work → Ernie's, Dealer inventory → Viva

### Next Steps

1. **Find Missing BAT Vehicles**: Query vehicles created in bulk batches
2. **Update Origins**: Set `profile_origin` and `origin_organization_id` for BAT imports
3. **GPS-Based Linking**: Link vehicles to Ernie's Upholstery if images taken at location
4. **Verify Counts**: Should have ~53 BAT + 55 Dropbox = ~108 vehicles linked

