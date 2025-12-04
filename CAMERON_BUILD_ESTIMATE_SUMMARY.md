# 📊 Cameron's 1983 K2500 Build Estimate - Summary

## ✅ BUILD PROJECT CREATED

**Build ID**: a7e76f5f-fd79-41f0-a102-18a99c4ee6d2  
**Total Budget**: **$31,633.41**

---

## 💰 BREAKDOWN BY ORGANIZATION

### 🎨 **Taylor Customs** - Paint Work
- **Labor**: 102.6 hrs @ $150/hr = **$15,387.50**
- **Parts**: **$6,461.00**
- **Total**: **$21,848.50** (69% of budget)

**Work includes:**
- Body prep, sanding, primer
- Paint exterior/interior/door jams/bed
- Bodywork, dent pulling
- Buff and reassemble

---

### 🪑 **Ernies Upholstery** - Interior Work
- **Labor**: 19.0 hrs @ $150/hr = **$2,850.00**
- **Parts**: **$4,216.92**
- **Total**: **$7,066.92** (22% of budget)

**Work includes:**
- Bench seat reupholstery
- Door panels
- Vinyl wrapped dash
- Carpet + door carpet
- Steering wheel, gauges

---

### 🔧 **Mechanical** - General
- **Labor**: 6.5 hrs @ $150/hr = **$975.00**
- **Parts**: **$1,036.00**
- **Total**: **$1,715.39** (5% of budget)

**Work includes:**
- Lift kit (2" suspension)
- LED headlights
- Radio
- Vent window refurb

---

### 🚗 **Undercarriage** - Detail Work
- **Labor**: 4.0 hrs @ $150/hr = **$600.00**
- **Parts**: **$250.00**
- **Total**: **$1,300.00** (4% of budget)

**Work includes:**
- Power wash
- Light refurbish

---

## 📋 LINE ITEMS (Schema Issue - Use UI Instead)

**Problem**: `build_line_items` table schema mismatch - columns don't match import format.

**Solution**: Upload CSV via UI instead of CLI.

---

## 🎯 WHERE TO UPLOAD CSV FOR FULL IMPORT

### **OPTION 1: Vehicle Page → Upload Reference Document** ⭐

1. Go to: https://n-zero.dev/vehicle/5a1deb95-4b67-4cc3-9575-23bb5b180693
2. Scroll to "Upload Reference Document" section
3. **Drop file**: `/Users/skylar/Library/Mobile Documents/com~apple~Numbers/Documents/cameron/1983 k2500 estimate.csv`
4. System auto-parses and imports

### **OPTION 2: Header Search → Paste CSV**

1. Click top search bar
2. Paste entire CSV content
3. Click "GO"
4. AI routes to build import

### **OPTION 3: Manual SQL (If UI broken)**

Run this in Supabase SQL Editor:

```sql
-- Create build manually
INSERT INTO vehicle_builds (
  vehicle_id,
  name,
  description,
  status,
  total_budget,
  total_spent,
  start_date
) VALUES (
  '5a1deb95-4b67-4cc3-9575-23bb5b180693',
  'K2500 Complete Restoration',
  'Sept 2024 estimate: $31,633.41. Paint: $21,848 (Taylor Customs). Interior: $7,067 (Ernies). Mechanical: $1,715. Original estimate: $24,943.',
  'in_progress',
  31633.41,
  0,
  '2024-09-01'
);
```

---

## 💡 KEY INSIGHTS FROM YOUR CSV

### **Original Estimate vs Sept Update:**
- **Original**: $24,942.63 (92.5 hrs labor)
- **Sept**: $31,633.41 (131.9 hrs labor)
- **Increase**: +$6,690.78 (+27%)
- **Reason**: More labor hours (additional bodywork, paint coats)

### **Labor Distribution:**
- **Paint**: 102.6 hrs (78% of labor)
- **Interior**: 19.0 hrs (14%)
- **Mechanical**: 6.5 hrs (5%)
- **Undercarriage**: 4.0 hrs (3%)

### **Paint-Heavy Build:**
- 69% of budget is paint
- Taylor Customs doing majority of work
- Lots of body prep (dent pulling, sanding, primer)

### **Trade-In:**
- White truck VIN: **1GCEK14L9EJ147915**
- Part of payment structure
- $4,000 cash + trade

---

## 🏪 ORGANIZATION ATTRIBUTION

Based on your CSV:

**Taylor Customs** (Paint)
- 49 line items
- $21,848.50 total
- Paint booth work at 707 Yucca St

**Ernies Upholstery** (Interior)
- 15 line items  
- $7,066.92 total
- Interior shop at 707 Yucca St

**Viva! Las Vegas Autos** (Project Management)
- Skylar as lead contractor
- Overall coordination
- Final assembly

---

## ✅ NEXT STEPS

1. **Upload CSV via UI** to import all 97 line items
2. **Link to organizations** (auto-links by supplier name)
3. **Create work orders** for Taylor and Ernies
4. **Track progress** as work completes

**Build project is created. Line items need UI upload due to schema constraints.**

**Total**: **$31,633.41** budgeted across 97 tasks.

