# 📱 Mobile Feature Parity - Manual Testing Guide

**Production URL:** https://nuke.ag  
**Test Device:** Your iPhone/Android  
**Account Needed:** Yes (for owner features)

---

## 🎯 QUICK TEST CHECKLIST

### ✅ Phase 1: Logged-Out Features (Works for Anyone)

**Test 1: Instagram Image Viewer**
1. Open any vehicle with photos on mobile
2. Tap Images tab
3. Tap any image
4. **Expected:** Full-screen viewer with Instagram-style gestures
5. **Actions:**
   - ✅ Swipe left → Next image (smooth animation)
   - ✅ Swipe right → Previous image
   - ✅ Swipe down → Close viewer
   - ✅ See progress dots at top
   - ✅ Double-tap → Like (if logged in)

**Test 2: AI Timeline Insights**
1. Open any vehicle
2. Tap Timeline tab
3. Tap a year header to expand
4. Click an event
5. **Expected:** See AI value impact badges
   - "💎 +$X" or "🔥 +$X" or "🚀 +$X Major"
   - Cost badge: "$500"
   - Hours badge: "4.5h"

**Test 3: Comment Viewing**
1. Scroll to bottom of Overview tab
2. **Expected:** See "💬 X Comments" button
3. Tap to expand
4. **Expected:** Comment thread shows (or "No comments yet")

---

### 🔐 Phase 2: Owner Features (Login Required)

**Login First:**
1. Go to https://nuke.ag
2. Log in with your account
3. Navigate to one of YOUR vehicles

**Test 4: Document Upload**
1. On Overview tab, find "📄 Upload Doc" button
2. **Expected:** Button visible (owner only)
3. Tap button
4. **Expected:** Modal with 6 categories:
   - 🧾 Receipt
   - 📜 Title
   - 🪪 Registration
   - 🛡️ Insurance
   - 🔧 Service Record
   - 📄 Other
5. Select "Receipt"
6. **Expected:** Camera opens automatically
7. Take photo of a receipt
8. **Expected:** 
   - "Processing..." screen
   - AI extracts vendor, total, date
   - Shows preview
9. Add title/notes
10. Tap "✓ Save Document"
11. **Expected:** 
    - Document saved
    - Timeline event created
    - Modal closes

**Test 5: Price Editor**
1. On Overview tab, tap "💰 Edit Price" button
2. **Expected:** Price editor modal opens
3. **Check for:**
   - ✅ Gain/Loss card (shows current profit/loss)
   - ✅ 4 price fields (MSRP, Purchase, Current, Asking)
   - ✅ "List for sale" checkbox
   - ✅ Price history (last 10 changes)
4. Edit "Current Value" field
5. **Expected:** Gain/Loss updates instantly
6. Tap "✓ Save Prices"
7. **Expected:** 
   - Prices saved
   - History entry created
   - Page refreshes
   - New price shows on Overview

**Test 6: Comment Posting**
1. Scroll to bottom of Overview
2. Tap comment text area
3. **Expected:** Comment thread expands automatically
4. Type: "Testing mobile comments!"
5. Tap → (arrow button)
6. **Expected:**
   - Comment posts
   - Appears in thread instantly
   - Shows "just now" timestamp

**Test 7: Vehicle Data Editor**
1. Go to Specs tab
2. **Expected:** See "✏️ Edit Vehicle Data" button (owner only)
3. Tap button
4. **Expected:** Full-screen editor with 4 sections:
   - 🚗 Basic Info
   - ⚙️ Technical
   - 💰 Financial
   - 📏 Dimensions
5. Tap "Basic Info" to expand
6. **Expected:** Fields: Year, Make, Model, Trim, Color, VIN, Mileage
7. Edit "Mileage" field
8. Tap "✓ Save All Changes"
9. **Expected:**
   - Data saves
   - Page refreshes
   - New mileage shows in Specs

---

### 🏢 Phase 3: Organization Features (Org Member Required)

**Test 8: Organization Switcher**
1. Visit https://nuke.ag/mobile/org on mobile
2. **Expected (if you're in any orgs):**
   - Dropdown shows your organizations
   - Each shows: Logo, Name, Role
3. Tap an org
4. **Expected:** Dashboard loads with 3 tabs:
   - 📊 Overview (stats, info, contact)
   - 👥 Team (member cards with avatars)
   - 🚗 Vehicles (fleet list)
5. Browse each tab
6. **Expected:** All data loads, cards are tappable

**If Not in Org:**
- Visit /shops/new to create one
- Then test org switcher

---

## 📊 AUTOMATED TEST RESULTS

**PIP Test ran:** `pip-test-mobile-parity.js`

**Results:**
- ✅ Comment System: Found and working
- ⚠️  Owner features: Require authentication (expected)
- ⚠️  AI Insights: Need timeline events with cost/duration data
- ⚠️  Org tools: Need org membership

**Note:** Warnings are expected for features that require specific permissions!

---

## 🐛 KNOWN LIMITATIONS

1. **Document OCR:** Requires OpenAI API key in Supabase Edge Function
   - If not configured, document uploads still work
   - Just won't auto-extract data
   - Manual title/notes entry works fine

2. **Owner Buttons:** Only show if you're the vehicle owner
   - Correct behavior (security)
   - Upload Doc, Edit Price, Edit Data require ownership

3. **AI Insights:** Only show on events with `cost_amount` or `duration_hours`
   - If timeline events don't have this data, badges won't appear
   - This is data-dependent, not a bug

4. **Org Switcher:** Only shows if user is member of at least 1 organization
   - If you're not in any orgs, it won't appear
   - Visit /shops/new to create one

---

## ✅ SUCCESS CRITERIA

**Minimum to Pass:**
- [ ] Images open in enhanced viewer (not browser tabs)
- [ ] AI value badges appear on timeline events
- [ ] Comment box visible at bottom of tabs
- [ ] Owner buttons (Doc, Price, Data) visible when logged in as owner
- [ ] All modals open smoothly (no direct URL jumps)
- [ ] Everything feels Instagram-smooth

**Bonus:**
- [ ] Receipt OCR extracts data
- [ ] Price gain/loss calculates correctly
- [ ] Org dashboard shows team/vehicles
- [ ] No console errors

---

## 📸 SCREENSHOT EVIDENCE

Check `test-results/` folder:
- `mobile-homepage.png` - Homepage on mobile viewport
- `mobile-vehicle-loaded.png` - Vehicle profile page
- `mobile-parity-final.png` - Final state after tests

---

## 🚀 DEPLOYMENT STATUS

**Commit:** `20bf483f`  
**Build:** ✅ Successful  
**Deploy:** ✅ Production (https://nuke.ag)  
**Bundle:** New static assets deployed  
**Verification:** Run `curl -s https://nuke.ag | grep -o '_next/static/[^/]*' | head -1`

---

## 💡 MANUAL VERIFICATION STEPS

**Best way to verify everything:**

1. **On Your Phone:**
   - Visit https://nuke.ag
   - Log in
   - Go to one of YOUR vehicles
   - Test all 6 features above

2. **Quick Smoke Test (2 minutes):**
   - Tap image → Swipe (Instagram-style) ✅
   - Tap "Upload Doc" → Camera opens ✅
   - Tap "Edit Price" → Modal with gain/loss ✅
   - Scroll down → Comment box ✅
   - Timeline → Expand year → See AI badges ✅
   - Specs → "Edit Data" → Sections expand ✅

3. **If ANY feature missing:**
   - Hard refresh (Cmd+Shift+R)
   - Clear cache
   - Check you're the owner
   - Check console for errors

---

**All features deployed and ready to test! 🎉**

