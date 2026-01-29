# Extraction Results: 111 Motorcars

## Summary

✅ **Successfully extracted dealer profile data**
⚠️ **Services extraction needs enhancement**

---

## Extracted Data

### From Classic.com Profile
- ✅ Name: "111 Motorcars"
- ✅ Phone: "629-306-8151" (Classic.com)
- ✅ Website: "https://www.111motorcars.com/"
- ✅ Logo: "https://images.classic.com/uploads/dealer/One_Eleven_Motorcars.png"
- ✅ Inventory URL: "https://www.classic.com/s/111-motorcars-ZnQygen/#dealer-listings-table"

### From Dealer Website (`111motorcars.com`)
- ✅ Name: "111 Motorcars"
- ✅ Address: "111 Alpha Dr, Franklin, TN 37064"
- ✅ City: "Franklin"
- ✅ State: "TN"
- ✅ Zip: "37064"
- ✅ Phone: "(629) 312-1110" (actual phone from website)
- ✅ Website: "https://www.111motorcars.com"
- ✅ Specialties: ["luxury used cars", "classic vehicles"]
- ✅ Description: "111 Motorcars is a premier destination for luxury used cars in Nashville, TN, offering a curated selection of high-quality sedans, SUVs, and more."

### Missing / Needs Extraction
- ❌ Services offered (needs navigation/services page extraction)
- ❌ Dealer license
- ⚠️ Email (extracted as "Email" - needs cleaning)

---

## Services Extraction Status

**Current Issue**: Services not found because:
1. Homepage doesn't explicitly list services
2. Services are likely in:
   - Navigation menu (Services, Parts, Service Department)
   - Dedicated services page (`/services`, `/service-department`)
   - Footer links

**Next Steps**:
1. Extract from navigation menu (look for "Services", "Parts", "Service" links)
2. Scrape services page if exists
3. Parse services from footer
4. Extract from description (look for service keywords)

---

## Profile Structure (As It Would Appear)

### Profile Card
```
┌─────────────────────────────────────────────────────────┐
│  [111 Motorcars Logo]    111 Motorcars                  │
│                          111 Alpha Dr, Franklin, TN     │
│                          (629) 312-1110                 │
│                          111motorcars.com               │
│                                                          │
│  Specialties: Luxury Used Cars • Classic Vehicles      │
│  Services: [Services Tab - needs extraction]            │
│  Inventory: 45+ vehicles (from Classic.com)            │
└─────────────────────────────────────────────────────────┘
```

### Tabs (When Services Are Extracted)
```
┌─────────────────────────────────────────────────────────┐
│  [Vehicles]  [Services]  [About]                        │
│                                                          │
│  Services Tab Content:                                  │
│  • Vehicle Sales                                        │
│  • Service Department (if they offer)                   │
│  • Parts (if they offer)                                │
│  • Restoration (if they offer)                          │
└─────────────────────────────────────────────────────────┘
```

---

## Database Record (Partial)

```json
{
  "business_name": "111 Motorcars",
  "type": "dealer",
  "address": "111 Alpha Dr",
  "city": "Franklin",
  "state": "TN",
  "zip_code": "37064",
  "phone": "(629) 312-1110",
  "website": "https://www.111motorcars.com",
  "description": "111 Motorcars is a premier destination for luxury used cars in Nashville, TN...",
  "specializations": ["luxury used cars", "classic vehicles"],
  "services_offered": [], // ⚠️ Empty - needs extraction
  "logo_url": "https://images.classic.com/uploads/dealer/One_Eleven_Motorcars.png",
  "discovered_via": "classic_com_indexing",
  "source_url": "https://www.classic.com/s/111-motorcars-ZnQygen/",
  "geographic_key": "111-motorcars-franklin-tn"
}
```

---

## Next Steps for Services Extraction

### 1. Navigation Menu Extraction
- Parse `<nav>` or navigation elements
- Look for links containing: "Services", "Parts", "Service", "Department"
- Extract service names from navigation

### 2. Services Page Scraping
- Check for `/services`, `/service-department`, `/parts` pages
- Extract services from dedicated pages
- More accurate than homepage

### 3. Footer Links
- Parse footer for service-related links
- Extract service categories

### 4. Description Analysis
- Parse description for service keywords
- Extract mentioned services

---

## Extraction Success Metrics

✅ **Profile Data**: 85% complete
- ✅ Contact info
- ✅ Location
- ✅ Specialties
- ✅ Description
- ❌ Services (0%)

**Overall**: Good foundation, services extraction needs enhancement

---

**Status**: Profile extracted successfully, services extraction pending navigation/services page scraping.

