# Classic.com Dealer Indexing - Success Metrics & Measurement Plan

## Intended Results

### Primary Goals

1. **Complete Dealer Discovery**: Automatically discover and index all dealers and auction houses listed on Classic.com's dealer directory (`/dealers` and `/data` pages)

2. **Accurate Organization Creation**: Create organization records with proper deduplication logic:
   - Match by dealer license (strongest signal - unique identifier)
   - Match by website URL (same website = same entity)
   - Geographic matching by name + city + state (prevents mixing franchise locations)

3. **Rich Organization Profiles**: Each organization should have:
   - Name, address, phone, email, website
   - Dealer license number (greenlight signal)
   - Logo stored as favicon in Supabase Storage
   - Business type (dealer vs auction_house) correctly identified

4. **Inventory Aggregation**: For each dealer, extract and store their full inventory:
   - Dealers: Store in `dealer_inventory` table with status, pricing
   - Auction Houses: Structure as `auction_events` and `auction_lots` (future implementation)

5. **Data Quality**: All organizations should have "greenlight signals":
   - ✅ Name
   - ✅ Logo/Image
   - ✅ Dealer License

## Success Metrics

### 1. Discovery & Coverage Metrics

```sql
-- Total dealers discovered from Classic.com
SELECT COUNT(*) 
FROM businesses 
WHERE discovered_via = 'classic_com_indexing';

-- Success rate: profiles with greenlight signals
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN dealer_license IS NOT NULL THEN 1 END) as with_license,
  COUNT(CASE WHEN logo_url IS NOT NULL THEN 1 END) as with_logo,
  COUNT(CASE WHEN dealer_license IS NOT NULL AND logo_url IS NOT NULL THEN 1 END) as complete
FROM businesses 
WHERE discovered_via = 'classic_com_indexing';
```

**Target**: 
- Discover 500+ dealers from Classic.com directory
- 80%+ have all greenlight signals (name, logo, license)

### 2. Deduplication Metrics

```sql
-- Check for duplicate organizations (same license, different records)
SELECT dealer_license, COUNT(*) as count
FROM businesses 
WHERE dealer_license IS NOT NULL 
  AND discovered_via = 'classic_com_indexing'
GROUP BY dealer_license 
HAVING COUNT(*) > 1;

-- Check for same website, different records
SELECT website, COUNT(*) as count
FROM businesses 
WHERE website IS NOT NULL 
  AND discovered_via = 'classic_com_indexing'
GROUP BY website 
HAVING COUNT(*) > 1;
```

**Target**: 
- 0 duplicate organizations with same dealer license
- < 5% false positives (same website, legitimately different orgs)

### 3. Inventory Extraction Metrics

```sql
-- Inventory records created per dealer
SELECT 
  b.business_name,
  b.type,
  COUNT(DI.id) as inventory_count,
  COUNT(DISTINCT DI.vehicle_id) as unique_vehicles
FROM businesses b
LEFT JOIN dealer_inventory DI ON DI.dealer_id = b.id
WHERE b.discovered_via = 'classic_com_indexing'
GROUP BY b.id, b.business_name, b.type
ORDER BY inventory_count DESC;

-- Total inventory extracted
SELECT 
  COUNT(*) as total_inventory_records,
  COUNT(DISTINCT dealer_id) as dealers_with_inventory,
  COUNT(DISTINCT vehicle_id) as unique_vehicles,
  AVG(asking_price) as avg_price
FROM dealer_inventory di
JOIN businesses b ON b.id = di.dealer_id
WHERE b.discovered_via = 'classic_com_indexing';
```

**Target**: 
- 70%+ of dealers have inventory extracted
- Average 10+ vehicles per dealer (varies by dealer type)
- 0 duplicate vehicles per dealer

### 4. Data Quality Metrics

```sql
-- Organization completeness score
SELECT 
  business_name,
  CASE 
    WHEN dealer_license IS NOT NULL THEN 1 ELSE 0 END +
  CASE 
    WHEN logo_url IS NOT NULL THEN 1 ELSE 0 END +
  CASE 
    WHEN website IS NOT NULL THEN 1 ELSE 0 END +
  CASE 
    WHEN phone IS NOT NULL THEN 1 ELSE 0 END +
  CASE 
    WHEN address IS NOT NULL THEN 1 ELSE 0 END as completeness_score
FROM businesses 
WHERE discovered_via = 'classic_com_indexing'
ORDER BY completeness_score DESC;

-- Logo storage success
SELECT 
  COUNT(*) as total_orgs,
  COUNT(CASE WHEN logo_url LIKE '%supabase.co%' THEN 1 END) as logos_in_storage,
  COUNT(CASE WHEN logo_url LIKE '%classic.com%' THEN 1 END) as logos_still_external
FROM businesses 
WHERE discovered_via = 'classic_com_indexing' 
  AND logo_url IS NOT NULL;
```

