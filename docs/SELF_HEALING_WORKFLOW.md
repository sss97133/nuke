# Self-Healing Vehicle Profile System

## Current State Analysis

### The Problem
Vehicle profile `3f1791fe-4fe2-4994-b6fe-b137ffa57370` was created from a BAT URL but is mostly empty:
- ✅ Has basic data: year (1976), make (Chevrolet), model (Silverado), VIN (CCS246Z153447)
- ✅ Has BAT URL: `https://bringatrailer.com/listing/1976-chevrolet-c20-pickup-5/`
- ✅ Has sale_price: $63,000
- ❌ Has 0 images
- ❌ Missing many fields (engine, transmission, mileage, color, etc.)

### What EXISTS (Manual Tools)

1. **PriceFixButton** (`nuke_frontend/src/components/vehicle/PriceFixButton.tsx`)
   - Shows when price issues detected
   - Calls `auto-fix-bat-prices` edge function
   - **Trigger**: Manual button click

2. **BAT URL Processing in Comments** (`nuke_frontend/src/components/VehicleComments.tsx`)
   - Detects BAT URLs in comments
   - Calls `scrape-vehicle` edge function
   - Validates VIN match before importing
   - **Trigger**: User posts BAT URL in comment

3. **Manual Scripts**
   - `scripts/fill-missing-vehicle-data.js` - Fills missing engine/specs from lookup table
   - `scripts/fix-missing-bat-info.js` - Scrapes BAT listings to fill missing data
   - **Trigger**: Manual execution

### What's MISSING (Automatic Self-Healing)

**NO automatic enrichment when:**
- Vehicle profile is viewed
- Profile is detected as incomplete
- BAT URL exists but data is missing
- Images are missing but BAT URL exists

## Workflow & Protocols to Avoid Redundancies

### 1. Duplicate Prevention Protocol

**VIN-Based Deduplication** (Primary)
```typescript
// Check if vehicle exists by VIN before creating
const { data: existing } = await supabase
  .from('vehicles')
  .select('id')
  .eq('vin', vin)
  .single();

if (existing) {
  // Update existing instead of creating new
  return { vehicleId: existing.id, action: 'updated' };
}
```

**URL-Based Deduplication** (Secondary)
```typescript
// Check if vehicle exists by listing_url
const { data: existing } = await supabase
  .from('vehicles')
  .select('id')
  .eq('bat_auction_url', batUrl)
  .single();

if (existing) {
  return { vehicleId: existing.id, action: 'updated' };
}
```

**Fuzzy Matching** (Tertiary - Only for updates, not creation)
```typescript
// Only used when updating existing profiles
// Match by year + make + model (loose match)
const { data: matches } = await supabase
  .from('vehicles')
  .select('id, vin')
  .eq('year', year)
  .ilike('make', `%${make}%`)
  .ilike('model', `%${model.split(' ')[0]}%`)
  .limit(1);
```

### 2. Data Enrichment Priority

**Priority Order:**
1. **VIN Match Required** - Never mix data from different VINs
2. **Existing Data > Scraped Data** - Don't overwrite user-entered data
3. **Fill Only Missing Fields** - Only update NULL/empty fields
4. **Confidence Scoring** - Track data source confidence

**Example:**
```typescript
// Only fill if field is missing
if (!vehicle.year && scrapedData.year) {
  updates.year = scrapedData.year;
}
// Don't overwrite existing data
if (vehicle.year && scrapedData.year && vehicle.year !== scrapedData.year) {
  // Log conflict, don't update
  console.warn('Year conflict:', vehicle.year, 'vs', scrapedData.year);
}
```

### 3. Self-Healing Trigger Points

**Proposed Automatic Triggers:**

1. **On Profile View** (if incomplete)
   ```typescript
   // In VehicleProfile.tsx loadData()
   if (vehicle && vehicle.bat_auction_url && imageCount === 0) {
     // Trigger background enrichment
     enrichFromBAT(vehicle.id, vehicle.bat_auction_url);
   }
   ```

2. **On Profile Creation** (if BAT URL provided)
   ```typescript
   // In import-bat-listing/index.ts
   // After creating vehicle, check completeness
   if (imageCount === 0 || missingFields.length > 0) {
     // Trigger immediate enrichment
     await enrichVehicleProfile(vehicleId, batUrl);
   }
   ```

