# Organization Ingestion Workflow

## Overview

Streamlined DB-first approach for ingesting organizations and their vehicles from websites.

**Key Principles:**
- Extract 100% of available data (don't force 100% schema coverage)
- Map DOM structure to DB fields accurately
- Get orgs first, then get their vehicles
- Use MCP tools for database insertion

## Architecture

```
Website URL
    ↓
scrape-org Edge Function (extracts data)
    ↓
JSON Response (org + vehicles)
    ↓
MCP Supabase Tools (inserts into DB)
    ↓
businesses + vehicles + organization_vehicles tables
```

## Components

### 1. Edge Function: `scrape-org`

**Location:** `supabase/functions/scrape-org/index.ts`

**Purpose:** Extract organization and vehicle data from websites

**Input:**
```json
{
  "url": "https://www.velocityrestorations.com/"
}
```

**Output:**
```json
{
  "success": true,
  "org": {
    "business_name": "Velocity Restorations",
    "website": "https://www.velocityrestorations.com/",
    "description": "...",
    "email": "...",
    "phone": "...",
    "address": "...",
    "city": "...",
    "state": "...",
    "logo_url": "...",
    "metadata": {}
  },
  "vehicles": [
    {
      "year": 1975,
      "make": "BMW",
      "model": "2002",
      "description": "...",
      "price": 45000,
      "status": "for_sale",
      "image_urls": ["..."],
      "source_url": "...",
      "metadata": {}
    }
  ],
  "stats": {
    "org_fields_extracted": 8,
    "vehicles_found": 12,
    "vehicles_with_images": 10
  }
}
```

### 2. MCP Tools for Database Insertion

Use Supabase MCP tools to insert the scraped data:

#### Insert Organization

```typescript
// Using mcp_supabase_execute_sql
const orgSQL = `
  INSERT INTO businesses (
    business_name, website, description, email, phone,
    address, city, state, zip_code, logo_url, metadata
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
  )
  ON CONFLICT (website) DO UPDATE SET
    business_name = COALESCE(EXCLUDED.business_name, businesses.business_name),
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
  RETURNING id;
`;
```

#### Insert Vehicles

```typescript
// For each vehicle
const vehicleSQL = `
  WITH inserted_vehicle AS (
    INSERT INTO vehicles (
      year, make, model, description, vin, asking_price,
      discovery_url, origin_metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8
    )
    ON CONFLICT (vin) DO UPDATE SET
      year = COALESCE(EXCLUDED.year, vehicles.year),
      make = COALESCE(EXCLUDED.make, vehicles.make),
      model = COALESCE(EXCLUDED.model, vehicles.model),
      description = COALESCE(EXCLUDED.description, vehicles.description),
      asking_price = COALESCE(EXCLUDED.asking_price, vehicles.asking_price),
      origin_metadata = vehicles.origin_metadata || EXCLUDED.origin_metadata,
      updated_at = NOW()
    RETURNING id
  )
  INSERT INTO organization_vehicles (
    organization_id, vehicle_id, relationship_type, status, auto_tagged, metadata
  )
  SELECT 
    $9::uuid,  -- organization_id
    inserted_vehicle.id,
    'inventory',
    $10,  -- status: 'active' or 'past'
    true,
    $11::jsonb  -- metadata
  FROM inserted_vehicle
  ON CONFLICT (organization_id, vehicle_id, relationship_type) DO UPDATE SET
    status = EXCLUDED.status,
    metadata = organization_vehicles.metadata || EXCLUDED.metadata,
    updated_at = NOW()
  RETURNING vehicle_id;
`;
```

## Usage

### Option 1: Using the Helper Script

```bash
# Deploy the edge function first
supabase functions deploy scrape-org

# Run the ingestion script
deno run --allow-net --allow-env scripts/ingest-org-via-mcp.ts https://www.velocityrestorations.com/
```

### Option 2: Manual Workflow

1. **Scrape the organization:**
   ```bash
   curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/scrape-org \
     -H "Authorization: Bearer YOUR_ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://www.velocityrestorations.com/"}'
   ```

2. **Use MCP tools to insert:**
   - Use `mcp_supabase_execute_sql` with the generated SQL
   - Or use the MCP CLI tool directly

### Option 3: Programmatic (from AI Assistant)

The AI assistant can:
1. Call the scrape-org function
2. Use MCP Supabase tools to insert the data directly

Example:
```
1. Scrape: https://www.velocityrestorations.com/
2. Insert org via MCP
3. Insert vehicles via MCP
```

## Data Extraction Strategy

### Organization Data

Extracts:
- Business name (from `<title>`, `<h1>`, or meta tags)
- Website URL
- Description (from meta description or first paragraph)
- Contact info (email, phone)
- Address (parsed from common address patterns)
- Logo (from image tags with "logo" or "brand" in class/id)

### Vehicle Data

Uses multiple extraction patterns:

1. **Year + Make + Model Pattern:**
   - Matches: `1975 BMW 2002`, `2024 Porsche 911`
   - Extracts context for price, status, images

2. **Vehicle Card Pattern:**
   - Looks for common card structures: `div.vehicle-card`, `div.listing-item`
   - Extracts structured data from card HTML

3. **Context Extraction:**
   - Extracts price from `$XX,XXX` patterns
   - Determines status from "SOLD", "FOR SALE" indicators
   - Collects all relevant images

## Database Schema

### businesses table
- `id` (UUID, primary key)
- `business_name` (TEXT)
- `website` (TEXT, UNIQUE)
- `description` (TEXT)
- `email`, `phone` (TEXT)
- `address`, `city`, `state`, `zip_code` (TEXT)
- `logo_url` (TEXT)
- `metadata` (JSONB)

### vehicles table
- `id` (UUID, primary key)
- `year` (INTEGER)
- `make`, `model` (TEXT)
- `description` (TEXT)
- `vin` (TEXT, UNIQUE)
- `asking_price` (DECIMAL)
- `discovery_url` (TEXT)
- `origin_metadata` (JSONB)

### organization_vehicles table
- `id` (UUID, primary key)
- `organization_id` (UUID → businesses.id)
- `vehicle_id` (UUID → vehicles.id)
- `relationship_type` (TEXT: 'inventory', 'owner', etc.)
- `status` (TEXT: 'active', 'past')
- `auto_tagged` (BOOLEAN)
- `metadata` (JSONB)

**Unique constraint:** `(organization_id, vehicle_id, relationship_type)`

## Example: Complete Workflow

### 1. Scrape Organization

```typescript
// Edge Function returns:
{
  "success": true,
  "org": {
    "business_name": "Velocity Restorations",
    "website": "https://www.velocityrestorations.com/",
    "description": "Classic car restoration...",
    "email": "info@velocityrestorations.com",
    "phone": "555-1234",
    "city": "Austin",
    "state": "TX"
  },
  "vehicles": [
    {
      "year": 1975,
      "make": "BMW",
      "model": "2002",
      "price": 45000,
      "status": "for_sale",
      "image_urls": ["https://..."]
    }
  ]
}
```

### 2. Insert via MCP

```sql
-- Insert organization
INSERT INTO businesses (...) VALUES (...) RETURNING id;
-- Result: org_id = 'abc-123-def'

-- Insert vehicle and link
WITH inserted_vehicle AS (
  INSERT INTO vehicles (...) VALUES (...) RETURNING id
)
INSERT INTO organization_vehicles (organization_id, vehicle_id, ...)
SELECT 'abc-123-def'::uuid, inserted_vehicle.id, ...
FROM inserted_vehicle;
```

## Benefits

1. **DB-first approach:** Extracts what's available, doesn't force schema
2. **Scalable:** Edge Function handles scraping, MCP handles DB ops
3. **Streamlined:** Single function, clear workflow
4. **Maintainable:** No technical debt from "300 shitty functions"
5. **Flexible:** MCP tools allow direct SQL control

## Next Steps

1. Deploy the `scrape-org` function
2. Test with sample URLs
3. Use MCP tools to insert data
4. Monitor and refine extraction patterns

