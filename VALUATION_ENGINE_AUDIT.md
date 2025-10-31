# Truth-Based Valuation Engine - Audit & Test Plan

## ✅ DEPLOYED TO PRODUCTION
**URL:** https://n-zero.dev

## What Changed

### OLD Valuation Logic (BROKEN):
```typescript
// Blended market comps with investments
estimatedValue = (totalInvested * 0.6) + (marketValue * 0.4);

// Problem: If you bought for $75k and market says $50k, 
// it estimates $60k → YOU LOSE $15K INSTANTLY! ❌
```

### NEW Valuation Logic (TRUTH-BASED):
```typescript
// Purchase price establishes FLOOR
estimatedValue = purchasePrice + documentedInvestments;

// Example: Bought for $75k, added $15k in parts/labor
// Estimated value = $90k ✅
// Market reference shown for context, NOT used as ceiling
```

## Core Principles

1. **Purchase Price = Floor**
   - You can't lose money instantly unless evidence of damage/depreciation
   - What you paid is what it's worth AT MINIMUM
   
2. **Documented Investments Add Value**
   - Every receipt adds to estimated value
   - Every documented labor hour adds value
   - Photos prove the work was done
   
3. **Market is Reference, Not Override**
   - Market comps shown for context
   - Position: "Above market" / "At market" / "Below market"
   - But doesn't artificially reduce your investment value
   
4. **Visual Evidence Answers WHY**
   - Each line item shows photos
   - Click to expand and see proof
   - Documentation score shows evidence quality

## New UI Component: VisualValuationBreakdown

### What It Shows:

```
Purchase Price:              $75,000
+ Documented Investments:    $15,000
  (5 receipts/work sessions with 48 photos)
= Estimated Value:           $90,000

Market Reference:            $50,000
Position:                    ↑ Above Market

Documentation:               85%
Confidence:                  95%
```

### Investment Timeline (Expandable):

Each line item shows:
- **Category**: Engine, Suspension, Interior, etc.
- **Description**: Vendor name or work performed
- **Date**: When work was done
- **Evidence**: Photo count (green = well documented)
- **Amount**: Dollar value
- **Click to expand**: See all photos for that investment

### Example Line Items:

```
[Engine] 
Advance Auto Parts               Oct 15, 2024   [12 photos]  $4,500
  Photos show: Intake manifold, headers, gaskets installed

[Suspension]
KW Coilover Kit                  Oct 20, 2024   [8 photos]   $2,800
  Photos show: Old suspension removed, new coilovers installed

[Labor]
Front suspension installation    Oct 21, 2024   [15 photos]  $600
  8 hours @ $75/hr with full photo documentation
```

## Warnings & Flags

System automatically detects:

### ⚠️ Overpaid
- Triggers if purchase price >30% above market
- "Purchase price ($75k) was 50% above market"
- Helps understand if you need to invest more to justify purchase

### ⚠️ Underinvested  
- Triggers if market suggests more work needed
- "Market suggests vehicle needs more work to reach full value"

### ⚠️ Poor Documentation
- Triggers if <50% of investments have photo evidence
- "Less than half of investments have photo evidence"

### ⚠️ Value at Risk
- Triggers if damage detected in photos
- "Damage detected in photos - may affect value"

## Test Plan

### Test 1: Basic Valuation (Your Bronco)

1. Go to: `https://n-zero.dev/vehicle/eea40748-cdc1-4ae9-ade1-4431d14a7726`
2. Scroll to "Valuation Breakdown" card
3. **Check numbers:**
   - Purchase Price: Should show $75,000
   - Documented Investments: Sum of all receipts
   - Estimated Value: Purchase + Investments
4. **Check market position:**
   - Should show market reference
   - Position: Above/At/Below market
5. **Check line items:**
   - Each receipt should be a line item
   - Click to expand and see photos
   - Photo count should be accurate

### Test 2: Documentation Score

1. Look at documentation quality bar
2. Should show: `[imagesLinkedToReceipts / totalImages] * 100`
3. If you have receipts but no photos → Low score, warning
4. If you have photos linked to receipts → High score, green

### Test 3: Warnings

1. **Try overpaying test:**
   - Create new vehicle
   - Set purchase price = $100k
   - Market reference = $50k
   - Should warn: "Purchase price was 100% above market"

2. **Try poor docs test:**
   - Add receipts totaling $10k
   - Add only 2 photos
   - Should warn: "Less than half of investments have photo evidence"

## What to Look For

### ✅ Good Signs:
- Purchase price always establishes floor
- Adding receipts increases estimated value
- Photos are grouped by investment
- Warnings help identify issues
- No negative equity scenarios

### ❌ Red Flags:
- Estimated value < purchase price (unless damage flagged)
- Market comps overriding investment logic
- Photos not linking to receipts
- Confidence score always low

## Tuning Parameters

If valuations seem off, adjust these:

### Labor Rate
```typescript
const rate = event.metadata?.labor_rate || 75; // $75/hr shop rate
```
- Professional shops: $100-150/hr
- Home garage: $50-75/hr
- Adjust based on actual market

### Documentation Thresholds
```typescript
const expectedImages = cat.totalValue > 5000 ? 10 : 
                      cat.totalValue > 1000 ? 5 : 3;
```
- $5k+ investment → expect 10 photos
- $1k-5k → expect 5 photos
- <$1k → expect 3 photos

### Market Position Thresholds
```typescript
if (diffPct > 20) marketPosition = 'above';    // >20% above market
if (diffPct < -20) marketPosition = 'below';   // >20% below market
```

## Next Steps After Initial Test

1. **Tune based on real data** - Does $75k + $15k = $90k make sense for Bronco?
2. **Add AI photo analysis** - Automatically link photos to receipts by date/content
3. **Add damage detection** - If rust/damage visible, flag value at risk
4. **Depreciation logic** - Handle cases where value SHOULD decrease
5. **Market integration** - Better market comp data (currently uses MarketCheck API)

## Files Created

- `/nuke_frontend/src/services/valuationEngine.ts` - Core calculation logic
- `/nuke_frontend/src/components/vehicle/VisualValuationBreakdown.tsx` - UI display
- Integrated into `VehicleProfile.tsx`

---

**Ready to test on your Bronco!** Hard refresh (Cmd+Shift+R) to see new valuation breakdown. 🚗

