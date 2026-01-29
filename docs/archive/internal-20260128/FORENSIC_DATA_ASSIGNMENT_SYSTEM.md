# Forensic Data Assignment System

## Overview

The Forensic Data Assignment System is an expert-level data quality system designed to handle ambiguous, conflicting, and sloppy vehicle data. It uses multi-signal analysis, evidence hierarchy, consensus building, and anomaly detection to intelligently assign data to the correct fields.

## Core Concepts

### 1. Evidence Collection
Every piece of data is treated as **evidence** with:
- **Source type** (VIN, scraped listing, user input, etc.)
- **Trust level** (0-100, based on source hierarchy)
- **Context clues** (surrounding text, format patterns)
- **Confidence score** (calculated from multiple signals)

### 2. Multi-Signal Analysis
When multiple sources provide data for the same field:
- **Consensus building**: Finds the value with highest agreement
- **Outlier detection**: Identifies conflicting evidence
- **Confidence calculation**: Weighted average of source trust levels

### 3. Forensic Disambiguation
Handles ambiguous values like "350" which could be:
- Engine displacement (350 CID)
- Horsepower (350 HP)
- Paint code (Code 350)
- Model designation

Uses context clues, format patterns, and cross-validation.

### 4. Modification Detection
Compares current values to factory specs (VIN decode):
- Detects modifications (engine swaps, drivetrain conversions)
- Flags conflicts for review
- Suggests timeline events for modifications

### 5. Anomaly Detection
Automatically flags:
- Impossible combinations (K-series with 2WD)
- Temporal errors (C1500 before 1988)
- Statistical outliers (extremely high mileage)
- VIN conflicts (year/model mismatches)

## Database Schema

### Core Tables

#### `data_source_trust_hierarchy`
Defines trust levels for different data sources:
- `vin_checksum_valid`: 100 (absolute truth)
- `nhtsa_vin_decode`: 100 (factory specs)
- `gm_heritage_center`: 95 (factory documentation)
- `auction_result_bat`: 85 (verified sale data)
- `scraped_listing`: 70 (seller-provided)
- `user_input_unverified`: 50 (needs validation)

#### `normalization_rules`
Maps variant spellings to canonical values:
- `4x4`, `4×4`, `four wheel drive` → `4WD`
- `TH350`, `Turbo 350` → `3-Speed Automatic`
- `K10`, `K/K10` → `K10` (series)

#### `field_evidence`
Tracks all evidence for each field:
- `vehicle_id`, `field_name`, `proposed_value`
- `source_type`, `source_confidence`
- `extraction_context` (surrounding text)
- `supporting_signals`, `contradicting_signals`
- `status` (pending, accepted, rejected, conflicted)

#### `vehicle_field_provenance`
Current value + full provenance:
- `current_value`, `total_confidence`
- `primary_source`, `supporting_sources`
- `factory_original_value`, `modified_value`
- `modification_date`

## Functions

### Core Forensic Functions

#### `assign_field_forensically(vehicle_id, field_name, value, context, source)`
Assigns a field value with forensic analysis:
- Normalizes value using normalization rules
- Calculates confidence from source trust + context clues
- Validates against existing vehicle data
- Stores evidence record

**Example:**
```sql
SELECT assign_field_forensically(
  'vehicle-uuid',
  'drivetrain',
  '4x4',
  'K10 Blazer with 4x4 system',
  'scraped_listing'
);
```

#### `disambiguate_value(value, field_candidates, context, vehicle_data)`
Disambiguates ambiguous values:
- Analyzes context for keywords
- Checks format patterns (RPO codes, etc.)
- Uses priors based on make/year

**Example:**
```sql
SELECT * FROM disambiguate_value(
  '350',
  ARRAY['engine_displacement_cid', 'horsepower', 'exterior_color_code'],
  '350 V8 engine',
  '{"make": "CHEVROLET", "year": 1985}'::JSONB
);
-- Returns: engine_displacement_cid, 90% confidence
```