3. **Scheduled Background Job** (for existing incomplete profiles)
   ```sql
   -- Find incomplete BAT profiles
   SELECT id, bat_auction_url
   FROM vehicles
   WHERE profile_origin = 'bat_import'
     AND bat_auction_url IS NOT NULL
     AND (
       (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = vehicles.id) = 0
       OR engine_size IS NULL
       OR transmission IS NULL
     )
   ```

## Proposed Solution: Automatic Self-Healing

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Vehicle Profile View                                    │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 1. Load Vehicle Data                              │ │
│  │ 2. Check Completeness Score                       │ │
│  │ 3. If Incomplete + BAT URL exists → Trigger       │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Self-Healing Service (New)                              │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 1. Check if enrichment needed                     │ │
│  │ 2. Verify VIN match (if VIN exists)              │ │
│  │ 3. Scrape BAT URL                                 │ │
│  │ 4. Fill only missing fields                       │ │
│  │ 5. Download images                                 │ │
│  │ 6. Update vehicle record                          │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Implementation Plan

#### Step 1: Create Self-Healing Service

**File**: `nuke_frontend/src/services/vehicleSelfHealingService.ts`

```typescript
export class VehicleSelfHealingService {
  /**
   * Check if vehicle needs enrichment
   */
  static async needsEnrichment(vehicleId: string): Promise<{
    needsEnrichment: boolean;
    missingFields: string[];
    hasBATUrl: boolean;
    imageCount: number;
  }> {
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('*, vehicle_images(id)')
      .eq('id', vehicleId)
      .single();

    if (!vehicle) {
      return { needsEnrichment: false, missingFields: [], hasBATUrl: false, imageCount: 0 };
    }

    const imageCount = vehicle.vehicle_images?.length || 0;
    const hasBATUrl = !!vehicle.bat_auction_url;
    
    const missingFields: string[] = [];
    if (!vehicle.engine_size) missingFields.push('engine_size');
    if (!vehicle.transmission) missingFields.push('transmission');
    if (!vehicle.mileage) missingFields.push('mileage');
    if (!vehicle.color) missingFields.push('color');
    if (imageCount === 0) missingFields.push('images');

    const needsEnrichment = hasBATUrl && (
      imageCount === 0 || 
      missingFields.length > 0
    );

    return { needsEnrichment, missingFields, hasBATUrl, imageCount };
  }

  /**
   * Enrich vehicle from BAT URL
   */
  static async enrichFromBAT(vehicleId: string, batUrl: string): Promise<{
    success: boolean;
    fieldsUpdated: string[];
    imagesAdded: number;
    error?: string;
  }> {
    try {
      // 1. Get current vehicle data
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('vin, year, make, model')
        .eq('id', vehicleId)
        .single();

      if (!vehicle) {
        throw new Error('Vehicle not found');
      }

      // 2. Scrape BAT listing
      const { data: scrapeResult, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
        body: { url: batUrl }
      });

      if (scrapeError || !scrapeResult?.success) {
        throw new Error(scrapeError?.message || 'Failed to scrape BAT listing');
      }

      const scrapedData = scrapeResult.data;

      // 3. VIN validation (strict - never mix data)
      if (vehicle.vin && scrapedData.vin) {
        if (vehicle.vin.toLowerCase() !== scrapedData.vin.toLowerCase()) {
          throw new Error(`VIN mismatch: vehicle has ${vehicle.vin}, BAT listing has ${scrapedData.vin}`);
        }
      }

      // 4. Build updates (only fill missing fields)
      const updates: any = {};
      const fieldsUpdated: string[] = [];

      if (!vehicle.year && scrapedData.year) {
        updates.year = scrapedData.year;
        fieldsUpdated.push('year');
      }
      if (!vehicle.make && scrapedData.make) {
        updates.make = scrapedData.make;
        fieldsUpdated.push('make');
      }
      if (!vehicle.model && scrapedData.model) {
        updates.model = scrapedData.model;
        fieldsUpdated.push('model');
      }
      if (scrapedData.mileage && !vehicle.mileage) {
        updates.mileage = scrapedData.mileage;
        fieldsUpdated.push('mileage');
      }
      if (scrapedData.engine_size) {
        updates.engine_size = scrapedData.engine_size;
        fieldsUpdated.push('engine_size');
      }
      if (scrapedData.transmission) {
        updates.transmission = scrapedData.transmission;
        fieldsUpdated.push('transmission');
      }
      if (scrapedData.color) {
        updates.color = scrapedData.color;
        fieldsUpdated.push('color');
      }

      // 5. Update vehicle (if any fields to update)
      if (Object.keys(updates).length > 0) {
        await supabase
          .from('vehicles')
          .update(updates)
          .eq('id', vehicleId);
      }

      // 6. Download images (if missing)
      let imagesAdded = 0;
      if (scrapedData.images && Array.isArray(scrapedData.images) && scrapedData.images.length > 0) {
        // Check current image count
        const { count: currentCount } = await supabase
          .from('vehicle_images')
          .select('*', { count: 'exact', head: true })
          .eq('vehicle_id', vehicleId);

        if (currentCount === 0) {
          // Download images via edge function or direct insert
          // (Implementation depends on image storage strategy)
          imagesAdded = scrapedData.images.length;
        }
      }

      return {
        success: true,
        fieldsUpdated,
        imagesAdded
      };

    } catch (error: any) {
      console.error('[SelfHealing] Error enriching vehicle:', error);
      return {
        success: false,
        fieldsUpdated: [],
        imagesAdded: 0,
        error: error.message
      };
    }
  }
}
```

