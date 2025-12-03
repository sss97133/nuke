# Forensic System Integration Guide

## Integration Points

### 1. Process Backfill Queue (`process-backfill-queue/index.ts`)

**Location:** Lines 110-180  
**Current:** Direct `.update()` to vehicles table  
**New:** Forensic analysis → consensus building → anomaly detection

**Code Changes:**

```typescript
// After line 110 (const newData = scrapeResult.data;)

// ============================================
// FORENSIC SYSTEM INTEGRATION
// ============================================
console.log(`  🔬 Processing through forensic system...`);

// 1. Process scraped data through forensic analysis
const { data: forensicResult, error: forensicError } = await supabase.rpc(
  'process_scraped_data_forensically',
  {
    p_vehicle_id: job.vehicle_id,
    p_scraped_data: newData,
    p_source_url: job.source_url,
    p_scraper_name: job.scraper_name || 'scrape-vehicle',
    p_context: {}
  }
);

if (forensicError) {
  console.error(`  ⚠️  Forensic analysis error: ${forensicError.message}`);
}

// 2. Build consensus for critical fields
const criticalFields = ['vin', 'year', 'make', 'model', 'drivetrain', 'series', 'trim', 'transmission'];
const consensusResults = [];

for (const field of criticalFields) {
  if (newData[field]) {
    const { data: consensus, error: consensusError } = await supabase.rpc('build_field_consensus', {
      p_vehicle_id: job.vehicle_id,
      p_field_name: field,
      p_auto_assign: true  // Auto-assign if confidence >= 80%
    });
    
    if (!consensusError && consensus) {
      consensusResults.push({ field, ...consensus });
      if (consensus.auto_assigned) {
        console.log(`  ✅ ${field}: "${consensus.consensus_value}" (${consensus.consensus_confidence}% confidence)`);
      } else {
        console.log(`  ⚠️  ${field}: Low confidence (${consensus.consensus_confidence}%) - needs review`);
      }
    }
  }
}

// 3. Detect anomalies
const { data: anomalies, error: anomalyError } = await supabase.rpc('detect_data_anomalies', {
  p_vehicle_id: job.vehicle_id
});

if (!anomalyError && anomalies && anomalies.length > 0) {
  console.log(`  🚨 ${anomalies.length} anomalies detected:`);
  for (const anomaly of anomalies) {
    console.log(`     - ${anomaly.field}: ${anomaly.anomaly} [${anomaly.severity}]`);
  }
}

// 4. Get updated vehicle state (after forensic updates)
const { data: updatedVehicle } = await supabase
  .from('vehicles')
  .select('*')
  .eq('id', job.vehicle_id)
  .single();

// 5. Track changes for logging
const changes: Record<string, { old: any, new: any }> = {};
const fieldsToCheck = job.field_names.length > 0 
  ? job.field_names 
  : ['vin', 'year', 'make', 'model', 'drivetrain', 'series', 'trim', 'transmission', 'mileage'];

for (const field of fieldsToCheck) {
  const oldValue = oldVehicle[field];
  const newValue = updatedVehicle?.[field];

  if (!oldValue && newValue) {
    changes[field] = { old: null, new: newValue };
  } else if (oldValue && newValue && oldValue !== newValue) {
    changes[field] = { old: oldValue, new: newValue };
  }
}

// 6. Log forensic summary
console.log(`\n  📊 FORENSIC SUMMARY:`);
console.log(`     Evidence collected: ${forensicResult?.evidence_collected || 0}`);
console.log(`     Consensus built: ${consensusResults.length}`);
console.log(`     Anomalies found: ${anomalies?.length || 0}`);
console.log(`     Fields updated: ${Object.keys(changes).length}`);

if (Object.keys(changes).length === 0) {
  console.log('  ℹ️  No changes after forensic analysis');
  
  await supabase
    .from('backfill_queue')
    .update({
      status: 'completed',
      changes_detected: {},
      fields_updated: [],
      processed_at: new Date().toISOString()
    })
    .eq('id', job.id);
    
  results.push({ 
    id: job.id, 
    vehicle_id: job.vehicle_id,
    success: true, 
    changes: 0,
    forensic_summary: {
      evidence: forensicResult?.evidence_collected || 0,
      consensus: consensusResults.length,
      anomalies: anomalies?.length || 0
    }
  });
  continue;
}

// Continue with existing logging (lines 170+)
// The forensic system has already updated the vehicle, so just log metadata
```

### 2. Scrape Vehicle (`scrape-vehicle/index.ts`)

**Location:** After successful scrape, before returning response  
**Current:** Returns raw scraped data  
**New:** Process through forensic system

**Code Changes:**

Add at the end of each scraper function (scrapeBringATrailer, scrapeKSL, etc.):

```typescript
// Before returning the final response

// Optional: If vehicle_id is provided in request, run forensic analysis
const { vehicle_id } = await req.json();

if (vehicle_id && scraped_data) {
  console.log('🔬 Running forensic analysis...');
  
  try {
    const forensicResult = await supabase.rpc('process_scraped_data_forensically', {
      p_vehicle_id: vehicle_id,
      p_scraped_data: scraped_data,
      p_source_url: url,
      p_scraper_name: 'scrape-' + (isBringATrailer ? 'bat' : isKSL ? 'ksl' : 'craigslist'),
      p_context: { markdown, description }
    });
    
    if (forensicResult) {
      console.log(`✅ Forensic analysis: ${forensicResult.evidence_collected} evidence, ${forensicResult.anomalies_count} anomalies`);
    }
  } catch (error) {
    console.error('⚠️  Forensic analysis failed:', error);
    // Don't fail the scrape if forensics fail
  }
}
```

