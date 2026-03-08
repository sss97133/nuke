# Correct Addresses & Temporal Attribution

## 📍 CORRECT ADDRESSES

### **676 Wells Rd, Boulder City, NV 89005**
**Organizations (Co-located, different time periods):**
- **Nuke Ltd** (transient - moved between properties)
- **Other companies** (TBD - date ranges to be defined)

**GPS Clusters:**
- Cluster 1: 633 Wells Rd (210 photos) - **17m away** from 676
- Cluster 2: 636 Wells Rd (32 photos) - **40m away** from 676

**Note**: GPS shows 633/636 but actual address is **676 Wells**. This is **GPS drift** (~20-40m typical for phone cameras).

---

### **707 Yucca St, Boulder City, NV 89005**
**Organizations (ALL at same address!):**
- **Viva! Las Vegas Autos** (general repair, restoration)
- **Taylor Customs** (paint, bodywork, paint booth)
- **Ernies Upholstery** (upholstery, interior, seats)

**GPS Clusters:**
- Cluster 12: 717 Yucca St (5 photos) - **10m away** from 707
- Cluster 14: 713 Yucca St (2 photos) - **6m away** from 707
- Cluster 15: 705 Yucca St (3 photos) - **2m away** from 707

**Note**: All GPS readings within **10m** of 707 Yucca = **Same complex**. Different readings = **GPS precision variance**.

---

### **Foothill Drive (Adjacent Road)**
**GPS Clusters:**
- Cluster 3-9, 13, 16-17: Various Foothill addresses
- **150+ photos total** across multiple dates

**Likely**: GPS readings from back entrance, parking lot, or adjacent properties to 707 Yucca complex.

**Action**: Need city planning maps to determine if these are:
- Part of 707 Yucca property
- Separate adjacent shops
- GPS drift from indoor work (paint booth)

---

## 🧩 THE ATTRIBUTION CHALLENGE

### Problem: Same GPS, Different Organizations

**707 Yucca St hosts 3 organizations:**
- Paint work → **Taylor Customs**
- Upholstery work → **Ernies**
- General work → **Viva**

**GPS can tell us "707 Yucca" but NOT which org did the work!**

### Solution: Multi-Signal Attribution

```
GPS Location (40%) + Work Type (50%) + Date Range (10%) = Attribution
```

**Example:**
```
Image GPS: 35.972831, -114.855897 (707 Yucca)
Work detected: Paint (AI vision)
Date: Sept 15, 2024

Matching:
- Taylor Customs: 95% (707 Yucca + paint specialty + active Sept 2024)
- Viva: 60% (707 Yucca + active Sept 2024, but not paint specialist)
- Ernies: 40% (707 Yucca + active Sept 2024, but upholstery not paint)

→ Attribute to Taylor Customs (95% confidence)
```

---

## 📅 DATE RANGES TO DEFINE

### Nuke Ltd (Transient)
```sql
-- TBD: Define when Nuke was at each location
UPDATE organization_location_periods
SET 
  active_from = '2024-??-??',
  active_until = '2024-??-??',
  date_confidence = 90,
  source = 'user_verified',
  notes = 'Confirmed by Skylar'
WHERE organization_id = (SELECT id FROM businesses WHERE business_name ILIKE '%nuke%')
  AND address = '676 Wells Rd, Boulder City, NV 89005';
```

**Once you know the dates**, we can:
- Filter photos by date
- Attribute work correctly
- Show "At Nuke Ltd, 676 Wells (Apr-Aug 2024)"

### 707 Yucca Tenancy
```sql
-- TBD: Define when each org was active
-- Did they overlap? Sequential? Different date ranges?

-- Example scenarios:
-- Scenario A: All active simultaneously (shared complex)
UPDATE organization_location_periods
SET active_from = '2020-01-01', active_until = NULL  -- All still active
WHERE address = '707 Yucca St, Boulder City, NV 89005';

-- Scenario B: Sequential occupancy
-- Viva: 2020-2023
-- Taylor: 2023-2024
-- Ernies: 2024-present
```

---

## 🤖 AUTO-DISCOVER DATES FROM PHOTOS

Run this to find when organizations were active based on photo evidence:

