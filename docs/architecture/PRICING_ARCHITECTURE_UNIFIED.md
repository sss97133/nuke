# Unified Pricing Architecture

## Problem: Multiple Pricing Sources Creating Conflicts

**User Report:** Vehicle `3f1791fe-4fe2-4994-b6fe-b137ffa57370` shows $11,888 initially, then flickers to $155k (should be $63k actual sale price).

**Root Cause:** Multiple pricing calculation systems running independently:
1. `pricingService.ts` - `getSmartPrice()` 
2. `priceSignalService.ts` - `computePrimaryPrice()` + RPC `vehicle_price_signal`
3. `vehicleValuationService.ts` - `VehicleValuationService.calculateValuation()`
4. `VisualValuationBreakdown.tsx` - Expert valuations + legacy engine
5. `VehicleHeader.tsx` - Direct database fields + computed values

**Result:** Race conditions, flickering prices, conflicting displays

## Database State (Vehicle 3f1791fe...)
```sql
sale_price: 63000        -- ✅ TRUTH (actual BAT sale)
purchase_price: 25000    -- Historical
current_value: 63000     -- Estimate (matches sale)
asking_price: NULL
bat_sold_price: NULL
total_invested: NULL
```

**Expected Display:** $63,000 (Sold Price)  
**Actual Display:** $11,888 → $155,000 → flicker

## Pricing Truth Hierarchy (Single Source of Truth)

```
1. SALE_PRICE (Actual)        - "Sold for $X"     [HIGHEST TRUTH]
2. ASKING_PRICE (Intent)       - "Asking $X"
3. MARKET_LISTING (Signal)     - "Listed at $X"  
4. CURRENT_VALUE (Estimate)    - "Estimated at $X"
5. PURCHASE_PRICE (Historical) - "Purchased for $X" [LOWEST TRUTH]
```

**Rule:** Display ONLY the highest available price from this hierarchy.

## Unified Pricing Service (Single Entry Point)

### New Architecture

```typescript
// nuke_frontend/src/services/unifiedPricingService.ts

export interface UnifiedPrice {
  displayValue: number;
  displayLabel: string;
  source: 'sale_price' | 'asking_price' | 'market_listing' | 'current_value' | 'purchase_price';
  confidence: 'verified' | 'high' | 'medium' | 'low';
  lastUpdated: string;
  metadata?: {
    platform?: string;
    url?: string;
    verifiedBy?: string;
  };
}

/**
 * SINGLE SOURCE OF TRUTH for vehicle pricing
 * All components MUST use this service
 */
export class UnifiedPricingService {
  /**
   * Get display price for vehicle (respects truth hierarchy)
   */
  static async getDisplayPrice(vehicleId: string): Promise<UnifiedPrice> {
    // 1. Fetch vehicle data ONCE
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('sale_price, asking_price, current_value, purchase_price, bat_auction_url')
      .eq('id', vehicleId)
      .single();

    if (!vehicle) {
      throw new Error('Vehicle not found');
    }

    // 2. Apply truth hierarchy (highest wins)
    if (vehicle.sale_price && vehicle.sale_price > 0) {
      return {
        displayValue: vehicle.sale_price,
        displayLabel: 'Sold for',
        source: 'sale_price',
        confidence: 'verified',
        lastUpdated: new Date().toISOString()
      };
    }

    if (vehicle.asking_price && vehicle.asking_price > 0) {
      return {
        displayValue: vehicle.asking_price,
        displayLabel: 'Asking',
        source: 'asking_price',
        confidence: 'high',
        lastUpdated: new Date().toISOString()
      };
    }

    if (vehicle.current_value && vehicle.current_value > 0) {
      return {
        displayValue: vehicle.current_value,
        displayLabel: 'Estimated at',
        source: 'current_value',
        confidence: 'medium',
        lastUpdated: new Date().toISOString()
      };
    }

    if (vehicle.purchase_price && vehicle.purchase_price > 0) {
      return {
        displayValue: vehicle.purchase_price,
        displayLabel: 'Purchased for',
        source: 'purchase_price',
        confidence: 'low',
        lastUpdated: new Date().toISOString()
      };
    }

    // No price available
    throw new Error('No price data available');
  }

  /**
   * Format price for display
   */
  static formatPrice(price: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price);
  }

  /**
   * Get full price display with label
   */
  static async getFormattedDisplay(vehicleId: string): Promise<string> {
    try {
      const price = await this.getDisplayPrice(vehicleId);
      return `${price.displayLabel} ${this.formatPrice(price.displayValue)}`;
    } catch (error) {
      return 'Price unavailable';
    }
  }
}
```

## Migration Plan

### Phase 1: Create Unified Service (1 hour)
1. ✅ Create `unifiedPricingService.ts`
2. ✅ Implement `getDisplayPrice()` with truth hierarchy
3. ✅ Add formatters and helpers

