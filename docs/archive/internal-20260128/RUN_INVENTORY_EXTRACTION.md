# Run Inventory Extraction

## Quick Start

**164 organizations** have zero vehicles. Extract inventory from all of them:

### Via Supabase Dashboard (Easiest)

1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/functions
2. Find `extract-all-orgs-inventory`
3. Click "Invoke Function"
4. Use this payload:

```json
{
  "limit": 10,
  "offset": 0,
  "min_vehicle_threshold": 1,
  "dry_run": false
}
```

5. Click "Invoke"
6. Check logs to see progress

### Via Command Line

```bash
# Set your env vars first
export SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Run extraction (first 10 orgs)
curl -X POST "${SUPABASE_URL}/functions/v1/extract-all-orgs-inventory" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 10,
    "offset": 0,
    "min_vehicle_threshold": 1,
    "dry_run": false
  }'
```

### Via npm script

```bash
# Make sure env vars are set
npm run extract-all-orgs -- --limit 10 --threshold 1
```

## Workflow

### Step 1: Extract Data (Skip Images)

This creates vehicle profiles quickly with external image URLs:

```bash
# Process 10 organizations at a time
# Start with first 10
curl -X POST "${SUPABASE_URL}/functions/v1/extract-all-orgs-inventory" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"limit": 10, "offset": 0, "min_vehicle_threshold": 1}'

# Continue with next 10
curl -X POST "${SUPABASE_URL}/functions/v1/extract-all-orgs-inventory" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"limit": 10, "offset": 10, "min_vehicle_threshold": 1}'

# Continue until all 164 are processed
```

### Step 2: Trickle Backfill Images (Optional, Later)

After vehicles are extracted, download images gradually:

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/trickle-backfill-images" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 500,
    "batch_size": 20,
    "max_images_per_vehicle": 20
  }'
```

## Parameters

- **`limit`**: Number of organizations to process (default: 10)
- **`offset`**: Start from this organization (default: 0)
- **`min_vehicle_threshold`**: Only process orgs with fewer vehicles than this (default: 10)
- **`business_type`**: Filter by business type (optional, e.g., "dealer")
- **`dry_run`**: Preview without extracting (default: false)

## Expected Results

- Each organization: 10-500 vehicles (varies by org size)
- Total potential: 1,640 - 82,000 vehicles from 164 orgs with zero vehicles
- Images: Created as external URLs first, downloaded gradually

## Monitor Progress

```sql
-- Check organizations with zero vehicles
SELECT COUNT(*) as orgs_with_zero_vehicles
FROM (
  SELECT 
    b.id,
    COUNT(DISTINCT ov.vehicle_id) as vehicle_count
  FROM businesses b
  LEFT JOIN organization_vehicles ov ON ov.organization_id = b.id AND ov.status = 'active'
  WHERE b.is_public = true 
    AND b.website IS NOT NULL 
    AND b.website != ''
  GROUP BY b.id
  HAVING COUNT(DISTINCT ov.vehicle_id) = 0
) subq;

-- Check total vehicles
SELECT COUNT(*) as total_vehicles FROM vehicles WHERE is_public = true;
```