```sql
-- Discover Nuke Ltd active dates from photos
SELECT refine_organization_dates_from_photos(
  (SELECT id FROM businesses WHERE business_name ILIKE '%nuke%')
);

-- Returns:
{
  "organization_id": "...",
  "address": "676 Wells Rd",
  "earliest_photo": "2024-04-30",
  "latest_photo": "2025-02-19",
  "photo_count": 210,
  "confidence": 85
}

-- Suggested date range: April 2024 - Feb 2025
```

**Run for each org:**
```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

['Nuke', 'Viva', 'Taylor', 'Ernies'].forEach(async (name) => {
  const { data: org } = await supabase
    .from('businesses')
    .select('id, business_name')
    .ilike('business_name', '%' + name + '%')
    .single();
  
  if (org) {
    const result = await supabase.rpc('refine_organization_dates_from_photos', {
      p_organization_id: org.id
    });
    console.log(org.business_name + ':', result.data);
  }
});
"
```

---

## 🎯 ATTRIBUTION RULES (Based on Your Input)

### 707 Yucca St (Shared Address)

**When GPS = 707 Yucca:**

| Work Type | Date Range | Organization | Confidence |
|-----------|------------|--------------|------------|
| Paint | Any | **Taylor Customs** | 95% |
| Upholstery | Any | **Ernies** | 95% |
| Engine | Any | **Viva** | 85% |
| General | Any | **Viva** (default) | 70% |

**Multi-org work:**
- Lead: Skylar (documenter)
- Sub: Taylor/Viva/Ernies (performer)
- Attribution: Work to sub, credit to lead

### 676 Wells Rd (Nuke Ltd + Co-located)

**When GPS = 676 Wells:**

| Date Range | Organization | Confidence |
|------------|--------------|------------|
| Apr-??? 2024 | Nuke Ltd | TBD% |
| ???-??? | Other co-located | TBD% |

**Need to define:**
1. Exact date ranges for Nuke Ltd tenancy
2. Which other companies were co-located
3. Their date ranges

---

## 📊 NEXT STEPS

### Step 1: Define Nuke Ltd Dates
```
When was Nuke Ltd at 676 Wells Rd?
- Start: ____-__-__
- End: ____-__-__

When did Nuke Ltd move? Where to?
```

### Step 2: Verify 707 Yucca Orgs
```
Are Viva + Taylor + Ernies all still at 707 Yucca?
- Viva: YES / NO, dates: ____
- Taylor: YES / NO, dates: ____
- Ernies: YES / NO, dates: ____
```

### Step 3: Run Auto-Discovery
```bash
# Once dates are set, discover from photo evidence
npm run discover-org-dates
```

### Step 4: Apply Attribution
```bash
# Re-attribute all work based on location + date + work type
npm run re-attribute-work
```

---

## 🔬 GPS PRECISION FOR PAINT BOOTH

**Your question:** "how precise are the gps?"

**Answer for paint booth identification:**

**Precision**: ±10-20 meters typical
- **Outdoor**: 5-10m (GPS has clear sky view)
- **Indoor** (paint booth): 10-20m (GPS through roof)
- **Building interference**: 20-50m (urban canyon)

**For clustering:**
- **<10m** = Same exact spot (99% confidence)
- **10-20m** = Same building (95% confidence) ✅ **PAINT BOOTH**
- **20-50m** = Same property (85% confidence)
- **50-100m** = Nearby/adjacent (70% confidence)

**Your paint booth images:**
- Cluster 6: **50 photos** at 1568 Foothill
- All within **20m radius**
- **95% confidence = same building**
- If Taylor Customs has paint booth at this address → **Auto-attribute all 50 images**

---

## 💡 RECOMMENDATION

### Immediate:
1. **Verify addresses** with Google Maps/city planning
2. **Define Nuke Ltd date ranges** (when at 676 Wells?)
3. **Confirm 707 Yucca** houses all 3 orgs
4. **Run auto-discovery** to find dates from photos

### Then:
```bash
# Apply location-temporal attribution
node scripts/apply-location-temporal-attribution.js

# Result:
# - Paint booth images → Taylor Customs
# - Upholstery images → Ernies
# - General work → Viva
# - All based on GPS + work type + dates
```

**GPS is precise enough** (±10-20m) to cluster paint booth images with **95% confidence**.

**Work type detection** (AI) will distinguish Taylor (paint) from Ernies (upholstery) at same address.

**Date ranges** will distinguish Nuke Ltd tenancy periods.

**Want me to build the auto-attribution tool?**

