# Classic.com Dealer Import Plan

## Overview

Import plan for indexing Classic.com dealer directory using structure-first catalog extraction. The system catalogs dealer site structure once, then uses that catalog for systematic extraction across all dealers using the same platform.

---

## Platform Recognition: DealerFire/DealerSocket

**Key Insight**: Many dealers use common platforms (DealerFire, DealerSocket) which means:
- ✅ One catalog structure works for many dealers
- ✅ Extraction patterns are reusable
- ✅ Boilerplate detection is standardized

### DealerFire Pattern
Footer typically contains:
- "Next-Generation Engine 6 Custom Dealer Website powered by DealerFire"
- "Part of the DealerSocket portfolio..."
- Copyright notices

**Solution**: Catalog and extraction automatically exclude this boilerplate.

---

## Import Workflow

### Phase 1: Discovery (One-Time)

1. **Scrape Classic.com Directory**
   - Source: `https://www.classic.com/data` (all dealers)
   - Extract all dealer profile URLs
   - Store in `dealer_site_schemas` or queue table

2. **Catalog Platform Types**
   - Identify platform (DealerFire, DealerSocket, custom)
   - Create one catalog per platform
   - Verify catalog completeness

### Phase 2: Structure Cataloging

1. **Catalog Classic.com Structure**
   - Sample: `https://www.classic.com/s/111-motorcars-ZnQygen/`
   - Creates catalog for `classic.com` domain
   - Fields: name, logo, license, contact, location, description, specialties

2. **Catalog DealerFire Platform Structure**
   - Sample: `https://www.111motorcars.com/` (or any DealerFire site)
   - Creates catalog for DealerFire platform pattern
   - Reusable across all DealerFire dealers

### Phase 3: Batch Import

1. **For Each Dealer Profile URL:**
   ```
   ├─ Extract using Classic.com catalog
   ├─ Get dealer website URL
   ├─ Identify platform (DealerFire, custom, etc.)
   ├─ Extract using platform catalog (if exists)
   ├─ Create/update business record
   ├─ Download logo/favicon/images
   └─ Queue inventory extraction
   ```

2. **Organization Creation Logic:**
   - Match by: dealer_license (strongest) → website → name+city+state
   - Create new if no match
   - Update missing fields if match found

3. **Image Processing:**
   - Logo: Download from Classic.com or dealer site
   - Favicon: Extract from dealer website
   - Primary image: Extract property front image (basic for now)

### Phase 4: Inventory Extraction

1. **Queue Inventory Scrapes**
   - Rate limit: Once per dealer per 24 hours
   - Use dealer's `inventory_url` or website/inventory

2. **Extract Inventory**
   - Use platform catalog if DealerFire
   - Use generic extraction if custom platform
   - Create `dealer_inventory` records
   - Link vehicles via VIN matching

---

## Data Flow

```
Classic.com Directory
    ↓
Dealer Profile URLs
    ↓
Catalog Classic.com Structure (once)
    ↓
Extract Profile Data (per dealer)
    ├─ Name, Logo, License
    ├─ Contact Info
    ├─ Location
    └─ Website URL
    ↓
Identify Platform (DealerFire, etc.)
    ↓
Catalog Platform Structure (once per platform)
    ↓
Extract Additional Data (per dealer)
    ├─ Description (cleaned of boilerplate)
    ├─ Specialties
    └─ Primary Image
    ↓
Create/Update Business Record
    ↓
Queue Inventory Extraction
    ↓
Extract Inventory Listings
    ├─ Vehicle Data
    ├─ Pricing
    └─ Images
    ↓
Create dealer_inventory Records
    ↓
Link to Vehicles Table (VIN matching)
```

---

## Catalog Reusability

### Classic.com Catalog
- **Domain**: `classic.com`
- **Reusable for**: All Classic.com dealer profiles
- **Fields**: Profile-specific data (name, logo, license, contact)

### DealerFire Platform Catalog
- **Pattern**: DealerFire-powered websites
- **Reusable for**: All dealers using DealerFire
- **Fields**: Description, specialties, images, inventory structure
- **Boilerplate**: Automatically excluded

### Benefits
- ✅ Catalog once, extract many times
- ✅ Consistent extraction across platform
- ✅ Easy to update when platform changes

---

## Sample Dealer Profile (111 Motorcars)

### As Stored in `businesses` Table

