# Unified Pricing Architecture

## Problem Solved (Oct 31, 2025)

Previously, the Nuke platform had **three disconnected pricing systems**:

1. **VehicleHeader** (top display): Read from `vehicles.current_value` or RPC signal
2. **VisualValuationBreakdown** (detailed breakdown): Read from `vehicle_valuations` table
3. **Legacy `current_value`**: Stale, manually-set value not synchronized with AI analysis

This caused confusion where the header might show **$40,000** while the detailed breakdown showed **$75,900**.

## Solution: Expert Agent as Single Source of Truth

The `vehicle-expert-agent` Edge Function now serves as the **single source of truth** for all vehicle valuations. When it runs:

### 1. Analyzes Vehicle Data (4-Step Pipeline)
```typescript
STEP 1: Research Vehicle Y/M/M → Context (common issues, market sales, specs)
STEP 2: Assess Images → Documented components with evidence & value
STEP 3: Environmental Data → 5 W's (Who, What, When, Where, Why)
STEP 4: Generate Valuation → Purchase floor + documented investments
```

### 2. Saves to `vehicle_valuations` Table
```sql
{
  vehicle_id: uuid,
  estimated_value: numeric,           -- Total value
  documented_components: numeric,      -- Sum of parts/upgrades
  confidence_score: integer,           -- 0-100
  components: jsonb,                   -- Detailed breakdown
  environmental_context: jsonb,        -- Work environment, timeline
  value_justification: text,           -- Human-readable WHY
  valuation_date: timestamptz
}
```

### 3. **CRITICAL**: Updates `vehicles.current_value`
```typescript
// This unifies ALL pricing displays across the platform
await supabase
  .from('vehicles')
  .update({ 
    current_value: valuation.estimatedTotalValue,
    updated_at: new Date().toISOString()
  })
  .eq('id', vehicleId);
```

## How It Works

### Automatic Triggers
The expert agent runs automatically when:
- ✅ **Owner/verified owner views vehicle** (if valuation is stale >24h or missing)
- ✅ **New images are uploaded** (via `ImageGallery.handleImportComplete`)
- ❌ Manual "Run Analysis" button removed (per user request)

### Data Flow
```
[Image Upload] → [Timeline Event Created] 
                ↓
        [Expert Agent Triggered]
                ↓
        [Analyzes 160+ photos]
                ↓
        [Generates Valuation: $75,900]
                ↓
    ┌───────────┴───────────┐
    ↓                       ↓
[vehicle_valuations]   [vehicles.current_value = $75,900]
                            ↓
        ┌───────────────────┼───────────────────┐
        ↓                   ↓                   ↓
[VehicleHeader]    [VisualValuation]    [Homepage Cards]
   $75,900            $75,900               $75,900
```

## Valuation Logic: Purchase Price Floor

The expert agent implements **purchase-price-floor** logic:

```typescript
estimatedValue = purchasePrice + documentedInvestments

Where:
- purchasePrice = What you paid (floor, never goes below this)
- documentedInvestments = Sum of receipts + visible upgrades in photos
- marketReference = Comparables (for reference only, not a ceiling)
```

### Example (1974 Ford Bronco)
```
Purchase Price:        $75,000  (floor)
+ Master Cylinder:        $100  (visible in photos)
+ Fuel Tank:              $200  (visible in photos)
+ Front Grille:           $150  (visible in photos)
+ Dana 44 Axle:           $450  (visible in photos)
─────────────────────────────────
Estimated Value:       $75,900
```

## Display Modes

The `VehicleHeader` supports multiple display modes (controlled by dropdown):

- **Auto** (default): Intelligently picks best value to show
  - Auction → Current Bid
  - For Sale → Asking Price
  - Sold → Sale Price
  - Otherwise → Estimated Value (from expert agent)
- **Estimate**: Always show expert agent valuation
- **Auction**: Current bid (if auction)
- **Asking**: Asking price (if for sale)
- **Sale**: Final sale price (if sold)
- **Purchase**: Original purchase price
- **MSRP**: Original manufacturer's suggested retail price

## Benefits

1. **Single Source of Truth**: Expert agent is the canonical pricing authority
2. **Always Current**: Automatic updates when images are uploaded
3. **Visually Grounded**: Values are justified by photographic evidence
4. **Transparent**: Users see exactly WHY the value is what it is
5. **Purchase Floor**: Protects against unrealistic depreciation
6. **No Manual Sync**: All displays automatically reflect latest valuation

## Files Modified

- `supabase/functions/vehicle-expert-agent/index.ts` (line 587-594)
- `nuke_frontend/src/pages/VehicleProfile.tsx` (automatic trigger on image upload)
- `nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx` (reads current_value)
- `nuke_frontend/src/components/vehicle/VisualValuationBreakdown.tsx` (reads vehicle_valuations)

## Testing

```bash
# 1. Trigger expert agent
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/vehicle-expert-agent \
  -H "Authorization: Bearer [SERVICE_ROLE_KEY]" \
  -H "Content-Type: application/json" \
  -d '{"vehicleId":"eea40748-cdc1-4ae9-ade1-4431d14a7726"}'

# 2. Verify vehicles.current_value updated
curl "https://qkgaybvrernstplzjaam.supabase.co/rest/v1/vehicles?id=eq.eea40748-cdc1-4ae9-ade1-4431d14a7726&select=current_value" \
  -H "apikey: [ANON_KEY]"
# Expected: [{"current_value":75900.00}]

# 3. Check valuation record
curl "https://qkgaybvrernstplzjaam.supabase.co/rest/v1/vehicle_valuations?vehicle_id=eq.eea40748-cdc1-4ae9-ade1-4431d14a7726&select=estimated_value&order=valuation_date.desc&limit=1" \
  -H "apikey: [ANON_KEY]"
# Expected: [{"estimated_value":75900}]
```

## Future Enhancements

- [ ] Add valuation history chart (track value changes over time)
- [ ] Compare valuation to market comps (when available)
- [ ] Show confidence breakdown (receipt coverage, photo coverage, etc.)
- [ ] Alert owners when value increases significantly
- [ ] Export valuation report as PDF for insurance/loans

---

**Status**: ✅ Deployed Oct 31, 2025  
**Verified**: Bronco (eea40748) showing $75,900 across all displays

