# Database Insertion Targets

## Overview

This document defines the exact database insertions required for the organization and vehicle ingestion workflow. It specifies which tables receive data, which columns are populated, and how conflicts are resolved.

## Workflow Sequence

1. **Insert/Update Organization** → `businesses` table
2. **Insert/Update Vehicles** → `vehicles` table  
3. **Link Organization to Vehicles** → `organization_vehicles` table

---

## 1. Organization Insertion: `businesses` Table

### Target Table
```sql
public.businesses
```

### Required Fields (from scraping)
- `business_name` (TEXT, NOT NULL) - Primary identifier
- `website` (TEXT, NOT NULL, UNIQUE) - Used for conflict detection
- `description` (TEXT) - Business description
- `email` (TEXT) - Contact email
- `phone` (TEXT) - Contact phone
- `address` (TEXT) - Street address
- `city` (TEXT) - City
- `state` (TEXT) - State/Province
- `zip_code` (TEXT) - Postal code
- `logo_url` (TEXT) - Organization logo URL
- `metadata` (JSONB) - Scraping metadata (scraped_at, source_html_title, etc.)

### Optional Fields (if available from scraping)
- `latitude` (NUMERIC(10,8)) - GPS latitude
- `longitude` (NUMERIC(11,8)) - GPS longitude
- `business_type` (TEXT) - Type of business (restoration_shop, dealership, etc.)
- `industry_focus` (TEXT[]) - Array of industry focuses
- `specializations` (TEXT[]) - Array of specializations
- `services_offered` (TEXT[]) - Array of services

### Conflict Resolution Strategy
**UNIQUE constraint on `website`** - Use `ON CONFLICT (website) DO UPDATE` to merge data:

```sql
INSERT INTO public.businesses (
  business_name,
  website,
  description,
  email,
  phone,
  address,
  city,
  state,
  zip_code,
  logo_url,
  latitude,
  longitude,
  metadata
)
VALUES (
  $1, -- business_name
  $2, -- website (UNIQUE key)
  $3, -- description
  $4, -- email
  $5, -- phone
  $6, -- address
  $7, -- city
  $8, -- state
  $9, -- zip_code
  $10, -- logo_url
  $11, -- latitude
  $12, -- longitude
  $13  -- metadata (JSONB)
)
ON CONFLICT (website) DO UPDATE SET
  business_name = EXCLUDED.business_name,
  description = COALESCE(EXCLUDED.description, businesses.description),
  email = COALESCE(EXCLUDED.email, businesses.email),
  phone = COALESCE(EXCLUDED.phone, businesses.phone),
  address = COALESCE(EXCLUDED.address, businesses.address),
  city = COALESCE(EXCLUDED.city, businesses.city),
  state = COALESCE(EXCLUDED.state, businesses.state),
  zip_code = COALESCE(EXCLUDED.zip_code, businesses.zip_code),
  logo_url = COALESCE(EXCLUDED.logo_url, businesses.logo_url),
  latitude = COALESCE(EXCLUDED.latitude, businesses.latitude),
  longitude = COALESCE(EXCLUDED.longitude, businesses.longitude),
  metadata = businesses.metadata || EXCLUDED.metadata, -- Merge JSONB
  updated_at = NOW()
RETURNING id; -- CRITICAL: Return organization_id for vehicle linking
```

