# Data Quality Improvement Plan

## Critical Issues Found

### 1. Schema Mismatch (CRITICAL)
- **Issue**: 532 tables defined in migrations but only 10 exist remotely
- **Impact**: Missing core functionality, data relationships broken
- **Solution**: Need to run migrations or clean up unused migration files

### 2. Vehicle Data Quality Issues

#### High Priority (>50% affected)
- **Missing Price**: 100% of vehicles have no price data
- **Missing Location**: 100% of vehicles have no location data
- **Invalid VINs**: 54% have incorrect VIN format (not 17 chars)

#### Medium Priority (10-50% affected)
- **Missing Mileage**: 12% have no mileage data
- **Low Image Coverage**: Only 26 of 10,565 vehicles have images

#### Low Priority (<10% affected)
- **Missing VINs**: 2% have no VIN at all
- **Missing Year**: 1% have no year

## Immediate Actions Required

### Step 1: Fix Schema Issues
```bash
# Option A: Run missing migrations
supabase db push --project-ref qkgaybvrernstplzjaam

# Option B: Clean up unused migrations
# Move unused migrations to archive folder
```

### Step 2: VIN Data Cleanup
```sql
-- Fix invalid VINs (not 17 characters)
UPDATE vehicles
SET vin = NULL,
    vin_confidence = 0,
    quality_issues = jsonb_set(
      COALESCE(quality_issues, '{}'::jsonb),
      '{invalid_vin}',
      'true'
    )
WHERE vin IS NOT NULL
  AND LENGTH(vin) != 17;
```

### Step 3: Enrich Location Data
```javascript
// Script to geocode BAT listings
const enrichBATLocations = async () => {
  const vehicles = await getVehiclesWithBATData();
  for (const vehicle of vehicles) {
    if (vehicle.bat_location && !vehicle.city) {
      // Parse BAT location string
      const location = parseBATLocation(vehicle.bat_location);
      await updateVehicleLocation(vehicle.id, location);
    }
  }
};
```

### Step 4: Price Data Recovery
```sql
-- Populate price from BAT data
UPDATE vehicles
SET price = CASE
  WHEN high_bid > 0 THEN high_bid
  WHEN sale_price > 0 THEN sale_price
  WHEN asking_price > 0 THEN asking_price
  ELSE NULL
END
WHERE price IS NULL OR price = 0;
```

### Step 5: Image Coverage Improvement
- Implement automated image scraping for vehicles without images
- Use discovery_url to fetch images from source
- Prioritize high-value vehicles first

## Long-term Improvements

### 1. Data Validation Rules
- Implement database constraints for critical fields
- Add triggers to validate VINs on insert/update
- Require location data for new entries

### 2. Data Quality Monitoring
- Create daily quality reports
- Alert on quality degradation
- Track improvement metrics

### 3. Field Consolidation
- Many duplicate/similar fields (e.g., multiple price fields)
- Standardize on single source of truth
- Remove unused fields (200+ fields with 0% population)

### 4. Automated Enrichment Pipeline
- VIN decoder integration
- Location geocoding service
- Price estimation models
- Image extraction from listings

## Success Metrics

| Metric | Current | Target | Timeline |
|--------|---------|--------|----------|
| Valid VINs | 44% | 95% | 2 weeks |
| Price Coverage | 0% | 80% | 1 week |
| Location Coverage | 0% | 90% | 1 week |
| Image Coverage | 0.25% | 50% | 1 month |
| Schema Alignment | 2% | 100% | 1 week |

## Next Steps

1. **Immediate**: Back up database before making changes
2. **Today**: Fix schema mismatch issue
3. **This Week**: Clean VIN data and populate prices
4. **This Month**: Implement automated enrichment

## Risk Mitigation

- Test all changes in staging first
- Keep audit log of all data modifications
- Implement rollback procedures
- Monitor application for breaks after schema changes