# 🧪 FUNCTIONAL TESTING GUIDE - WITH SCREENSHOTS

**Date:** October 25, 2025  
**Environments:** Local (http://localhost:5173) + Production (https://n-zero.dev)

---

## 🎯 **TEST SCENARIOS:**

### **TEST 1: Homepage - Vehicle List**

**What to Test:**
1. Navigate to homepage
2. Check if vehicle thumbnails load
3. Verify list view shows accurate data
4. Test view mode switches (list, grid, gallery)
5. Test sorting (price, date, make, year)

**Expected Results:**
- ✅ 18 vehicles displayed
- ✅ Some thumbnails visible
- ✅ Data accurate (Y/M/M, uploader, image count, value)
- ✅ View modes work
- ✅ Sorting works

**Screenshot Checkpoints:**
```
screenshot-1-homepage-list.png
screenshot-2-homepage-grid.png
screenshot-3-homepage-gallery.png
```

---

### **TEST 2: Vehicle Profile Page**

**URL:** `/vehicle/a90c008a-3379-41d8-9eb2-b4eda365d74c` (1983 GMC C1500)

**What to Test:**
1. Navigate to GMC truck profile
2. Check if vehicle info displays
3. Check if images load
4. Verify timeline shows events
5. Check for any errors in console

**Expected Results:**
- ✅ Vehicle info displays
- ✅ Some images visible (254 total)
- ✅ Timeline shows 115 events
- ✅ No critical errors

**Screenshot Checkpoints:**
```
screenshot-4-profile-page.png
screenshot-5-profile-scrolled.png
```

---

### **TEST 3: Lightbox & Spatial Tags (CRITICAL)**

**What to Test:**
1. Click on blue GMC truck image
2. Check if lightbox opens
3. Look for console debug output: "🔍 TAG DEBUG:"
4. Check for green dots on image
5. Try clicking a green dot
6. Check if spatial popup appears

**Expected Console Output:**
```javascript
🔍 TAG DEBUG: {
  totalTags: 3,
  tagView: "all",
  visibleTags: 3,
  spatialTags: 3,
  sampleTag: {
    id: "115a2312-ad38-490c-9c4f-b0c559c510d2",
    name: "Front Bumper Assembly",
    verified: true,
    coords: {x: 50, y: 85},
    isShoppable: true
  }
}
```

**Expected Visual Results:**
- ✅ Lightbox opens full-screen
- ✅ Image loads
- ✅ 3 green dots visible:
  - Bumper (center-bottom, x:50%, y:85%)
  - Headlight (left-center, x:25%, y:60%)
  - Grille (center, x:50%, y:65%)

**Screenshot Checkpoints:**
```
screenshot-6-lightbox-opened.png
screenshot-7-lightbox-with-green-dots.png
screenshot-8-console-debug-output.png
```

**Debug Analysis:**

**If totalTags = 0:**
```
Problem: Tags not loading from database
Fix: Check useImageTags hook
File: nuke_frontend/src/hooks/useImageTags.ts
```

**If visibleTags = 0:**
```
Problem: Filter hiding all tags
Fix: Check filter logic or tagView state
File: nuke_frontend/src/components/image/ImageLightbox.tsx:336
Current filter logic:
- 'off' → show nothing
- 'ai' → show unverified (verified === false)
- 'manual' → show verified (verified === true)
- 'all' → show all
All our tags have verified: true, so 'manual' or 'all' should work
```

**If spatialTags = 0:**
```
Problem: Tags missing coordinates
Fix: Check database - but we verified coordinates exist
Very unlikely - database shows all tags have x/y positions
```

**If all numbers correct but no visual dots:**
```
Problem: SpatialTagMarker not rendering
Fix: Check component for errors
File: nuke_frontend/src/components/image/ImageLightbox.tsx:95
Possible issues:
- CSS hiding dots (opacity, display, z-index)
- Component throwing error
- Coordinate calculation broken
```

---

### **TEST 4: Spatial Popup (IF dots appear)**

**What to Test:**
1. Hover over green dot
2. Check if tooltip shows part name + price
3. Click on green dot
4. Check if spatial popup appears
5. Verify suppliers listed
6. Check sorting (cheapest first)

**Expected Results:**
- ✅ Tooltip shows: "Front Bumper Assembly $67.50-$102.99"
- ✅ Popup appears at dot location
- ✅ Shows 3 suppliers:
  - RockAuto: $67.50 (cheapest) ⭐
  - LMC Truck: $89.99
  - Amazon: $102.99
- ✅ Stock status visible
- ✅ Shipping days visible

**Screenshot Checkpoints:**
```
screenshot-9-tooltip-hover.png
screenshot-10-spatial-popup-open.png
screenshot-11-suppliers-list.png
```

---

### **TEST 5: Checkout Flow (IF popup works)**

**What to Test:**
1. Double-click cheapest supplier (RockAuto)
2. Check if checkout modal opens
3. Verify part details display
4. Check for Stripe integration

**Expected Results:**
- ✅ Checkout modal opens
- ✅ Shows: Front Bumper Assembly
- ✅ Price: $67.50
- ✅ Supplier: RockAuto
- ✅ Shipping: 5 days

**Screenshot Checkpoints:**
```
screenshot-12-checkout-modal.png
```

---

### **TEST 6: Part Enrichment (IF logged in)**

**What to Test:**
1. Click "Enrich Part" button
2. Check if enrichment modal opens
3. Verify can add part numbers
4. Test supplier link addition

**Expected Results:**
- ✅ Modal opens
- ✅ Can edit part details
- ✅ Can add supplier links
- ✅ Changes save to database

**Screenshot Checkpoints:**
```
screenshot-13-enrichment-modal.png
```

---

## 🔍 **CONSOLE DEBUG CHECKLIST:**

### **Open Browser Console:**
```
1. Right-click anywhere on page
2. Click "Inspect" or "Inspect Element"
3. Click "Console" tab
4. Clear console (Cmd+K or Ctrl+L)
```

### **What to Look For:**

**✅ Good Signs:**
```
✅ Loaded 3 tags for image 59fec501...
🔍 TAG DEBUG: { totalTags: 3, visibleTags: 3 ... }
```

**❌ Bad Signs:**
```
❌ Error: ShoppablePartTag is not defined
❌ Error: handleBuyPart is not defined
❌ ReferenceError: ...
❌ TypeError: Cannot read property ...
```

**📊 Debug Output to Capture:**
```javascript
// Look for this exact output:
🔍 TAG DEBUG: {
  totalTags: ?,        // Should be 3
  tagView: ?,          // Should be 'all'
  visibleTags: ?,      // Should be 3
  spatialTags: ?,      // Should be 3
  sampleTag: {...}     // Should show full tag data
}
```

---

## 📸 **SCREENSHOT INSTRUCTIONS:**

### **macOS:**
```bash
# Full screen
Cmd + Shift + 3

# Selected area
Cmd + Shift + 4

# Window
Cmd + Shift + 4, then Spacebar, then click window
```

### **Save screenshots as:**
```
test-1-homepage.png
test-2-profile-page.png
test-3-lightbox-opened.png
test-4-console-debug.png
test-5-green-dots.png
test-6-spatial-popup.png
test-7-checkout-modal.png
```

---

## 🚀 **QUICK TEST SCRIPT:**

### **Automated Test Commands:**
```bash
# Test local dev
curl -I http://localhost:5173

# Test production
curl -I https://n-zero.dev

# Test specific vehicle profile
curl -I https://n-zero.dev/vehicle/a90c008a-3379-41d8-9eb2-b4eda365d74c

# Check Vercel deployment status
vercel ls

# Check latest build
vercel logs https://nuke-gaau0n1d8-nzero.vercel.app --follow
```

---

## ✅ **TESTING CHECKLIST:**

### **Phase 1: Basic Functionality**
- [ ] Homepage loads
- [ ] Vehicle list displays
- [ ] Vehicle cards show data
- [ ] Navigation works
- [ ] Profile page loads

### **Phase 2: Image System**
- [ ] Images display on profile
- [ ] Click image → lightbox opens
- [ ] Lightbox shows full-screen image
- [ ] Navigation buttons work (prev/next)
- [ ] Close button works

### **Phase 3: Spatial Tags (CRITICAL)**
- [ ] Console shows "✅ Loaded 3 tags"
- [ ] Console shows "🔍 TAG DEBUG" with correct numbers
- [ ] Green dots visible on image
- [ ] Hover → tooltip shows part + price
- [ ] Click dot → spatial popup opens

### **Phase 4: Shopping Flow**
- [ ] Popup shows suppliers
- [ ] Suppliers sorted by price
- [ ] Stock status visible
- [ ] Shipping info visible
- [ ] Double-click → checkout modal

### **Phase 5: Complete Workflow**
- [ ] Checkout modal displays
- [ ] Part details correct
- [ ] Stripe integration ready
- [ ] Can complete purchase

---

## 🎯 **SUCCESS CRITERIA:**

### **Minimum Viable (60%):**
- ✅ Site loads
- ✅ Vehicles display
- ✅ Can navigate

### **Functional (80%):**
- ✅ Images display
- ✅ Lightbox opens
- ✅ Tags load (in console)

### **Fully Operational (100%):**
- ✅ Green dots visible
- ✅ Spatial popup works
- ✅ Checkout flow functional
- ✅ Complete purchase possible

---

## 📊 **CURRENT STATUS:**

**Backend:** 100% ✅  
**Data Flow:** 100% ✅  
**Frontend Rendering:** 15% ❌  

**Estimated Completion:** 30 minutes after debug analysis

---

## 🚀 **READY TO TEST:**

**Local:** http://localhost:5173 (running)  
**Production:** https://n-zero.dev (deployed)  
**Debug Logs:** ✅ Enabled  
**Test Data:** ✅ 3 tags on image `59fec501-534d-4420-8c31-fb277c839959`

**Next:** Open browser, run through tests, capture screenshots, analyze debug output.