### Return Value
**Must capture `id` (UUID)`** - This is the `organization_id` used in subsequent insertions.

---

## 2. Vehicle Insertion: `vehicles` Table

### Target Table
```sql
public.vehicles
```

### Required Fields (from scraping)
- `make` (TEXT, NOT NULL) - Vehicle manufacturer
- `model` (TEXT, NOT NULL) - Vehicle model
- `year` (INTEGER) - Vehicle year
- `source_url` (TEXT) - Original listing URL (stored in `discovery_url` or `platform_url`)
- `description` (TEXT) - Vehicle description (stored in `notes`)
- `image_urls` (JSONB) - Array of image URLs (stored in `vehicle_images` table separately)
- `price` (NUMERIC) - Vehicle price (stored in `asking_price`)
- `status` (TEXT) - Vehicle status (stored in `notes` or `metadata`)
- `vin` (TEXT, UNIQUE) - VIN if available

### Optional Fields (if available from scraping)
- `series` (TEXT) - Model series
- `trim_level` (TEXT) - Trim level
- `color` (TEXT) - Vehicle color
- `mileage` (INTEGER) - Odometer reading
- `fuel_type` (TEXT) - Fuel type
- `transmission` (TEXT) - Transmission type
- `engine` (TEXT) - Engine description
- `body_style` (TEXT) - Body style
- `condition_rating` (INTEGER) - Condition rating (1-10)

### Conflict Resolution Strategy
**UNIQUE constraint on `vin`** (if VIN is available), otherwise use `source_url` + `model` as composite key:

```sql
-- If VIN is available:
INSERT INTO public.vehicles (
  make,
  model,
  year,
  vin,
  discovery_url,
  platform_url,
  asking_price,
  notes,
  metadata
)
VALUES (
  $1, -- make
  $2, -- model
  $3, -- year
  $4, -- vin (UNIQUE if provided)
  $5, -- discovery_url (source_url from scraping)
  $6, -- platform_url (same as discovery_url)
  $7, -- asking_price (price from scraping)
  $8, -- notes (description from scraping)
  $9  -- metadata (JSONB with status, image_urls, etc.)
)
ON CONFLICT (vin) DO UPDATE SET
  make = EXCLUDED.make,
  model = EXCLUDED.model,
  year = COALESCE(EXCLUDED.year, vehicles.year),
  asking_price = COALESCE(EXCLUDED.asking_price, vehicles.asking_price),
  notes = COALESCE(EXCLUDED.notes, vehicles.notes),
  metadata = vehicles.metadata || EXCLUDED.metadata,
  updated_at = NOW()
RETURNING id;

-- If VIN is NOT available, check for existing vehicle by source_url + model:
-- First, check if vehicle exists:
-- SELECT id FROM vehicles WHERE discovery_url = $source_url AND model = $model
-- If exists, UPDATE; otherwise INSERT
```

### Image Handling
**Separate table insertion** - Vehicle images are stored in `vehicle_images` table:

```sql
-- After vehicle insertion, for each image_url:
INSERT INTO public.vehicle_images (
  vehicle_id,
  image_url,
  category,
  uploaded_at
)
VALUES (
  $vehicle_id, -- From previous INSERT
  $image_url, -- From scraped vehicle.image_urls[]
  'exterior', -- Default category
  NOW()
)
ON CONFLICT DO NOTHING; -- Prevent duplicate images
```

### Return Value
**Must capture `id` (UUID)** - This is the `vehicle_id` used in organization-vehicle linking.

---

## 3. Organization-Vehicle Linking: `organization_vehicles` Table

### Target Table
```sql
public.organization_vehicles
```

### Required Fields
- `organization_id` (UUID, FK → `businesses.id`) - From step 1
- `vehicle_id` (UUID, FK → `vehicles.id`) - From step 2
- `relationship_type` (TEXT, NOT NULL) - Relationship type (see allowed values below)
- `status` (TEXT, DEFAULT 'active') - Link status
- `auto_tagged` (BOOLEAN, DEFAULT false) - Set to `false` for manual ingestion
- `linked_by_user_id` (UUID, FK → `auth.users.id`) - User who initiated ingestion (if available)

### Allowed `relationship_type` Values
- `'owner'` - Organization owns the vehicle
- `'consigner'` - Vehicle is consigned to organization
- `'service_provider'` - Organization provides services for vehicle
- `'work_location'` - Vehicle is at organization's location
- `'seller'` - Organization is selling the vehicle
- `'buyer'` - Organization is buying the vehicle
- `'parts_supplier'` - Organization supplies parts for vehicle
- `'fabricator'` - Organization fabricates parts for vehicle
- `'painter'` - Organization paints the vehicle
- `'upholstery'` - Organization does upholstery work
- `'transport'` - Organization transports the vehicle
- `'storage'` - Organization stores the vehicle
- `'inspector'` - Organization inspects the vehicle
- `'collaborator'` - General collaboration relationship

### Default Relationship Type
For ingestion from organization websites, use: **`'owner'`** or **`'seller'`** (depending on context - if vehicles are listed for sale, use `'seller'`; if they're part of the organization's inventory, use `'owner'`).

### Conflict Resolution Strategy
**UNIQUE constraint on `(organization_id, vehicle_id, relationship_type)`**:

```sql
INSERT INTO public.organization_vehicles (
  organization_id,
  vehicle_id,
  relationship_type,
  status,
  auto_tagged,
  linked_by_user_id
)
VALUES (
  $1, -- organization_id (from businesses INSERT)
  $2, -- vehicle_id (from vehicles INSERT)
  $3, -- relationship_type ('owner' or 'seller' for ingestion)
  'active',
  false, -- Manual ingestion, not auto-tagged
  $4   -- linked_by_user_id (if available, otherwise NULL)
)
ON CONFLICT (organization_id, vehicle_id, relationship_type) DO UPDATE SET
  status = 'active',
  updated_at = NOW();
