# 🐛 Hood Panel Bug - FIXED

**Issue:** "same hood panel shit pops up on every single image"  
**Root Cause:** Hardcoded fallback in on-demand part identification

---

## The Problem

### What was happening:
1. User clicks ANYWHERE on image
2. `handleImageClick` fires
3. Calls Edge Function `identify-part-at-click`
4. AI tries to identify part at clicked coordinates
5. Catalog is empty (no real parts data)
6. Falls back to `getGenericPricing()` function
7. Generates fake data:
   ```typescript
   oem_part_number: `GENERIC-${partName.replace(/\s+/g, '-').toUpperCase()}`
   // Results in: GENERIC-HOOD-PANEL, GENERIC-FRONT-FENDER, etc.
   ```
8. Returns random prices from hardcoded estimates
9. Popup shows this fake data

### Why it appeared on every image:
- `onClick={handleImageClick}` was bound to entire image container
- ANY click triggered AI identification
- Even clicking existing dots triggered it
- Result: Fake "Hood Panel" everywhere

---

## The Fix

### Changes Made:

**1. Disabled on-demand part ID (Line 376-415)**
```typescript
// DISABLED: On-demand part ID creates too many fake tags
// Only use existing tagged dots - user can press T to manually tag
// TODO: Re-enable when catalog is populated with real parts
```

**2. Removed onClick from image (Line 773)**
```typescript
// Before:
cursor: 'pointer'
onClick={handleImageClick}  // Fired on every click!

// After:
cursor: isTagging ? 'crosshair' : 'default'
onClick={isTagging ? handleImageClick : undefined}  // Only in tagging mode
```

---

## Current Behavior

### Image clicks now:
- **Normal mode:** Click does nothing (clean!)
- **Tagging mode (Press T):** Click/drag creates new tag
- **Existing dots:** Click dot → popup shows REAL data from database

### No more fake data:
- ❌ No more "GENERIC-HOOD-PANEL"
- ❌ No more random pricing
- ❌ No popups on empty areas
- ✅ Only show popups for REAL tagged parts

---

## TODO: Real Catalog Integration

To re-enable smart part identification:
1. Populate `part_catalog` table with LMC Truck data
2. Update `getCatalogPartsForSystem()` to return real matches
3. Re-enable `handleImageClick` with catalog lookup first
4. Only fall back to generic if catalog search returns 0 results

---

**Status:** FIXED - No more fake hood panels everywhere!

