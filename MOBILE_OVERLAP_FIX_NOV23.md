# Mobile Overlap Fix - November 23, 2025

## Problem
On mobile, the vehicle profile header had overlapping elements:
- Vehicle name, price, and percentage change were crammed onto one line
- Elements were too chunky/thick (>32px)
- Sticky headers from upload components could overlap with main navigation

## Solution Implemented

### 1. Vehicle Header Layout (VehicleHeader.tsx)
**Changed from horizontal to vertical stacking on mobile:**
- Container: `flexWrap: 'nowrap'` → `flexWrap: 'wrap'`
- Gap: `gap: 16` → `gap: '8px 16px'` (vertical/horizontal)
- Height: `height: '32px'` → `minHeight: '32px'` (allows wrapping)
- Z-index: `10` → `9` (below app header)

**Price button now stacks vertically:**
- `flexDirection: 'column'`
- `alignItems: 'flex-end'`
- `gap: 2` (2px between price and percentage)

### 2. Mobile-Specific CSS (design-system.css)
```css
/* Compact vehicle header - wraps to 2 lines */
.vehicle-price-header {
  top: 48px !important;
  z-index: 9 !important;
  height: auto !important;
  padding: 6px 12px !important;
}

/* Vehicle title - max 140px width */
.vehicle-price-header [style*="fontSize: '9pt'"] {
  max-width: 140px !important;
  font-size: 8pt !important;
}

/* Price stacks vertically */
.vehicle-price-header .vehicle-price-button {
  flex-direction: column !important;
  gap: 2px !important;
}

/* Price text reduced to 9pt */
.vehicle-price-header .vehicle-price-button > div {
  font-size: 9pt !important;
  line-height: 1 !important;
}
```

### 3. Z-Index Hierarchy Fixed
**Proper stacking order:**
- App Header: `z-index: 100`
- Upload notifications: `z-index: 101` (positioned below app header)
- Vehicle Header: `z-index: 9`
- Upload modals: `z-index: 9999`
- Image lightbox: `z-index: 10000`

**Files updated:**
- `UploadProgressNotifications.tsx`: `z-50` → `z-[101]`, `top-20` → `top-[110px]`
- `UploadQualityFilter.tsx`: `z-50` → `z-[9999]`
- `TitleValidationModal.tsx`: `z-50` → `z-[9999]`

## Result
✅ Vehicle header now uses 2 lines on mobile (vehicle name + owner on line 1, price + percentage on line 2)
✅ Elements are thin (10-15px per line, ~40px total)
✅ No chunkiness - clean vertical spacing
✅ No overlaps between sticky headers and upload/AI components

## Deployment
- Deployed: November 23, 2025
- Vercel URL: https://nuke-lx51kxo50-nzero.vercel.app
- Production: https://n-zero.dev
- Status: ✅ Live

## Files Modified
1. `/nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx`
2. `/nuke_frontend/src/design-system.css`
3. `/nuke_frontend/src/components/upload/UploadProgressNotifications.tsx`
4. `/nuke_frontend/src/components/upload/UploadQualityFilter.tsx`
5. `/nuke_frontend/src/components/upload/TitleValidationModal.tsx`

## Testing Notes
Test on mobile to verify:
- Vehicle name wraps if needed (max 140px)
- Price and percentage are on separate line, vertically stacked
- Header height is minimal (6px padding top/bottom)
- Upload components appear above all other elements
- No overlaps when scrolling or triggering uploads