```

### Return Value
No return value needed - this is a linking table.

---

## Complete Insertion Flow

### Step-by-Step SQL Execution

```sql
-- STEP 1: Insert/Update Organization
WITH org_insert AS (
  INSERT INTO public.businesses (
    business_name, website, description, email, phone,
    address, city, state, zip_code, logo_url, metadata
  )
  VALUES (
    'Velocity Restorations',
    'https://www.velocityrestorations.com/',
    'Velocity Restorations is the nation''s leading builder...',
    'info@velocityrestorations.com',
    '(850) 332-6482',
    '2000 Commerce Dr',
    'Pensacola',
    'FL',
    '32505',
    'https://www.velocityrestorations.com/logo.png',
    '{"scraped_at": "2024-01-15T10:00:00Z", "source": "scrape-org"}'::jsonb
  )
  ON CONFLICT (website) DO UPDATE SET
    business_name = EXCLUDED.business_name,
    description = COALESCE(EXCLUDED.description, businesses.description),
    email = COALESCE(EXCLUDED.email, businesses.email),
    phone = COALESCE(EXCLUDED.phone, businesses.phone),
    address = COALESCE(EXCLUDED.address, businesses.address),
    city = COALESCE(EXCLUDED.city, businesses.city),
    state = COALESCE(EXCLUDED.state, businesses.state),
    zip_code = COALESCE(EXCLUDED.zip_code, businesses.zip_code),
    logo_url = COALESCE(EXCLUDED.logo_url, businesses.logo_url),
    metadata = businesses.metadata || EXCLUDED.metadata,
    updated_at = NOW()
  RETURNING id AS org_id
)
-- STEP 2: Insert/Update Vehicle (for each vehicle)
INSERT INTO public.vehicles (
  make, model, year, vin, discovery_url, platform_url,
  asking_price, notes, metadata
)
VALUES (
  'Ford',
  'Bronco',
  1970,
  '1234567890ABCDEF', -- If available
  'https://www.velocityrestorations.com/vehicles/1970-bronco',
  'https://www.velocityrestorations.com/vehicles/1970-bronco',
  250000.00,
  'Fully restored 1970 Ford Bronco with modern amenities.',
  '{"status": "available", "image_urls": ["https://..."]}'::jsonb
)
ON CONFLICT (vin) DO UPDATE SET
  make = EXCLUDED.make,
  model = EXCLUDED.model,
  year = COALESCE(EXCLUDED.year, vehicles.year),
  asking_price = COALESCE(EXCLUDED.asking_price, vehicles.asking_price),
  notes = COALESCE(EXCLUDED.notes, vehicles.notes),
  metadata = vehicles.metadata || EXCLUDED.metadata,
  updated_at = NOW()
RETURNING id AS vehicle_id;