#### `detect_modification(vehicle_id, field, new_value, source)`
Detects if value differs from factory (VIN):
- Compares to NHTSA VIN decode
- Flags modifications
- Suggests timeline events

**Example:**
```sql
SELECT detect_modification(
  'vehicle-uuid',
  'drivetrain',
  '4WD',
  'user_input'
);
-- Returns: {is_modification: true, factory_value: "2WD", action: "create_timeline_event"}
```

#### `validate_field_with_multiple_signals(vehicle_id, field_name)`
Validates field using multiple evidence sources:
- Calculates consensus value
- Identifies outliers
- Returns action recommendation

**Example:**
```sql
SELECT validate_field_with_multiple_signals(
  'vehicle-uuid',
  'drivetrain'
);
-- Returns: {consensus_value: "4WD", consensus_confidence: 87.5, sources_agreeing: 4, outliers: [...]}
```

#### `build_field_consensus(vehicle_id, field_name, auto_assign)`
Analyzes all evidence and assigns best value:
- Builds consensus from all evidence
- Auto-assigns if confidence >= 80
- Updates vehicle field and provenance

**Example:**
```sql
SELECT build_field_consensus(
  'vehicle-uuid',
  'drivetrain',
  true  -- auto-assign if high confidence
);
```

#### `detect_data_anomalies(vehicle_id)`
Detects impossible combinations and errors:
- Checks series/drivetrain consistency
- Validates temporal constraints
- Flags VIN conflicts
- Identifies statistical outliers

**Example:**
```sql
SELECT * FROM detect_data_anomalies('vehicle-uuid');
-- Returns: [{field: "drivetrain", anomaly: "K-series must be 4WD", severity: "critical"}]
```

### Integration Functions

#### `process_scraped_data_forensically(vehicle_id, scraped_data, source_url, scraper_name, context)`
Processes scraped data through forensic system:
- Collects evidence for each field
- Builds consensus
- Detects anomalies

**Usage in Edge Functions:**
```typescript
const { data } = await supabase.rpc('process_scraped_data_forensically', {
  p_vehicle_id: vehicleId,
  p_scraped_data: scrapedData,
  p_source_url: listingUrl,
  p_scraper_name: 'scrape-bat',
  p_context: { description: fullDescription }
});
```

#### `update_vehicle_field_forensically(vehicle_id, field_name, new_value, source, context, auto_assign)`
Updates field using forensic analysis:
- Collects evidence
- Builds consensus
- Checks for modifications
- Updates if confidence is high

#### `forensic_enrichment_pipeline(vehicle_id, data_sources)`
Complete enrichment pipeline:
- Collects evidence from all sources
- Builds consensus for all fields
- Detects anomalies
- Returns comprehensive report

## Workflow

### 1. Data Ingestion
When data comes in (scraper, user input, etc.):
```
Raw Data → Normalize → Collect Evidence → Store in field_evidence
```

### 2. Evidence Analysis
For each field with evidence:
```
All Evidence → Multi-Signal Validation → Consensus Building → Confidence Score
```

### 3. Assignment Decision
Based on consensus:
- **High confidence (≥90%)**: Auto-assign
- **Medium confidence (70-89%)**: Auto-assign with flag
- **Low confidence (50-69%)**: Flag for review
- **Conflicts**: Manual review required

### 4. Anomaly Detection
After assignment:
```
All Fields → Anomaly Detection → Flag Issues → Suggest Corrections
```

### 5. Modification Tracking
If value differs from factory:
```
Factory Value (VIN) vs Current Value → Modification Detected → Timeline Event Suggested
```

## Example Scenarios

### Scenario 1: Ambiguous "350"
**Input:** User enters "350" in description
**Context:** "350 V8 engine swap"

**Process:**
1. `disambiguate_value('350', [...], '350 V8 engine swap')`
2. Context contains "V8" and "engine" → `engine_displacement_cid`
3. Confidence: 90%

**Result:** Assigned to `engine_displacement_cid` field

