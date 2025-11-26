# Orphaned Vehicle Resolution System

## Current Vehicle Analysis

**Vehicle ID:** `0f440baa-869d-4f54-9abc-6564ac6a27b0`
- **Year/Make/Model:** 1985 Chevrolet K10 Suburban
- **VIN:** Missing
- **Status:** `active` (should be `pending`)
- **Profile Origin:** `manual_entry` (should be `dropbox_import`)
- **Created:** 2025-11-03T06:49:58 (same batch as 26 bulk imports)
- **Images:** 0
- **Origin Tracking:** Missing (no `uploaded_by`, no `origin_organization_id`)

## Why This Vehicle is Orphaned

1. **Bulk Import Loophole:** Created during the same automated Dropbox import batch (06:49:00-06:55:00) but didn't receive proper origin tracking
2. **Missing Critical Data:** No VIN, no images, incomplete profile
3. **Incorrect Status:** Should be `pending` (no VIN triggers pending status)
4. **No Matches Found:** No duplicate profiles exist in the database

## Merge Reasoning Framework

### When to Suggest a Merge

A merge should be suggested when:

1. **High Confidence Matches (Auto-merge):**
   - VIN exact match (100% confidence) → **Automatic merge**
   - Same year/make/model + same VIN → **Automatic merge**

2. **Medium Confidence Matches (Manual Review):**
   - Same year/make/model, both missing VIN, created within 5 minutes → **85% confidence, suggest merge**
   - Same year/make/model, one has VIN, other doesn't → **85% confidence, merge incomplete into complete**
   - GPS proximity (<400m) + same date photos + same year/make/model → **75% confidence, suggest merge**

3. **Low Confidence Matches (Investigation):**
   - Similar model name, close year (±1), same make → **70% confidence, flag for review**
   - Fuzzy matches require manual verification

### Merge Decision Logic

```typescript
interface MergeRecommendation {
  confidence: number; // 0-100
  shouldAutoMerge: boolean;
  shouldSuggestMerge: boolean;
  requiresReview: boolean;
  reasoning: string[];
  targetVehicleId: string;
  mergeDirection: 'into_target' | 'into_orphan';
}

function evaluateMerge(orphan: Vehicle, candidate: Vehicle): MergeRecommendation {
  const reasons: string[] = [];
  let confidence = 0;
  
  // VIN match = automatic
  if (orphan.vin && candidate.vin && orphan.vin === candidate.vin) {
    return {
      confidence: 100,
      shouldAutoMerge: true,
      shouldSuggestMerge: true,
      requiresReview: false,
      reasoning: ['Exact VIN match - same vehicle'],
      targetVehicleId: candidate.id,
      mergeDirection: 'into_target'
    };
  }
  
  // Year/Make/Model exact match
  if (orphan.year === candidate.year && 
      orphan.make === candidate.make && 
      orphan.model === candidate.model) {
    confidence += 85;
    reasons.push('Exact year/make/model match');
    
    // Both missing VIN = likely same vehicle
    if (!orphan.vin && !candidate.vin) {
      confidence += 10;
      reasons.push('Both missing VIN - likely same incomplete profile');
    }
    
    // Created in same batch = definitely same
    const timeDiff = Math.abs(
      new Date(orphan.created_at).getTime() - 
      new Date(candidate.created_at).getTime()
    );
    if (timeDiff < 5 * 60 * 1000) { // 5 minutes
      confidence += 5;
      reasons.push('Created in same batch (within 5 minutes)');
    }
    
    // One has VIN, other doesn't = merge incomplete into complete
    if (!orphan.vin && candidate.vin) {
      reasons.push('Target has VIN, orphan does not - merge orphan into target');
      return {
        confidence: 95,
        shouldAutoMerge: true,
        shouldSuggestMerge: true,
        requiresReview: false,
        reasoning: reasons,
        targetVehicleId: candidate.id,
        mergeDirection: 'into_target'
      };
    }
  }
  
  return {
    confidence,
    shouldAutoMerge: confidence >= 95,
    shouldSuggestMerge: confidence >= 75,
    requiresReview: confidence >= 70 && confidence < 95,
    reasoning: reasons,
    targetVehicleId: candidate.id,
    mergeDirection: confidence >= 85 ? 'into_target' : 'into_orphan'
  };
}
```

## Notification System

### Who Gets Notified

1. **Organization Admins** (Primary)
   - Organization that imported the vehicle (`origin_organization_id`)
   - Notification: "Orphaned vehicle detected in your import batch"
   - Action: Review and merge or complete profile

2. **System Admins** (Secondary)
   - Platform administrators
   - Notification: "Orphaned vehicle requires attention"
   - Action: Review, fix origin tracking, or archive

3. **Vehicle Contributors** (If applicable)
   - Users who have contributed to the vehicle
   - Notification: "Vehicle profile needs completion"
   - Action: Add missing VIN or images

### Notification Types

#### 1. Orphaned Vehicle Detected
```typescript
{
  type: 'orphaned_vehicle_detected',
  vehicleId: string,
  severity: 'high' | 'medium' | 'low',
  issues: string[], // ['missing_vin', 'missing_origin', 'no_images']
  suggestedActions: string[],
  recipients: {
    organizationAdmins: string[],
    systemAdmins: string[],
    contributors: string[]
  }
}
```

#### 2. Potential Duplicate Found
```typescript
{
  type: 'duplicate_detected',
  orphanVehicleId: string,
  targetVehicleId: string,
  confidence: number,
  reasoning: string[],
  autoMergeAvailable: boolean,
  recipients: {
    organizationAdmins: string[],
    systemAdmins: string[]
  }
}
```