#### Step 2: Integrate into VehicleProfile Component

**File**: `nuke_frontend/src/pages/VehicleProfile.tsx`

Add to `loadData()` function:

```typescript
// After loading vehicle data
if (veh && veh.bat_auction_url) {
  // Check if enrichment needed (non-blocking)
  VehicleSelfHealingService.needsEnrichment(vehicleId).then(async (check) => {
    if (check.needsEnrichment) {
      console.log('[VehicleProfile] Triggering self-healing for incomplete profile');
      // Trigger in background (don't block UI)
      VehicleSelfHealingService.enrichFromBAT(vehicleId, veh.bat_auction_url)
        .then((result) => {
          if (result.success) {
            console.log('[VehicleProfile] Self-healing complete:', result);
            // Reload data to show new fields/images
            loadData();
          } else {
            console.warn('[VehicleProfile] Self-healing failed:', result.error);
          }
        })
        .catch((err) => {
          console.error('[VehicleProfile] Self-healing error:', err);
        });
    }
  });
}
```

#### Step 3: Create Edge Function for Background Enrichment

**File**: `supabase/functions/enrich-vehicle-profile/index.ts`

```typescript
// Background job to enrich incomplete profiles
// Can be called via cron or manually
```

## Redundancy Prevention Checklist

✅ **Before Creating Vehicle:**
- [ ] Check VIN exists (if VIN provided)
- [ ] Check listing_url exists (if URL provided)
- [ ] If match found, UPDATE not CREATE

✅ **Before Enriching:**
- [ ] Verify VIN match (if both have VINs)
- [ ] Only fill NULL/empty fields
- [ ] Never overwrite user-entered data
- [ ] Log all enrichment actions

✅ **Before Scraping:**
- [ ] Check if already scraped recently (cache)
- [ ] Rate limit scraping (avoid hammering BAT)
- [ ] Validate URL format before scraping

## Testing Protocol

1. **Test Duplicate Prevention:**
   - Create vehicle with VIN
   - Try to create again with same VIN → should UPDATE
   - Try to create with same BAT URL → should UPDATE

2. **Test Self-Healing:**
   - Create empty profile with BAT URL
   - View profile → should trigger enrichment
   - Verify only missing fields filled
   - Verify images downloaded

3. **Test VIN Validation:**
   - Create vehicle with VIN "ABC123"
   - Try to enrich from BAT listing with VIN "XYZ789"
   - Should REJECT (VIN mismatch)

## Next Steps

1. ✅ Document current state (this file)
2. ⏳ Implement `VehicleSelfHealingService`
3. ⏳ Integrate into `VehicleProfile.tsx`
4. ⏳ Create background enrichment edge function
5. ⏳ Add monitoring/logging for enrichment actions
6. ⏳ Test with real BAT profiles

