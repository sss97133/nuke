# System Health Dashboard

## Overview

A unified dashboard for fixing system errors and data quality issues. This is NOT a user notification system - it's a **system health monitoring and correction tool**.

## What It Does

The System Health Dashboard shows:
1. **RLS Violations** - Row Level Security policy issues
2. **AI Confusion** - When AI makes wrong decisions
3. **Duplicates** - Duplicate vehicles, images, etc.
4. **Mismatches** - Image/vehicle mismatches, org/vehicle problems
5. **Data Quality** - Missing fields, validation errors
6. **AI Errors** - AI processing failures
7. **Scraper Errors** - Scraper failures
8. **Import Errors** - Upload/import problems

## How It Works

### 1. Issue Detection

Issues are created automatically when:
- RLS policy violations occur
- AI makes low-confidence decisions
- Duplicates are detected
- Image/vehicle mismatches are found
- Data quality checks fail
- Scrapers/imports fail

### 2. Issue Creation

Use the `create-system-health-issue` function or RPC:

```typescript
// From Edge Function
await supabase.functions.invoke('create-system-health-issue', {
  body: {
    issue_type: 'ai_confusion',
    severity: 'high',
    title: 'AI matched image to wrong vehicle',
    description: 'AI matched image to 1974 Bronco but image shows 1971 Bronco',
    vehicle_id: 'uuid',
    image_id: 'uuid',
    context_data: {
      ai_confidence: 45,
      ai_decision: 'matched_to_vehicle',
      correct_decision: 'should_not_match'
    },
    suggested_fix: 'Move image to correct vehicle',
    fix_action: {
      action: 'move_image',
      target_vehicle_id: 'uuid'
    }
  }
})

// Or from SQL
SELECT create_system_health_issue(
  'duplicate_vehicle',
  'high',
  'Duplicate vehicle detected',
  'Two vehicles with same VIN found',
  'vehicle-uuid',
  NULL,
  NULL,
  '{"duplicate_vehicle_id": "uuid", "similarity_score": 95}'::jsonb,
  'Merge duplicate vehicles',
  '{"action": "merge_vehicles", "merge_from": "uuid", "merge_to": "uuid"}'::jsonb
);
```

### 3. Fixing Issues

From the UI:
1. View all open issues
2. Click on an issue to see details
3. Click "Apply Fix" to auto-fix (if suggested fix available)
4. Or manually fix and dismiss

## Integration Points

### From Existing Systems

**Image/Vehicle Mismatches:**
```typescript
// When mismatch detected
await supabase.rpc('create_system_health_issue', {
  p_issue_type: 'image_vehicle_mismatch',
  p_severity: 'high',
  p_title: `Image mismatch: ${imageId}`,
  p_image_id: imageId,
  p_vehicle_id: currentVehicleId,
  p_context_data: {
    detected_vehicle: { year: 1974, make: 'FORD', model: 'Bronco' },
    expected_vehicle: { year: 1971, make: 'FORD', model: 'Bronco' }
  },
  p_suggested_fix: 'Move image to correct vehicle',
  p_fix_action: {
    action: 'move_image',
    target_vehicle_id: suggestedVehicleId
  }
})
```

**Duplicate Detection:**
```typescript
// When duplicate found
await supabase.rpc('create_system_health_issue', {
  p_issue_type: 'duplicate_vehicle',
  p_severity: 'medium',
  p_title: `Duplicate vehicle: ${vehicle1.year} ${vehicle1.make} ${vehicle1.model}`,
  p_vehicle_id: vehicle1.id,
  p_context_data: {
    duplicate_vehicle_id: vehicle2.id,
    similarity_score: 95
  },
  p_suggested_fix: 'Merge duplicate vehicles',
  p_fix_action: {
    action: 'merge_vehicles',
    merge_from: vehicle1.id,
    merge_to: vehicle2.id
  }
})
```

**AI Errors:**
```typescript
// When AI makes wrong decision
await supabase.rpc('create_system_health_issue', {
  p_issue_type: 'ai_confusion',
  p_severity: 'high',
  p_title: 'AI low confidence match',
  p_vehicle_id: vehicleId,
  p_context_data: {
    ai_confidence: 45,
    ai_decision: 'matched_to_vehicle',
    correct_decision: 'should_not_match'
  },
  p_suggested_fix: 'Review and correct AI decision'
})
```

**RLS Violations:**
```typescript
// When RLS policy blocks access
await supabase.rpc('create_system_health_issue', {
  p_issue_type: 'rls_violation',
  p_severity: 'critical',
  p_title: `RLS policy violation: ${policyName}`,
  p_context_data: {
    rls_policy: policyName,
    user_id: userId,
    attempted_action: 'SELECT',
    error_message: errorMessage
  },
  p_suggested_fix: 'Update RLS policy or user permissions'
})
```

## Access

**URL:** `/system-health`

**Navigation:** Add to main nav or access directly

## Benefits

1. **Unified View** - All system errors in one place
2. **Quick Fixes** - Fix issues directly from UI
3. **Context** - See what went wrong and why
4. **Suggested Fixes** - System suggests how to fix
5. **Real-time** - Updates as new issues are detected
6. **Filtering** - Filter by severity, type, status

## Next Steps

1. **Integrate with existing systems:**
   - Add issue creation to image mismatch detection
   - Add issue creation to duplicate detection
   - Add issue creation to AI error handlers
   - Add issue creation to RLS violation handlers

2. **Add more fix actions:**
   - Merge vehicles
   - Update RLS policies
   - Retry failed operations
   - Delete bad data

3. **Add auto-fix:**
   - Auto-fix high-confidence issues
   - Batch fix similar issues
   - Schedule fixes

## Status

✅ **Database schema created**
✅ **UI dashboard created**
✅ **Edge function for creating issues**
⏳ **Integration with existing systems** (next step)