```json
{
  "id": "uuid-here",
  "business_name": "111 Motorcars",
  "business_type": "dealership",
  "type": "dealer",
  
  "dealer_license": "DL-12345",
  "website": "https://www.111motorcars.com",
  
  "phone": "629-306-8151",
  "email": "info@111motorcars.com",
  "address": "123 Main Street",
  "city": "Franklin",
  "state": "TN",
  "zip_code": "37064",
  "country": "US",
  "latitude": 35.9251,
  "longitude": -86.8689,
  
  "description": "Specializing in classic trucks and muscle cars. Family-owned dealership with over 20 years of experience.",
  "specializations": ["Classic Trucks", "Muscle Cars", "C/K Series"],
  
  "logo_url": "https://supabase-storage.../logos/111-motorcars.png",
  "favicon_url": "https://supabase-storage.../favicons/111motorcars.com.svg",
  "cover_image_url": "https://supabase-storage.../covers/111-motorcars-front.jpg",
  
  "discovered_via": "classic_com_indexing",
  "source_url": "https://www.classic.com/s/111-motorcars-ZnQygen/",
  "geographic_key": "111-motorcars-franklin-tn",
  
  "metadata": {
    "classic_com_profile": "https://www.classic.com/s/111-motorcars-ZnQygen/",
    "platform": "DealerFire",
    "inventory_url": "https://www.111motorcars.com/inventory",
    "inventory_count": 45,
    "last_inventory_sync": "2025-12-11T20:00:00Z"
  },
  
  "status": "active",
  "is_verified": false,
  "created_at": "2025-12-11T20:00:00Z",
  "updated_at": "2025-12-11T20:00:00Z"
}
```

### Profile Display Structure

```typescript
interface DealerProfile {
  // Header
  name: "111 Motorcars"
  logo: "https://..."
  verified: false
  
  // Quick Info
  location: "Franklin, TN"
  phone: "(629) 306-8151"
  website: "111motorcars.com"
  specialties: ["Classic Trucks", "Muscle Cars"]
  
  // Stats
  inventoryCount: 45
  vehicles: Vehicle[] // Linked via dealer_inventory
  
  // About
  description: "Specializing in classic trucks and muscle cars..."
  
  // Images
  coverImage: "https://..."
  logo: "https://..."
  
  // Discovery
  discoveredVia: "Classic.com"
  sourceUrl: "https://www.classic.com/s/111-motorcars-ZnQygen/"
  
  // Platform
  platform: "DealerFire" // Shows if using common platform
}
```

---

## Platform Translation

### DealerFire Platform Pattern

**Recognition**: Footer contains "DealerFire" or "DealerSocket"

**Extraction Benefits**:
- Description extraction excludes boilerplate automatically
- Inventory structure is predictable
- Image extraction patterns are consistent
- Specialties extraction follows same pattern

**Reusable For**:
- Any dealer using DealerFire platform
- One catalog → many dealers
- Consistent data quality

---

## Import Scripts

### 1. Catalog Classic.com Structure
```bash
node scripts/catalog-classic-com-structure.js
```

### 2. Catalog DealerFire Platform (if needed)
```bash
node scripts/catalog-dealerfire-platform.js https://www.111motorcars.com
```

### 3. Batch Import Classic.com Dealers
```bash
node scripts/index-classic-com-dealers.js
```

### 4. Test Single Dealer Import
```bash
node scripts/test-dealer-import.js "https://www.classic.com/s/111-motorcars-ZnQygen/"
```

---

## Success Metrics

### Phase 1: Cataloging
- ✅ Classic.com catalog created
- ✅ Platform catalogs identified (DealerFire, etc.)
- ✅ Catalog confidence > 80%

### Phase 2: Profile Extraction
- ✅ 80%+ dealers have greenlight signals (name, logo, license)
- ✅ 80%+ have core contact info (phone, website)
- ✅ < 1% false duplicates

### Phase 3: Inventory Extraction
- ✅ 70%+ dealers have inventory extracted
- ✅ 70%+ listings have critical fields (VIN, year, make, model, price)
- ✅ 90%+ listings have at least 1 image

---

## Next Steps

1. ✅ Fix catalog to exclude boilerplate (done)
2. ⏳ Build batch import script
3. ⏳ Test on 10 dealers
4. ⏳ Scale to full Classic.com directory
5. ⏳ Monitor data quality
6. ⏳ Add platform-specific catalogs (DealerFire, etc.)

---

## Notes

- **Catalog Reusability**: Once Classic.com structure is cataloged, all Classic.com profiles use same catalog
- **Platform Patterns**: DealerFire dealers share same structure → one catalog works for all
- **Boilerplate**: Automatically excluded from descriptions
- **Deduplication**: Uses license → website → name+location priority
- **Rate Limiting**: Inventory sync limited to once per 24 hours per dealer

