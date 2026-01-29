# 🧪 TEST SPATIAL PARTS MARKETPLACE - STEP BY STEP

**Status:** ✅ CODE DEPLOYED TO GITHUB (10 commits)  
**Vercel:** Building (check: https://vercel.com/dashboard)  
**Test Data:** ✅ 3 shoppable tags created on GMC truck

---

## 🎯 **WHAT TO TEST:**

### **1. CHECK IF NEW CODE IS LIVE:**

Visit: https://n-zero.dev/?t=123456

**Look for:**
- New bundle hash in console
- Should change from `index-BB5HYU31.js` to something new
- Or check: View Source → search for "SpatialPartPopup"

---

### **2. TEST SPATIAL WORKFLOW:**

**Go to:** https://n-zero.dev/vehicle/a90c008a-3379-41d8-9eb2-b4eda365d74c

**Steps:**
1. **Scroll down** to image gallery
2. **Click the blue GMC truck photo** (primary image)
3. **Lightbox opens** - you should see:

**✅ EXPECTED:**
```
[Clean photo of truck]
    🟢 ← Green dot at bumper (bottom center)
    🟢 ← Green dot at headlight (left)
    🟢 ← Green dot at grille (center)
```

**4. Hover bumper dot (bottom center):**
```
┌──────────────────────────┐
│ Front Bumper Assembly 🛒 │ ← Tooltip appears
│ Part# 15643917           │
└──────────────────────────┘
```

**5. Click bumper dot:**
```
┌────────────────────────────┐ ← Popup RIGHT THERE
│ Front Bumper Assembly      │
│ Part# 15643917             │
├────────────────────────────┤
│ RockAuto     $67.50  ◀LOW  │ ← Cheapest first
│ ✓ In Stock • 5d ship       │
├────────────────────────────┤
│ LMC Truck    $89.99        │
│ ✓ In Stock • 3d ship       │
├────────────────────────────┤
│ Amazon       $102.99       │
│ ✓ In Stock • 2d ship       │
└────────────────────────────┘
   Click to select • Double-click to order
```

**6. Click RockAuto ($67.50):**
- Row highlights green
- "Order" button appears at bottom

**7. Double-click RockAuto:**
```
┌────────────────────────────────┐
│ Checkout - RockAuto       [✕] │
├────────────────────────────────┤
│ Front Bumper Assembly          │
│ Part# 15643917                 │
│ $67.50 each                    │
│                                │
│ Quantity: [-] 1 [+]            │
│                                │
│ Subtotal:    $67.50            │
│ Shipping:    $12.99            │
│ Tax:         $6.44             │
│ ────────────────────           │
│ TOTAL:       $86.93            │
│                                │
│ [Cancel] [Purchase for $86.93] │
└────────────────────────────────┘
```

**8. Click Purchase:**
- Creates record in `part_purchases` table
- Opens RockAuto link (until Stripe integrated)
- Success! ✅

---

## 🟢 **TEST OTHER PARTS:**

### **Headlight (left side, green dot):**
- Part#: GM-HL-8387
- 2 suppliers
- LMC: $45.00 (cheapest)
- Amazon: $52.00

### **Chrome Grille (center, green dot):**
- Part#: GMC-GR-73
- 3 suppliers
- LMC: $159.99 (cheapest, in stock)
- Summit: $162.50 (in stock)
- Classic Parts: $175.00 (OUT OF STOCK - greyed out)

---

## ❌ **IF DOTS DON'T APPEAR:**

**Problem:** Vercel still building or cached

**Solutions:**
1. Wait 5 more minutes
2. Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
3. Clear cache: DevTools → Network → Disable cache
4. Check Vercel dashboard for deployment status
5. Look for new bundle hash in console

**Confirm new code:**
```javascript
// In browser console:
window.location.reload(true); // Hard reload
```

---

## 🚀 **IF IT WORKS:**

You'll have the **smoothest parts ordering experience**:

✅ Click on part → see prices → order  
✅ 2 clicks total (vs 12 before)  
✅ No sidebar clutter  
✅ No button spam  
✅ Clean LMC Truck-style interface  

**Next Steps:**
1. Scrape full LMC catalog (500+ parts)
2. AI Analyze all images
3. Auto-match parts
4. Every photo becomes shoppable
5. Instant parts marketplace

---

## 📊 **VERIFICATION QUERIES:**

### **Check if tags were created:**
```sql
SELECT 
  tag_name, 
  oem_part_number, 
  lowest_price_cents / 100.0 AS lowest_price,
  highest_price_cents / 100.0 AS highest_price,
  is_shoppable,
  suppliers::text
FROM image_tags
WHERE image_id = '59fec501-534d-4420-8c31-fb277c839959';
```

### **Check suppliers:**
```sql
SELECT * FROM part_suppliers ORDER BY supplier_name;
```

### **Check purchases (after test order):**
```sql
SELECT 
  part_name,
  part_number,
  total_cents / 100.0 AS total,
  payment_status,
  created_at
FROM part_purchases
ORDER BY created_at DESC
LIMIT 5;
```

---

## 🎉 **SUCCESS CRITERIA:**

- [ ] Lightbox opens full-screen (portal)
- [ ] 3 green dots visible on truck
- [ ] Hover shows tooltips
- [ ] Click opens spatial popup
- [ ] Popup shows suppliers sorted by price
- [ ] Double-click triggers checkout
- [ ] Order creates DB record
- [ ] ESC closes everything smoothly

---

**This is the LMC Truck experience - click part, shop prices, order. DONE.** 🚀