**Target**: 
- 80%+ organizations have completeness_score >= 4 (out of 5)
- 90%+ logos successfully stored in Supabase Storage (not external URLs)

### 5. Business Type Classification

```sql
-- Verify dealers vs auction houses
SELECT 
  type,
  COUNT(*) as count,
  COUNT(CASE WHEN dealer_license IS NOT NULL THEN 1 END) as with_license
FROM businesses 
WHERE discovered_via = 'classic_com_indexing'
GROUP BY type;
```

**Target**: 
- Correctly classify dealers vs auction houses (manual spot check)
- Auction houses have appropriate structure (future: auction_events/auction_lots)

### 6. Processing Success Rate

```sql
-- Check import_queue success rate for inventory extraction
SELECT 
  status,
  COUNT(*) as count,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () as percentage
FROM import_queue
WHERE raw_data->>'inventory_extraction' = 'true'
  OR raw_data->>'organization_id' IS NOT NULL
GROUP BY status;
```

**Target**: 
- 85%+ of inventory extraction queue items marked as 'complete'
- < 10% failed items
- < 5% pending items after 24 hours

## Validation Tests

### Test 1: Single Dealer Profile Indexing
```bash
# Test with known dealer
node scripts/index-classic-com-dealers.js https://www.classic.com/s/111-motorcars-ZnQygen/

# Verify:
# ✅ Organization created/found
# ✅ Logo downloaded and stored
# ✅ Inventory extraction queued
# ✅ dealer_inventory records created
```

### Test 2: Directory Scraping
```bash
# Scrape directory
node scripts/index-classic-com-dealers.js

# Verify:
# ✅ Multiple dealer URLs extracted
# ✅ Each URL successfully indexed
# ✅ No duplicate organizations created
```

### Test 3: Deduplication Logic
```sql
-- Manually test: Try indexing same dealer twice
-- Should find existing, not create duplicate

-- Test geographic separation: Same name, different city
-- Should create separate organizations
```

### Test 4: Inventory Extraction
```sql
-- After indexing, check inventory was extracted
SELECT 
  b.business_name,
  COUNT(di.id) as inventory_count
FROM businesses b
LEFT JOIN dealer_inventory di ON di.dealer_id = b.id
WHERE b.discovered_via = 'classic_com_indexing'
  AND b.id = '<test_org_id>'
GROUP BY b.id, b.business_name;
```

## Measurement Dashboard Queries

### Overall Health Check
```sql
SELECT 
  'Total Organizations' as metric,
  COUNT(*)::text as value
FROM businesses 
WHERE discovered_via = 'classic_com_indexing'

UNION ALL

SELECT 
  'With Greenlight Signals' as metric,
  COUNT(*)::text as value
FROM businesses 
WHERE discovered_via = 'classic_com_indexing'
  AND dealer_license IS NOT NULL
  AND logo_url IS NOT NULL

UNION ALL

SELECT 
  'Total Inventory Records' as metric,
  COUNT(*)::text as value
FROM dealer_inventory di
JOIN businesses b ON b.id = di.dealer_id
WHERE b.discovered_via = 'classic_com_indexing'

UNION ALL

SELECT 
  'Dealers with Inventory' as metric,
  COUNT(DISTINCT dealer_id)::text as value
FROM dealer_inventory di
JOIN businesses b ON b.id = di.dealer_id
WHERE b.discovered_via = 'classic_com_indexing';
```

## Success Criteria Summary

| Metric | Target | Measurement |
|--------|--------|-------------|
| Dealers Discovered | 500+ | COUNT from businesses table |
| Greenlight Signal Rate | 80%+ | Name + Logo + License present |
| Deduplication Accuracy | < 1% duplicates | Same license/website = same org |
| Inventory Extraction Rate | 70%+ dealers | dealer_inventory records exist |
| Logo Storage Success | 90%+ | Stored in Supabase, not external |
| Data Completeness | 80%+ score >= 4/5 | Fields populated |
| Processing Success | 85%+ complete | import_queue status = 'complete' |

## Next Steps After Initial Indexing

1. **Monitor for New Dealers**: Run directory scraper periodically to discover new dealers
2. **Inventory Refresh**: Re-scrape dealer websites every 24-48 hours to update inventory
3. **Quality Assurance**: Manual spot checks of random dealers to verify accuracy
4. **Auction House Implementation**: Complete auction_events/auction_lots structure for auction houses

