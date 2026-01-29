# Dealer Profile Example: 111 Motorcars

## What Their Profile Looks Like in Our System

Based on structure-first catalog extraction from Classic.com and their DealerFire website.

---

## 1. Profile Card View (Compact)

```
┌─────────────────────────────────────────────────────────┐
│  [111 Motorcars Logo]    111 Motorcars                  │
│                          Franklin, TN                   │
│                          (629) 306-8151                 │
│                          111motorcars.com               │
│                                                          │
│  Specialties: Classic Trucks • Muscle Cars              │
│  Inventory: 45 vehicles                                  │
│  Platform: DealerFire                                   │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Full Profile View

### Header Section
```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│  [Cover Image - Property Front]                         │
│                                                          │
│  [Logo]  111 Motorcars              [Verified Badge?]   │
│          Franklin, TN                                    │
│          Dealer License: DL-12345                        │
└─────────────────────────────────────────────────────────┘
```

### Quick Info Card
```
┌─────────────────────────────────────────────────────────┐
│ Contact                                                  │
│   📞 (629) 306-8151                                     │
│   ✉️  info@111motorcars.com                            │
│   🌐 111motorcars.com                                   │
│                                                          │
│ Location                                                 │
│   📍 123 Main Street                                    │
│       Franklin, TN 37064                                │
│                                                          │
│ Stats                                                    │
│   🚗 45 vehicles in inventory                           │
│   📊 20 years in business                               │
│   ⭐ 4.8 average rating                                 │
└─────────────────────────────────────────────────────────┘
```

### About Section
```
┌─────────────────────────────────────────────────────────┐
│ About                                                    │
│                                                          │
│ Specializing in classic trucks and muscle cars.         │
│ Family-owned dealership with over 20 years of           │
│ experience. We focus on 1967-1991 C/K series trucks    │
│ and classic American muscle.                            │
│                                                          │
│ Specialties:                                             │
│   • Classic Trucks (1967-1991 C/K)                     │
│   • Muscle Cars                                         │
│   • Squarebody Restoration                              │
└─────────────────────────────────────────────────────────┘
```

### Inventory Section
```
┌─────────────────────────────────────────────────────────┐
│ Inventory (45 vehicles)                                 │
│                                                          │
│ [Filter: All | Classic Trucks | Muscle Cars]           │
│                                                          │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│ │ [Image]  │ │ [Image]  │ │ [Image]  │                │
│ │ 1985 K10 │ │ 1972 C10 │ │ 1969 Camaro│               │
│ │ $25,000  │ │ $18,500  │ │ $45,000  │                │
│ │ 85k miles│ │ 120k mi  │ │ 42k miles│                │
│ └──────────┘ └──────────┘ └──────────┘                │
│                                                          │
│ [View All Inventory →]                                  │
└─────────────────────────────────────────────────────────┘
```

### Discovery Section
```
┌─────────────────────────────────────────────────────────┐
│ Discovered Via                                          │
│                                                          │
│   📍 Source: Classic.com                                │
│   🔗 Profile: classic.com/s/111-motorcars-ZnQygen/     │
│   🔧 Platform: DealerFire                               │
│   📅 Added: Dec 11, 2025                                │
│   🔄 Last Updated: Dec 11, 2025 20:00                  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Database Structure

### `businesses` Table Record

```sql
SELECT 
  id,
  business_name,
  type,
  dealer_license,
  website,
  phone,
  email,
  address,
  city,
  state,
  zip_code,
  description,
  specializations,
  logo_url,
  favicon_url,
  cover_image_url,
  discovered_via,
  source_url,
  geographic_key,
  metadata
FROM businesses
WHERE business_name = '111 Motorcars';
```

