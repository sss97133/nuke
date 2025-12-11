# Dealer Profile: Services Tab

## Overview

Dealers offer services in addition to vehicle sales. Services should appear as a tab alongside the Vehicles tab on dealer profiles.

---

## Profile Tab Structure

```
Dealer Profile
├─ [Vehicles] Tab (default)
│  └─ Inventory listings
│
├─ [Services] Tab
│  └─ Services offered
│     ├─ Sales
│     ├─ Service Department
│     ├─ Parts
│     ├─ Restoration
│     └─ Custom Build
│
└─ [About] Tab
   └─ Description, specialties, contact info
```

---

## Services Extraction

### From Classic.com Profile
- Services are typically **not** on Classic.com profile pages
- Classic.com is mainly a directory/listing service

### From Dealer Website
- Services are typically found on:
  - Navigation menu ("Services", "Service Department", "Parts")
  - Services page (`/services`, `/service-department`, `/parts`)
  - About page (mentions services offered)
  - Footer links

### Extraction Strategy

1. **Extract from Classic.com Profile** (if present)
   - Basic services mentioned in description
   - Services section if exists

2. **Extract from Dealer Website** (primary source)
   - Catalog dealer website structure
   - Extract services from navigation menu
   - Extract services from services page
   - Extract services from about/description

3. **Store in `services_offered` Array**
   ```json
   {
     "services_offered": [
       "Sales",
       "Service Department",
       "Parts",
       "Restoration",
       "Custom Build"
     ]
   }
   ```

---

## Services Field Mapping

### `businesses.services_offered` (TEXT[])
Stores array of services as strings:
- Normalized service names
- Examples: "Sales", "Service", "Parts", "Restoration", "Custom Build"

### Common Service Types
- Sales (vehicle sales)
- Service (service department, repairs)
- Parts (parts sales)
- Restoration
- Custom Build
- Consignment
- Storage
- Transportation
- Photography

---

## UI Display

### Services Tab Content

```
┌─────────────────────────────────────────────────────────┐
│ Services                                                  │
│                                                          │
│ 111 Motorcars offers the following services:            │
│                                                          │
│ 🚗 Vehicle Sales                                         │
│    Browse our extensive inventory of classic vehicles   │
│                                                          │
│ 🔧 Service Department                                    │
│    Professional automotive service and repairs          │
│                                                          │
│ 🔩 Parts                                                 │
│    Genuine parts for classic trucks and muscle cars    │
│                                                          │
│ 🛠️  Restoration                                          │
│    Full restoration services for classic vehicles       │
│                                                          │
│ 🎨 Custom Build                                          │
│    Custom builds and modifications                      │
│                                                          │
│ [Contact for Services →]                                │
└─────────────────────────────────────────────────────────┘
```

---

## Database Structure

### `businesses` Table
```sql
services_offered TEXT[] DEFAULT ARRAY[]::TEXT[]
```

### Example Record
```json
{
  "id": "...",
  "business_name": "111 Motorcars",
  "services_offered": [
    "Sales",
    "Service Department",
    "Parts",
    "Restoration",
    "Custom Build"
  ]
}
```

---

## Extraction Implementation

### Step 1: Catalog Dealer Website Structure
```javascript
// Catalog structure including services
await catalogDealerWebsite({
  url: 'https://www.111motorcars.com',
  site_type: 'dealer_website'
});
```

### Step 2: Extract Services
```javascript
// Extract services from:
// - Navigation menu
// - Services page
// - About/description

const services = extractServices(websiteHTML);
// Returns: ["Sales", "Service", "Parts", "Restoration", "Custom Build"]
```

### Step 3: Store in Database
```sql
UPDATE businesses
SET services_offered = ARRAY['Sales', 'Service Department', 'Parts', 'Restoration', 'Custom Build']
WHERE id = '...';
```

---

## Next Steps

1. ✅ Update catalog to include `services_offered` field
2. ⏳ Extract services from dealer website (not just Classic.com profile)
3. ⏳ Store services in `businesses.services_offered` array
4. ⏳ Display services in UI as tab alongside Vehicles
5. ⏳ Link services to booking system (future)

---

## Notes

- Services are typically on the dealer's website, not Classic.com
- Need to catalog and extract from `dealer_website`, not just `classic.com` profile
- Services should be displayed as a tab alongside Vehicles tab
- Services can link to booking/contact system (future enhancement)