### 3. Process Content Extraction (`process-content-extraction/index.ts`)

**Location:** When processing detected content from comments  
**Current:** Direct field updates  
**New:** Forensic assignment

**Code Changes:**

```typescript
// Replace direct updates with forensic assignment

for (const [field, value] of Object.entries(extractedData)) {
  // Use forensic assignment instead of direct update
  const { data: evidence, error } = await supabase.rpc('assign_field_forensically', {
    p_vehicle_id: vehicleId,
    p_field_name: field,
    p_value: value,
    p_context: commentText,  // Full comment for context
    p_source: 'user_comment_extraction',
    p_existing_vehicle_data: null
  });
  
  if (error) {
    console.error(`Failed to assign ${field}:`, error);
    continue;
  }
  
  console.log(`📝 Evidence collected for ${field}: ${value} (confidence: ${evidence.confidence}%)`);
  
  // Build consensus for this field
  const { data: consensus } = await supabase.rpc('build_field_consensus', {
    p_vehicle_id: vehicleId,
    p_field_name: field,
    p_auto_assign: evidence.confidence >= 70  // Only auto-assign if high confidence
  });
  
  if (consensus?.auto_assigned) {
    console.log(`✅ Auto-assigned ${field} = ${consensus.consensus_value}`);
  } else {
    console.log(`⚠️  ${field} flagged for review (confidence: ${consensus?.consensus_confidence}%)`);
  }
}
```

## Testing & Validation

### Test Backfill Integration

```bash
# 1. Queue a vehicle for backfill
psql -c "INSERT INTO backfill_queue (vehicle_id, source_url, scraper_name, reason) VALUES ('vehicle-id', 'https://...', 'scrape-bat', 'test_forensic');"

# 2. Trigger backfill
curl -X POST https://...supabase.co/functions/v1/process-backfill-queue

# 3. Check results
psql -c "SELECT * FROM field_evidence WHERE vehicle_id = 'vehicle-id' ORDER BY created_at DESC LIMIT 10;"
psql -c "SELECT * FROM vehicle_field_provenance WHERE vehicle_id = 'vehicle-id';"
```

### Verify Data Flow

```sql
-- Check evidence collection
SELECT 
  vehicle_id,
  field_name,
  COUNT(*) as evidence_count,
  MAX(source_confidence) as max_confidence,
  STRING_AGG(DISTINCT source_type, ', ') as sources
FROM field_evidence
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY vehicle_id, field_name
ORDER BY evidence_count DESC;

-- Check consensus building
SELECT 
  vehicle_id,
  field_name,
  current_value,
  total_confidence,
  primary_source
FROM vehicle_field_provenance
WHERE updated_at > NOW() - INTERVAL '1 hour';

-- Check anomalies
SELECT COUNT(*) 
FROM data_truth_priority_fixes 
WHERE issue_type = 'CRITICAL_ANOMALY';
```

## Rollout Plan

### Phase 1: Backfill Queue (SAFE - re-processing existing data)
1. Apply changes to `process-backfill-queue/index.ts`
2. Test on 5-10 vehicles manually
3. Enable for all backfill jobs
4. Monitor for 24 hours

### Phase 2: Main Scraper (MEDIUM - affects new scrapes)
1. Apply changes to `scrape-vehicle/index.ts`
2. Make forensic analysis optional (only if vehicle_id provided)
3. Test with new vehicle imports
4. Monitor for conflicts/anomalies

### Phase 3: Content Extraction (LOW IMPACT - user comments)
1. Apply changes to `process-content-extraction/index.ts`
2. Test with sample comments
3. Enable for all comment processing

### Phase 4: Full Production
1. All new data flows through forensic system
2. Evidence trails automatically built
3. Anomalies flagged in real-time
4. Conflicts resolved automatically (where high confidence)

## Monitoring

### Key Metrics

```sql
-- Daily forensic activity
SELECT 
  DATE(created_at) as date,
  COUNT(*) as evidence_records,
  COUNT(DISTINCT vehicle_id) as vehicles_affected,
  AVG(source_confidence) as avg_confidence
FROM field_evidence
GROUP BY DATE(created_at)
ORDER BY date DESC
LIMIT 7;

-- Anomaly detection rate
SELECT 
  issue_type,
  COUNT(*) as count,
  AVG(CASE WHEN auto_fixable THEN 1 ELSE 0 END) * 100 as pct_auto_fixable
FROM data_truth_priority_fixes
GROUP BY issue_type;

-- Consensus success rate
SELECT 
  field_name,
  AVG(total_confidence) as avg_confidence,
  COUNT(*) as total_fields,
  COUNT(*) FILTER (WHERE total_confidence >= 90) as high_confidence_count
FROM vehicle_field_provenance
GROUP BY field_name
ORDER BY avg_confidence DESC;
```

## Expected Outcomes

### Before Integration
- ❌ No provenance tracking
- ❌ No conflict detection
- ❌ No anomaly flagging
- ❌ Direct updates without validation

### After Integration
- ✅ Every field has evidence trail
- ✅ Conflicts detected and logged
- ✅ Anomalies flagged automatically
- ✅ High-confidence auto-fixes
- ✅ Low-confidence flagged for review
- ✅ Full audit trail


