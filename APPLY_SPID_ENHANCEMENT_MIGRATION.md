# Apply Enhanced SPID Verification Migration

## What This Does

When an SPID (Service Parts Identification decal) is detected in an image, the system will now automatically:

1. ✅ **Extract all SPID data**: VIN, paint codes, RPO codes, engine code, transmission code, build date, model code
2. ✅ **Auto-fill empty vehicle fields**: If the vehicle doesn't have data, SPID fills it in
3. ✅ **Trigger VIN decoding**: Calls NHTSA VPIC API to decode the VIN and get ~150 data points
4. ✅ **Cross-verify all data**: Compares SPID data vs existing vehicle data vs VIN decode results
5. ✅ **Log discrepancies**: Records any mismatches for review
6. ✅ **Update verification status**: Creates comprehensive verification record

## Edge Function Deployed

✅ `decode-vin` Edge Function is deployed and ready

## Migration Required

The migration file is located at:
```
/Users/skylar/nuke/supabase/migrations/20251203_enhanced_spid_verification_system.sql
```

### Option 1: Apply via Supabase Dashboard (Recommended)

1. Go to https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new
2. Copy the contents of `/Users/skylar/nuke/supabase/migrations/20251203_enhanced_spid_verification_system.sql`
3. Paste into the SQL editor
4. Click "Run"

### Option 2: Apply via Supabase CLI

```bash
cd /Users/skylar/nuke
supabase db push
```

(Note: This may require database password or proper credentials)

## What Gets Created

### Tables
- `vin_decode_cache` - Caches VIN decoding results from NHTSA (7-day cache)
- `vehicle_comprehensive_verification` - Stores verification status combining SPID, VIN decode, and other sources

### Functions
- `trigger_vin_decode()` - Triggers async VIN decoding via Edge Function
- `verify_vehicle_from_spid_enhanced()` - Enhanced SPID verification with comprehensive cross-checking

### Triggers
- `trigger_verify_vehicle_from_spid_enhanced` - Automatically runs when SPID data is inserted/updated

## Frontend Integration

The tier1 analysis (`/supabase/functions/analyze-image-tier1/index.ts`) has been updated to:

1. Detect SPID sheets during image processing
2. Extract all SPID fields (not just VIN)
3. Store in `vehicle_spid_data` table (triggers verification)
4. Call `decode-vin` Edge Function for immediate VIN decoding
5. Log all verification results

## Testing

After applying the migration, test with an SPID image:

1. Upload an image containing a GM SPID decal to any vehicle
2. The tier1 analysis will detect it automatically
3. Check the database:
   - `vehicle_spid_data` table should have the extracted data
   - `vin_decode_cache` should have the VIN decode results
   - `vehicle_comprehensive_verification` should show verification status
   - Vehicle fields should be auto-filled where empty

## Verification Flow

```
Image Upload
    ↓
Tier 1 Analysis (Gemini/Claude/OpenAI)
    ↓
SPID Detection (GPT-4o)
    ↓
Insert into vehicle_spid_data
    ↓
Database Trigger: verify_vehicle_from_spid_enhanced()
    ├─→ Auto-fill empty vehicle fields
    ├─→ Verify existing fields
    ├─→ Call decode-vin Edge Function
    ├─→ Cross-verify all sources
    ├─→ Log discrepancies
    └─→ Update comprehensive_verification
         ↓
    VIN Decode (NHTSA VPIC API)
         ↓
    Update vehicle with decoded data
         ↓
    ✅ Comprehensive Verification Complete
```

## Benefits

1. **Automatic Data Entry**: No manual VIN entry needed when SPID is detected
2. **Validation**: Cross-checks multiple sources (SPID, VIN decode, user input)
3. **Confidence Scores**: Tracks how verified each field is
4. **Discrepancy Detection**: Flags mismatches for review
5. **Comprehensive History**: Logs all verification events
6. **Public VIN Data**: VIN decode results are public (anyone can view)

## Next Steps

1. Apply the migration
2. Test with real SPID images
3. Review verification results in database
4. (Optional) Add frontend UI to display verification status

