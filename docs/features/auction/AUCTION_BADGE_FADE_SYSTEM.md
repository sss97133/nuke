# Auction Badge Fade System

## Overview

Auction badges now fade out after auctions end, especially for unsold vehicles. Instead of highlighting failed auctions, the system emphasizes:
- **Market Value** - Current estimated value of the vehicle
- **Owner Cost** - Total investment by the owner
- **Owner Identity** - Who owns the vehicle (more prominent)

This puts vehicles in a positive light as valuable assets, with auction results being just one data point rather than the defining characteristic.

## Behavior

### Fade Logic

1. **Unsold Auctions (RNM, Ended, No Sale)**
   - Badges fade completely after **1 day**
   - After fade, show market value or owner cost instead
   - No auction status shown

2. **Sold Auctions**
   - Badges fade gradually over **3 days** (1 day + 2 day fade)
   - Still show sold price if available
   - Less prominent than live auctions

3. **Live Auctions**
   - Full visibility and prominence
   - Real-time updates shown

### Display Priority

When auction has ended (> 1 day ago):

1. **Market Value** (if available)
   - From `current_value` or `asking_price`
   - Shows estimated worth of the asset

2. **Owner Cost** (if market value unavailable)
   - From `cost_basis` or `purchase_price`
   - Shows owner's investment

3. **Display Price** (fallback)
   - General price display

### Owner Information

Owner information is now more prominent:
- Owner name/username shown clearly
- Links to owner profile
- Emphasizes the person behind the asset

## Implementation

### Files Modified

1. **`AuctionBadges.tsx`**
   - Added `endedAt` and `fadeAfterDays` props
   - Calculates fade opacity based on days since end
   - Returns `null` when fully faded

2. **`VehicleCardDense.tsx`**
   - Checks if auction ended > 1 day ago
   - Switches from auction status to asset value
   - Fades badge opacity for unsold auctions
   - Shows market value or owner cost

3. **`VehicleHeader.tsx`**
   - Fades auction badges after end date
   - Completely hides unsold auction badges after 1 day
   - Gradually fades sold auction badges

## User Experience

### Before
- Failed auctions prominently displayed "RNM" or "ENDED"
- Made vehicles look like failures
- Auction status was the primary identifier

### After
- Failed auctions fade away after 1 day
- Vehicles shown as valuable assets
- Market value and owner investment emphasized
- Auction is just one data point, not the defining feature

## Example

### Unsold Auction (Day 0)
```
[RNM] $25,000
```

### Unsold Auction (Day 1+)
```
$45,000  ← Market Value
by @owner_name
```

### Sold Auction (Day 0)
```
[SOLD] $50,000
```

### Sold Auction (Day 3+)
```
$50,000  ← Faded, less prominent
by @owner_name
```

## Configuration

Fade timing can be adjusted:
- `fadeAfterDays` prop in `AuctionStatusBadge` (default: 1 day)
- Hardcoded in `VehicleCardDense` (1 day for unsold, 3 days for sold)

## Future Enhancements

1. **Market Value Calculation**
   - Better algorithms for estimating value
   - Consider condition, mileage, modifications
   - Compare to similar vehicles

2. **Owner Investment Tracking**
   - Sum of all receipts and costs
   - Labor hours and owner operator value
   - Total time investment

3. **Asset Context**
   - Show vehicle as part of owner's collection
   - Highlight build quality and documentation
   - Emphasize uniqueness and story

---

The system now treats vehicles as valuable assets first, with auction results as contextual data rather than primary identifiers.

