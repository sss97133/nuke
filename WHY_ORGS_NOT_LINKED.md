# Why Organizations Weren't Linked to 1974 Bronco

## Root Cause Analysis

### Vehicle Creation
- **Created**: October 26, 2025
- **Profile Origin**: `user_uploaded` (NOT `bat_import` or `dropbox_import`)
- **Origin Organization ID**: NULL (not set)
- **Uploaded By**: User (not organization)

### Missing Data Points

1. **No Origin Organization Set**
   - Vehicle was created manually by user, not via BAT import or Dropbox
   - `origin_organization_id` is NULL
   - Trigger `trigger_auto_link_origin_org` only fires when `origin_organization_id` is set

2. **Timeline Events Have No Organization Info**
   - All 8 timeline events are just "Photos Added" or "Purchase receipt"
   - NO `organization_id` set
   - NO `service_provider_name` set
   - NO `work_category` in metadata
   - Trigger `trg_link_org_from_timeline_event` has nothing to link from

3. **No Receipts/Documents Processed**
   - 0 receipts with vendor names
   - No `vehicle_documents` records with `vendor_name` matching organizations
   - Trigger `trg_auto_tag_org_from_receipt` never fired

4. **AI Analysis Not Run**
   - 0 AI scan sessions for this vehicle
   - No `work_order_parts` or `work_order_labor` records
   - No `work_category` metadata extracted from images
   - `generate-work-logs` function hasn't analyzed the 277 images

5. **No GPS Data Linking**
   - Images may have GPS coordinates, but no auto-linking happened
   - GPS-based organization matching requires images to be within radius of organization location

## Why Auto-Linking Failed

### Expected Auto-Linking Paths (None Triggered):

1. **Origin Organization Trigger** ❌
   - Requires: `origin_organization_id` set on vehicle creation
   - Reality: Vehicle created with `profile_origin = 'user_uploaded'`, no origin org

2. **Timeline Event Trigger** ❌
   - Requires: Timeline events with `organization_id` or `service_provider_name`
   - Reality: All events are generic "Photos Added" with no org info

3. **Receipt Trigger** ❌
   - Requires: `vehicle_documents` with `vendor_name` matching organization names
   - Reality: 0 receipts processed, no vendor names extracted

4. **AI Analysis** ❌
   - Requires: `generate-work-logs` function run on image bundles
   - Reality: No AI analysis run, no work categories identified

5. **GPS Auto-Linking** ❌
   - Requires: Images with GPS coordinates near organization locations
   - Reality: Either no GPS data or not within matching radius

## Solution Applied

1. **Created Trigger for Future Events**
   - `trg_link_org_from_timeline_event` now auto-links when timeline events have org info
   - Backfill migration links existing events (but this vehicle had none)

2. **Manually Linked Organizations**
   - Created `organization_vehicles` records directly:
     - Viva! Las Vegas Autos (work_location)
     - Ernies Upholstery (service_provider)
     - Taylor Customs (service_provider)

## Prevention for Future Vehicles

To ensure organizations are auto-linked:

1. **Run AI Analysis on Image Bundles**
   ```bash
   # Analyze image bundles to extract work categories
   node scripts/analyze-bundle-direct.js <vehicle_id>
   ```

2. **Process Receipts/Documents**
   - Upload receipts with vendor names
   - Trigger will auto-match vendor names to organizations

3. **Set Organization on Timeline Events**
   - When creating timeline events, set `organization_id` or `service_provider_name`
   - New trigger will auto-create `organization_vehicles` links

4. **Use Origin Tracking**
   - When creating vehicles, set `origin_organization_id` if known
   - Trigger will auto-link on vehicle creation

## Next Steps

1. Run AI analysis on this vehicle's 277 images to extract work categories
2. Process any receipts/documents to extract vendor names
3. Update timeline events with organization info if available
4. The new triggers will handle future auto-linking automatically