-- STEP 3: Link Organization to Vehicle
INSERT INTO public.organization_vehicles (
  organization_id,
  vehicle_id,
  relationship_type,
  status,
  auto_tagged
)
VALUES (
  (SELECT org_id FROM org_insert),
  (SELECT vehicle_id FROM vehicle_insert),
  'owner', -- or 'seller' depending on context
  'active',
  false
)
ON CONFLICT (organization_id, vehicle_id, relationship_type) DO UPDATE SET
  status = 'active',
  updated_at = NOW();

-- STEP 4: Insert Vehicle Images (for each image_url)
INSERT INTO public.vehicle_images (
  vehicle_id,
  image_url,
  category,
  uploaded_at
)
VALUES (
  (SELECT vehicle_id FROM vehicle_insert),
  'https://www.velocityrestorations.com/vehicle-image-1.jpg',
  'exterior',
  NOW()
)
ON CONFLICT DO NOTHING;
```

---

## Data Mapping: Scraped Data → Database Fields

### Organization Mapping
| Scraped Field | Database Table | Database Column | Notes |
|--------------|----------------|-----------------|-------|
| `business_name` | `businesses` | `business_name` | Direct mapping |
| `website` | `businesses` | `website` | Used for conflict detection |
| `description` | `businesses` | `description` | Direct mapping |
| `email` | `businesses` | `email` | Direct mapping |
| `phone` | `businesses` | `phone` | Direct mapping |
| `address` | `businesses` | `address` | Direct mapping |
| `city` | `businesses` | `city` | Direct mapping |
| `state` | `businesses` | `state` | Direct mapping |
| `zip_code` | `businesses` | `zip_code` | Direct mapping |
| `logo_url` | `businesses` | `logo_url` | Direct mapping |
| `metadata` | `businesses` | `metadata` | JSONB merge |

### Vehicle Mapping
| Scraped Field | Database Table | Database Column | Notes |
|--------------|----------------|-----------------|-------|
| `year` | `vehicles` | `year` | Direct mapping |
| `make` | `vehicles` | `make` | Direct mapping |
| `model` | `vehicles` | `model` | Direct mapping |
| `vin` | `vehicles` | `vin` | If available, used for conflict detection |
| `description` | `vehicles` | `notes` | Vehicle description |
| `source_url` | `vehicles` | `discovery_url` | Original listing URL |
| `source_url` | `vehicles` | `platform_url` | Same as discovery_url |
| `price` | `vehicles` | `asking_price` | Vehicle price |
| `status` | `vehicles` | `metadata->>'status'` | Stored in metadata JSONB |
| `image_urls[]` | `vehicle_images` | `image_url` | Separate table, one row per image |
| `metadata` | `vehicles` | `metadata` | JSONB merge |

---

## Error Handling

### Missing Required Fields
- **Organization**: If `business_name` or `website` is missing, skip insertion and log error
- **Vehicle**: If `make` or `model` is missing, skip insertion and log error

### Constraint Violations
- **UNIQUE constraint on `businesses.website`**: Use `ON CONFLICT` to update existing record
- **UNIQUE constraint on `vehicles.vin`**: Use `ON CONFLICT` to update existing record
- **UNIQUE constraint on `organization_vehicles`**: Use `ON CONFLICT` to reactivate link

### NULL Handling
- Use `COALESCE()` in `ON CONFLICT` clauses to preserve existing values when new values are NULL
- Only update fields that have non-NULL values from scraping

---

## Summary

**Three primary insertions per ingestion:**
1. **1 INSERT** into `businesses` (with conflict resolution on `website`)
2. **N INSERTs** into `vehicles` (one per vehicle, with conflict resolution on `vin` or `discovery_url` + `model`)
3. **N INSERTs** into `organization_vehicles` (one per vehicle, linking org to vehicle)
4. **M INSERTs** into `vehicle_images` (one per image URL per vehicle)

**Key Principles:**
- Extract 100% of available data (don't force 100% schema coverage)
- Use `ON CONFLICT` for idempotent insertions
- Preserve existing data when new data is NULL (`COALESCE`)
- Merge JSONB metadata instead of overwriting
- Always capture returned `id` values for foreign key relationships