### Result:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "business_name": "111 Motorcars",
  "type": "dealer",
  "dealer_license": "DL-12345",
  "website": "https://www.111motorcars.com",
  "phone": "629-306-8151",
  "email": "info@111motorcars.com",
  "address": "123 Main Street",
  "city": "Franklin",
  "state": "TN",
  "zip_code": "37064",
  "description": "Specializing in classic trucks and muscle cars. Family-owned dealership with over 20 years of experience.",
  "specializations": ["Classic Trucks", "Muscle Cars", "C/K Series"],
  "logo_url": "https://storage.supabase.co/.../logos/111-motorcars.png",
  "favicon_url": "https://storage.supabase.co/.../favicons/111motorcars.com.svg",
  "cover_image_url": "https://storage.supabase.co/.../covers/111-motorcars-front.jpg",
  "discovered_via": "classic_com_indexing",
  "source_url": "https://www.classic.com/s/111-motorcars-ZnQygen/",
  "geographic_key": "111-motorcars-franklin-tn",
  "metadata": {
    "classic_com_profile": "https://www.classic.com/s/111-motorcars-ZnQygen/",
    "platform": "DealerFire",
    "inventory_url": "https://www.111motorcars.com/inventory",
    "inventory_count": 45,
    "last_inventory_sync": "2025-12-11T20:00:00Z",
    "catalog_used": "classic.com",
    "extraction_method": "catalog_guided",
    "extraction_confidence": 0.90
  }
}
```

---

## 4. Related Data

### `dealer_inventory` Records
```sql
SELECT 
  vehicle_id,
  asking_price,
  status,
  acquired_via,
  inventory_date
FROM dealer_inventory
WHERE organization_id = '550e8400-e29b-41d4-a716-446655440000'
LIMIT 5;
```

### `vehicles` Linked via `organization_vehicles`
```sql
SELECT 
  v.year,
  v.make,
  v.model,
  v.vin,
  ov.relationship_type,
  ov.status
FROM vehicles v
JOIN organization_vehicles ov ON v.id = ov.vehicle_id
WHERE ov.organization_id = '550e8400-e29b-41d4-a716-446655440000'
LIMIT 10;
```

---

## 5. UI Component Structure

### React/TypeScript Interface

```typescript
interface DealerProfile {
  // Core Info
  id: string;
  name: string;
  type: 'dealer' | 'auction_house';
  dealerLicense?: string;
  
  // Contact
  phone: string;
  email: string;
  website: string;
  
  // Location
  address: string;
  city: string;
  state: string;
  zipCode: string;
  coordinates?: { lat: number; lng: number };
  
  // Business Details
  description: string;
  specialties: string[];
  
  // Images
  logoUrl: string;
  faviconUrl?: string;
  coverImageUrl?: string;
  
  // Discovery
  discoveredVia: string;
  sourceUrl: string;
  geographicKey: string;
  
  // Platform Info
  platform?: string; // "DealerFire", "custom", etc.
  
  // Stats
  inventoryCount: number;
  metadata: {
    inventory_url?: string;
    last_inventory_sync?: string;
    catalog_used?: string;
    extraction_method?: string;
    extraction_confidence?: number;
  };
}
```

---

## 6. Key Features

### ✅ Extracted Data
- Name, logo, license (greenlight signals)
- Contact information
- Location (with potential geocoding)
- Business description (cleaned of boilerplate)
- Specialties
- Platform identification (DealerFire, etc.)

### ✅ Images
- Logo (from Classic.com or dealer site)
- Favicon (from dealer website)
- Cover image (property front, basic extraction)

### ✅ Relationships
- Linked to vehicles via `organization_vehicles`
- Inventory tracked in `dealer_inventory`
- Discovery attribution via `source_url`

### ✅ Platform Recognition
- Detects DealerFire/DealerSocket platforms
- Reuses catalog structure across platform
- Excludes platform boilerplate from descriptions

---

## 7. Profile Completeness Example

### Current Extraction (46.2% complete)
- ✅ Name
- ✅ Phone
- ✅ Website
- ✅ Logo URL
- ✅ Inventory URL
- ⚠️ Email (extracted but needs cleaning)
- ❌ Address
- ❌ City
- ❌ State
- ❌ Dealer License
- ❌ Description (needs boilerplate removal)
- ❌ Specialties

### Target (90%+ complete)
- ✅ All above fields
- ✅ Clean email (boilerplate removed)
- ✅ Address, city, state extracted
- ✅ Dealer license extracted
- ✅ Description cleaned of "DealerFire" boilerplate
- ✅ Specialties array populated

---

## 8. Benefits of Structure-First Approach

### For 111 Motorcars
- Profile extracted using verified catalog
- Platform (DealerFire) detected
- Boilerplate automatically excluded
- Consistent data structure

### For Other DealerFire Dealers
- Same catalog structure works
- Consistent extraction quality
- Platform boilerplate handled uniformly
- Faster import (catalog reuse)

---

This profile demonstrates the structure-first extraction approach in action: catalog once, extract systematically, reuse across similar platforms.