### Scenario 2: Conflicting Drivetrain
**Evidence:**
- VIN decode: "2WD" (trust: 100)
- User input: "4WD" (trust: 50)
- BaT listing: "4×4" (trust: 85)
- Model: "K10" (trust: 95, pattern match)

**Process:**
1. Collect all evidence
2. Consensus: "4WD" (3 sources agree, avg confidence: 90%)
3. VIN says "2WD" → Modification detected
4. Anomaly: K10 confirms 4WD, but VIN says 2WD

**Result:** 
- Assign "4WD" (consensus wins)
- Flag as modification (factory was 2WD)
- Create timeline event: "4WD conversion"

### Scenario 3: Series/Drivetrain Mismatch
**Data:**
- Series: "K10" (implies 4WD)
- Drivetrain: "2WD" (conflicts)

**Anomaly Detection:**
- Detects: "K-series must be 4WD by definition"
- Severity: Critical
- Recommendation: "Either drivetrain is wrong (should be 4WD) or series is wrong"

**Result:** Flagged for manual review

## Integration with Existing Systems

### Scrapers
Update scrapers to use forensic system:
```typescript
// In scrape-vehicle/index.ts
const forensicResult = await supabase.rpc('process_scraped_data_forensically', {
  p_vehicle_id: vehicleId,
  p_scraped_data: scrapedData,
  p_source_url: url,
  p_scraper_name: 'scrape-bat',
  p_context: { description: markdown }
});
```

### Content Extraction
When extracting from comments:
```typescript
// In process-content-extraction/index.ts
for (const field in extractedData) {
  await supabase.rpc('assign_field_forensically', {
    p_vehicle_id: vehicleId,
    p_field_name: field,
    p_value: extractedData[field],
    p_context: commentText,
    p_source: 'user_comment_extraction'
  });
}
```

### Backfill Queue
When re-scraping:
```typescript
// In process-backfill-queue/index.ts
const forensicResult = await supabase.rpc('process_scraped_data_forensically', {
  p_vehicle_id: job.vehicle_id,
  p_scraped_data: newData,
  p_source_url: job.source_url,
  p_scraper_name: 'scrape-vehicle',
  p_context: {}
});

// Then build consensus for all fields
for (const field of fieldsToCheck) {
  await supabase.rpc('build_field_consensus', {
    p_vehicle_id: job.vehicle_id,
    p_field_name: field,
    p_auto_assign: true
  });
}
```

## Monitoring & Dashboards

### Views

#### `forensic_evidence_dashboard`
Overview of evidence collection:
- Fields with evidence
- Pending/conflicted evidence
- Average confidence
- Low confidence fields

#### `vehicles_needing_forensic_review`
Vehicles requiring manual review:
- Conflicts detected
- Low confidence pending evidence
- Fields needing review

### Testing

Use the test script:
```bash
# Analyze all fields for a vehicle
node scripts/test-forensic-system.js <vehicle_id> --analyze-all

# Test disambiguation
node scripts/test-forensic-system.js <vehicle_id> --test-disambiguate "350" --context "350 V8 engine"

# Test consensus building
node scripts/test-forensic-system.js <vehicle_id> --test-consensus drivetrain

# Test anomaly detection
node scripts/test-forensic-system.js <vehicle_id> --test-anomalies

# Test modification detection
node scripts/test-forensic-system.js <vehicle_id> --test-modification drivetrain "4WD"
```

## Best Practices

1. **Always use forensic functions** instead of direct field updates
2. **Provide context** when assigning values (surrounding text helps disambiguation)
3. **Use correct source types** (affects trust level)
4. **Review anomalies** before auto-assigning low-confidence values
5. **Track modifications** - create timeline events when modifications are detected
6. **Monitor conflicts** - use dashboard views to find vehicles needing review

## Future Enhancements

- Machine learning for confidence scoring
- Pattern recognition for common modifications
- Automated conflict resolution rules
- Integration with user reputation system
- Real-time anomaly alerts