### Phase 2: Replace All Pricing Calls (2-3 hours)
**Files to Update:**
1. `VehicleHeader.tsx` - Replace `computePrimaryPrice()` + `rpcSignal`
2. `VisualValuationBreakdown.tsx` - Use unified service for display price
3. `VehicleBasicInfo.tsx` - Use unified service
4. `VehiclePricingWidget.tsx` - Use unified service
5. `AllVehicles.tsx` - Use unified service for cards
6. `VehicleCardDense.tsx` - Use unified service

**Pattern:**
```typescript
// OLD (multiple sources)
const price = rpcSignal?.primary_value || vehicle.sale_price || vehicle.current_value;

// NEW (single source)
import { UnifiedPricingService } from '../services/unifiedPricingService';
const price = await UnifiedPricingService.getDisplayPrice(vehicleId);
```

### Phase 3: Deprecate Old Services (1 hour)
1. Mark `pricingService.ts` as deprecated
2. Mark `priceSignalService.ts` RPC calls as deprecated
3. Keep `vehicleValuationService.ts` for BREAKDOWNS only (not display)

### Phase 4: Testing (1 hour)
1. Test vehicle `3f1791fe-4fe2-4994-b6fe-b137ffa57370`
2. Verify $63,000 displays correctly
3. No flickering
4. Check all vehicle cards

## Rules for All Developers

### ✅ DO:
- **Always** use `UnifiedPricingService.getDisplayPrice()`
- Display ONLY one price per vehicle
- Show price source/label for transparency
- Cache pricing data when loading lists

### ❌ DON'T:
- Create new pricing calculation logic
- Query vehicle prices directly from components
- Show multiple conflicting prices
- Use `current_value` if `sale_price` exists
- Calculate prices on the fly

## Example: VehicleHeader.tsx (Before/After)

### Before (Multiple Sources - BAD)
```typescript
const [rpcSignal, setRpcSignal] = useState<any | null>(null);
const [valuation, setValuation] = useState<any | null>(null);

// Load from RPC
useEffect(() => {
  supabase.rpc('vehicle_price_signal', { vehicle_ids: [vehicleId] })
    .then(({ data }) => setRpcSignal(data[0]));
}, [vehicleId]);

// Load from valuation service
useEffect(() => {
  VehicleValuationService.calculateValuation(vehicleId)
    .then(setValuation);
}, [vehicleId]);

// Compute display (race condition!)
const displayValue = valuation?.estimatedValue || rpcSignal?.primary_value || vehicle.sale_price;
```

### After (Single Source - GOOD)
```typescript
import { UnifiedPricingService } from '../../services/unifiedPricingService';

const [price, setPrice] = useState<UnifiedPrice | null>(null);

// Load ONCE
useEffect(() => {
  UnifiedPricingService.getDisplayPrice(vehicleId)
    .then(setPrice)
    .catch(console.error);
}, [vehicleId]);

// Display (no race condition)
const displayValue = price?.displayValue || null;
const displayLabel = price?.displayLabel || '';
```

## What About Valuations?

**Valuations (VisualValuationBreakdown) are DIFFERENT from Display Price:**
- **Display Price:** Single number shown in header/cards (what it sold/listed for)
- **Valuation:** Breakdown showing WHY it's worth X (components, condition, market)

**Valuation Service** can still exist for breakdowns, but MUST use unified price as starting point:
```typescript
// Valuation should START with unified price
const displayPrice = await UnifiedPricingService.getDisplayPrice(vehicleId);
const breakdown = await VehicleValuationService.breakdownValue(vehicleId, displayPrice);
```

## Database Schema (No Changes Needed)

Current schema is fine:
```sql
vehicles (
  sale_price DECIMAL,        -- Actual sale price (highest truth)
  asking_price DECIMAL,      -- Owner's asking price
  current_value DECIMAL,     -- Estimated value
  purchase_price DECIMAL,    -- Historical purchase price
  bat_sold_price DECIMAL     -- Legacy (merge into sale_price)
)
```

**Cleanup Task:** Merge `bat_sold_price` into `sale_price` for consistency.

## Timeline

- **Phase 1:** Create unified service - 1 hour
- **Phase 2:** Replace all pricing calls - 2-3 hours
- **Phase 3:** Deprecate old services - 1 hour
- **Phase 4:** Testing - 1 hour

**Total:** 5-6 hours to complete unification

## Success Criteria

✅ No price flickering on page load  
✅ Same price displayed across all components  
✅ Clear price source/label shown  
✅ $63,000 displays correctly for vehicle `3f1791fe-4fe2-4994-b6fe-b137ffa57370`  
✅ All cards show consistent pricing  
✅ No console errors about price conflicts

