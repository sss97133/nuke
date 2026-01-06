# Bulk Vehicle Extraction Guide

**Goal**: Extract vehicles from all 227 organizations to reach 100k vehicles (currently at 6,092)

## Current Status

- ✅ **227 organizations** with websites
- ❌ **164 organizations** with zero vehicles  
- ✅ **6,092 vehicles** total
- 🎯 **Target: 100,000 vehicles**

## Quick Start

### Extract from All Organizations

```bash
# Process first 10 orgs with < 10 vehicles
npm run extract-all-orgs

# Process all orgs with zero vehicles (in batches)
npm run extract-all-orgs -- --threshold 1 --limit 50
npm run extract-all-orgs -- --threshold 1 --limit 50 --offset 50
npm run extract-all-orgs -- --threshold 1 --limit 50 --offset 100
# ... continue until all 164 are processed

# Then process orgs with few vehicles
npm run extract-all-orgs -- --threshold 10 --limit 50
```

### Extract from Single Organization

```bash
# Run full discovery + extraction for one org
npm run discover-org -- <organization_id>

# Force rediscovery (if site changed)
npm run discover-org -- <organization_id> --force
```

## How It Works

### 1. `extract-all-orgs-inventory`
- Finds organizations needing extraction (prioritizes orgs with no vehicles)
- Processes them one at a time
- Calls `discover-organization-full` for each org

### 2. `discover-organization-full` (per org)
- Discovers site structure using LLM + Firecrawl
- Learns extraction patterns adaptively
- Stores patterns for reuse
- Extracts vehicles and creates profiles
- Links vehicles to organization

### 3. Pattern Learning
- Each org teaches new patterns
- Patterns stored in `source_site_schemas`
- Similar sites reuse patterns (faster extractions)

## Workflow to Reach 100k Vehicles

### Phase 1: Zero-Vehicle Organizations (164 orgs)

```bash
# Batch 1: First 50 orgs with zero vehicles
npm run extract-all-orgs -- --threshold 1 --limit 50 --offset 0

# Batch 2: Next 50
npm run extract-all-orgs -- --threshold 1 --limit 50 --offset 50

# Batch 3: Next 50
npm run extract-all-orgs -- --threshold 1 --limit 50 --offset 100

# Batch 4: Remaining 14
npm run extract-all-orgs -- --threshold 1 --limit 50 --offset 150
```

**Expected**: Each org should yield 10-500 vehicles = **1,640 - 82,000 vehicles**

### Phase 2: Low-Vehicle Organizations

```bash
# Process orgs with < 10 vehicles
npm run extract-all-orgs -- --threshold 10 --limit 50 --offset 0

# Continue in batches until all processed
```

### Phase 3: Monitor & Repeat

```sql
-- Check progress
SELECT 
  COUNT(*) as total_orgs,
  COUNT(CASE WHEN vehicle_count = 0 THEN 1 END) as orgs_with_zero,
  COUNT(CASE WHEN vehicle_count < 10 THEN 1 END) as orgs_under_10,
  SUM(vehicle_count) as total_vehicles
FROM (
  SELECT 
    b.id,
    COUNT(DISTINCT ov.vehicle_id) as vehicle_count
  FROM businesses b
  LEFT JOIN organization_vehicles ov ON ov.organization_id = b.id AND ov.status = 'active'
  WHERE b.is_public = true AND b.website IS NOT NULL
  GROUP BY b.id
) subq;
```

## Key Features

✅ **One org at a time** - Full extraction, no batch issues  
✅ **Adaptive learning** - Gets smarter with each org  
✅ **Pattern reuse** - Similar sites extract faster  
✅ **Vehicle profiles created** - Not just queued, actually created  
✅ **Prioritizes empty orgs** - Focuses on orgs with zero vehicles first  

## Expected Results

- **164 orgs with zero vehicles** → Should yield 1,640 - 82,000 vehicles
- **63 orgs with < 10 vehicles** → Should yield 630 - 31,500 more vehicles
- **Total potential**: 2,270 - 113,500 vehicles
- **Realistic target**: 50k-100k vehicles from all orgs

## Notes

- Processes one org at a time (2-second delay between orgs)
- Each org gets full discovery + extraction
- Patterns learned are stored and reused
- Vehicle profiles created immediately (not just queued)
- Gets easier as patterns are learned (similar sites extract faster)

## Troubleshooting

If an org fails:
1. Check the error in the results
2. Try running `discover-org` directly for that org
3. Check if the website is accessible
4. Some orgs may not have inventory pages (that's OK, skip them)

