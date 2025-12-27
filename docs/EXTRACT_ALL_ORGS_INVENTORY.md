# Extract All Organizations Inventory

Systematic bulk extraction system to extract vehicles from all organizations with websites.

## Current Situation

- **227 organizations** with websites
- **164 organizations** with websites but **zero vehicles**
- **6,092 vehicles** total (target: 100k)
- Need to systematically extract from all sources

## Solution

The `extract-all-orgs-inventory` function processes organizations one at a time, using `discover-organization-full` to:
- Learn site structure adaptively
- Extract all vehicles
- Store patterns for reuse
- Create vehicle profiles

## Usage

### Using the Script

```bash
# Process first 10 orgs with < 10 vehicles
npm run extract-all-orgs

# Process more orgs
npm run extract-all-orgs -- --limit 20

# Process only dealers
npm run extract-all-orgs -- --business-type dealer

# Process orgs with < 5 vehicles
npm run extract-all-orgs -- --threshold 5

# Preview what would be processed (dry run)
npm run extract-all-orgs -- --dry-run

# Continue from where you left off
npm run extract-all-orgs -- --offset 20 --limit 20
```

### Direct API Call

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/extract-all-orgs-inventory" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 10,
    "offset": 0,
    "min_vehicle_threshold": 10,
    "business_type": "dealer"
  }'
```

## Parameters

- **`limit`** (optional): Number of orgs to process (default: 10)
- **`offset`** (optional): Start from this org (default: 0)
- **`min_vehicle_threshold`** (optional): Only process orgs with fewer vehicles than this (default: 10)
- **`business_type`** (optional): Filter by business type (e.g., "dealer", "auction_house")
- **`dry_run`** (optional): Preview without actually extracting (default: false)

## Strategy

1. **Prioritizes orgs with no/few vehicles** (sorted by vehicle_count ASC)
2. **Processes one org at a time** (full extraction per org)
3. **Learns patterns** as it goes (gets smarter)
4. **Reuses patterns** for similar sites
5. **Creates vehicle profiles** immediately

## Workflow to Reach 100k Vehicles

### Step 1: Extract from organizations with no vehicles (164 orgs)

```bash
# Process all orgs with zero vehicles
npm run extract-all-orgs -- --threshold 1 --limit 50

# Continue in batches
npm run extract-all-orgs -- --threshold 1 --limit 50 --offset 50
npm run extract-all-orgs -- --threshold 1 --limit 50 --offset 100
npm run extract-all-orgs -- --threshold 1 --limit 50 --offset 150
```

### Step 2: Extract from organizations with few vehicles

```bash
# Process orgs with < 10 vehicles
npm run extract-all-orgs -- --threshold 10 --limit 50

# Continue until all are processed
```

### Step 3: Monitor Progress

```sql
-- Check how many orgs still need extraction
SELECT 
  COUNT(*) as orgs_needing_extraction,
  SUM(CASE WHEN vehicle_count = 0 THEN 1 ELSE 0 END) as orgs_with_zero_vehicles
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
  HAVING COUNT(DISTINCT ov.vehicle_id) < 10
) subq;

-- Check total vehicle count
SELECT COUNT(*) FROM vehicles WHERE is_public = true;
```

## Expected Results

- **Patterns learned**: Each org teaches the system new extraction patterns
- **Vehicles created**: Each org should yield 10-500+ vehicles (varies by org size)
- **Reusable patterns**: Patterns stored for future use
- **Faster extractions**: Similar sites get faster (patterns reused)

## Notes

- Processes orgs in order of priority (no vehicles first)
- 2-second delay between orgs to avoid rate limiting
- Each org gets full discovery + extraction
- Patterns are stored for reuse
- Vehicle profiles created immediately