#### 3. Merge Recommendation
```typescript
{
  type: 'merge_recommendation',
  orphanVehicleId: string,
  targetVehicleId: string,
  confidence: number,
  mergeDirection: 'into_target' | 'into_orphan',
  reasoning: string[],
  dataComparison: {
    orphan: { vin: boolean, images: number, completeness: number },
    target: { vin: boolean, images: number, completeness: number }
  },
  recipients: {
    organizationAdmins: string[]
  }
}
```

## User-Facing Solution Presentation

### In Vehicle Profile UI

**Pending Status Dropdown** (already implemented):
- Shows "Missing: VIN" when no VIN
- Shows "Missing: images" when no images
- Shows similar vehicles with merge suggestions

**Enhanced Pending Details:**
```tsx
{isPending && (
  <div className="pending-details">
    <div className="pending-reason">
      {pendingReasonText}
    </div>
    
    {/* Orphaned Vehicle Warning */}
    {!vehicle.uploaded_by && !vehicle.origin_organization_id && (
      <div className="orphan-warning">
        <strong>⚠️ Orphaned Profile</strong>
        <p>This vehicle was created without proper origin tracking.</p>
        <button onClick={handleClaimOrphan}>
          Claim & Complete Profile
        </button>
      </div>
    )}
    
    {/* Merge Suggestions */}
    {similarVehicles.length > 0 && (
      <div className="merge-suggestions">
        <h4>Potential Duplicates ({similarVehicles.length})</h4>
        {similarVehicles.map(similar => (
          <MergeSuggestionCard
            key={similar.id}
            orphan={vehicle}
            candidate={similar}
            confidence={similar.confidence}
            reasoning={generateMergeReasoning(vehicle, similar)}
            onMerge={() => handleMerge(vehicle.id, similar.id)}
          />
        ))}
      </div>
    )}
  </div>
)}
```

### Merge Suggestion Card Component

```tsx
interface MergeSuggestionCardProps {
  orphan: Vehicle;
  candidate: Vehicle;
  confidence: number;
  reasoning: string[];
  onMerge: () => void;
}

function MergeSuggestionCard({ orphan, candidate, confidence, reasoning, onMerge }: Props) {
  const canAutoMerge = confidence >= 95;
  
  return (
    <div className="merge-suggestion">
      <div className="merge-header">
        <span className="confidence-badge">{confidence}% match</span>
        {canAutoMerge && <span className="auto-merge-badge">Auto-merge available</span>}
      </div>
      
      <div className="candidate-info">
        <h5>{candidate.year} {candidate.make} {candidate.model}</h5>
        <div className="comparison">
          <div className="orphan-data">
            <strong>This Profile:</strong>
            <ul>
              <li>VIN: {orphan.vin ? '✓' : '✗ Missing'}</li>
              <li>Images: {orphan.imageCount || 0}</li>
              <li>Status: {orphan.status}</li>
            </ul>
          </div>
          <div className="candidate-data">
            <strong>Target Profile:</strong>
            <ul>
              <li>VIN: {candidate.vin ? '✓' : '✗ Missing'}</li>
              <li>Images: {candidate.imageCount || 0}</li>
              <li>Status: {candidate.status}</li>
            </ul>
          </div>
        </div>
      </div>
      
      <div className="merge-reasoning">
        <strong>Why merge?</strong>
        <ul>
          {reasoning.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      </div>
      
      <div className="merge-actions">
        <button onClick={() => window.open(`/vehicle/${candidate.id}`, '_blank')}>
          View Target Profile
        </button>
        {canAutoMerge ? (
          <button className="auto-merge" onClick={onMerge}>
            Auto-Merge Now
          </button>
        ) : (
          <button className="suggest-merge" onClick={onMerge}>
            Suggest Merge
          </button>
        )}
      </div>
    </div>
  );
}
```

## Automated Resolution Workflow

### Step 1: Detection
- Run daily scan for orphaned vehicles
- Criteria: Missing VIN + missing origin tracking + no images + created >7 days ago

### Step 2: Match Finding
- Use `VehicleDeduplicationService.findDuplicates()`
- Check for exact matches, fuzzy matches, GPS proximity

### Step 3: Decision Making
- **Confidence ≥95%:** Auto-merge immediately
- **Confidence 75-94%:** Send merge recommendation to org admins
- **Confidence 70-74%:** Flag for manual review
- **No matches:** Send orphan notification to system admins

### Step 4: Notification
- Create notification records in `notifications` table
- Send email to recipients (if configured)
- Show in-app notification badges

### Step 5: Resolution Tracking
- Track merge actions in `vehicle_merge_history` table
- Update vehicle status after merge
- Archive orphaned profiles that can't be resolved

## Database Schema Additions

```sql
-- Notifications table
CREATE TABLE vehicle_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id),
  notification_type TEXT NOT NULL, -- 'orphaned_detected', 'duplicate_found', 'merge_recommendation'
  severity TEXT NOT NULL, -- 'high', 'medium', 'low'
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  recipients JSONB NOT NULL, -- {organizationAdmins: [...], systemAdmins: [...]}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id)
);

-- Merge history
CREATE TABLE vehicle_merge_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_vehicle_id UUID REFERENCES vehicles(id),
  target_vehicle_id UUID REFERENCES vehicles(id),
  merged_by UUID REFERENCES auth.users(id),
  merge_reason TEXT,
  confidence_score INTEGER,
  merged_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Implementation Priority

1. **Immediate:** Fix this specific orphaned vehicle (set status to pending, fix origin)
2. **Short-term:** Implement merge suggestion UI in pending dropdown
3. **Medium-term:** Build notification system for orphaned vehicles
4. **Long-term:** Automated orphan detection and resolution workflow

