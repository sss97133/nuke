# Intelligent Work Detection - Setup Guide

## Quick Start

### 1. Organization Capabilities

Set up what each organization can do:

```sql
-- Ernies Upholstery
INSERT INTO organization_capabilities (
  organization_id,
  capability_type,
  capability_name,
  proficiency_level
) VALUES (
  'ernies-org-id',
  'upholstery',
  'Interior Upholstery',
  'expert'
);
```

### 2. Location Collaboration

Ensure organizations are registered at the same location:

```sql
-- Already done for 707 Yucca via setup-707-yucca-collaboration.sql
SELECT * FROM location_collaborations WHERE location_address ILIKE '%707%yucca%';
```

### 3. Trigger Work Detection

**Option A: Automatic (on image upload)**
- Trigger is already set up
- Images with `vehicle_id` automatically queue for work detection

**Option B: Manual (via edge function)**
```typescript
const { data } = await supabase.functions.invoke('intelligent-work-detector', {
  body: {
    image_id: 'image-uuid',
    vehicle_id: 'vehicle-uuid',
    image_url: 'https://...'
  }
});
```

## Example Workflow

### Scenario: Upholstery Work at 707 Yucca

1. **Image uploaded** showing reupholstered seats
   - EXIF: GPS = 707 Yucca St, Date = 2024-09-15

2. **Work detection runs** (automatic or manual)
   ```typescript
   // Edge function analyzes image
   // Extracts: work_type='upholstery', date='2024-09-15', location='707 Yucca St'
   ```

3. **Matching algorithm** finds:
   - Ernies Upholstery: **99% match**
     - Location: ✅ Same address
     - Work type: ✅ Specializes in upholstery
     - Date: ✅ Active during period

4. **Notification created**:
   ```sql
   SELECT * FROM work_organization_matches
   WHERE matched_organization_id = 'ernies-org-id'
     AND approval_status = 'pending'
     AND match_probability >= 90;
   ```

5. **Ernies approves**:
   ```sql
   SELECT approve_work_match(
     'match-id',
     true,  -- approved
     'user-id',
     NULL   -- no rejection reason
   );
   ```

6. **Work auto-linked**:
   - `vehicle_work_contribution` record created
   - Linked to Ernies organization
   - Visible to vehicle owner

## Testing

### Test Work Detection

```sql
-- 1. Upload a test image (or use existing)
-- 2. Call edge function
-- 3. Check extraction
SELECT * FROM image_work_extractions 
WHERE vehicle_id = 'your-vehicle-id'
ORDER BY created_at DESC;

-- 4. Check matches
SELECT 
  wom.*,
  b.business_name,
  iwe.detected_work_type
FROM work_organization_matches wom
JOIN businesses b ON b.id = wom.matched_organization_id
JOIN image_work_extractions iwe ON iwe.id = wom.image_work_extraction_id
WHERE wom.vehicle_id = 'your-vehicle-id'
ORDER BY wom.match_probability DESC;
```

### Test Approval

```sql
-- Get pending approvals for Ernies
SELECT * FROM get_pending_work_approvals('ernies-org-id');

-- Approve a match
SELECT approve_work_match(
  'match-id',
  true,
  'user-id'
);

-- Check if work was auto-linked
SELECT * FROM vehicle_work_contributions
WHERE vehicle_id = 'vehicle-id'
ORDER BY created_at DESC;
```

## Frontend Integration

### Display Pending Approvals

```typescript
// In organization dashboard
const { data: approvals } = await supabase.rpc('get_pending_work_approvals', {
  p_organization_id: organizationId
});

// Display as notifications
approvals?.map(approval => (
  <div key={approval.match_id}>
    <p>Did you do {approval.work_type} work on this {approval.vehicle_year} {approval.vehicle_make} {approval.vehicle_model}?</p>
    <p>Match confidence: {approval.match_probability}%</p>
    <button onClick={() => approveWork(approval.match_id, true)}>Approve</button>
    <button onClick={() => approveWork(approval.match_id, false)}>Reject</button>
  </div>
));
```

### Approve/Reject Handler

```typescript
const approveWork = async (matchId: string, approved: boolean) => {
  const { data, error } = await supabase.rpc('approve_work_match', {
    p_match_id: matchId,
    p_approved: approved,
    p_user_id: userId,
    p_rejection_reason: approved ? null : 'We did not perform this work'
  });
  
  if (error) {
    console.error('Approval error:', error);
    return;
  }
  
  // Refresh approvals list
  loadApprovals();
};
```

## Current Status

✅ **Database schema**: Created
✅ **Matching algorithm**: Implemented
✅ **Approval workflow**: Ready
✅ **Auto-linking**: Triggered on approval
✅ **Organization capabilities**: Set up for 707 Yucca
✅ **Edge function**: Created (`intelligent-work-detector`)

## Next Steps

1. **Deploy edge function**: Deploy `intelligent-work-detector` to Supabase
2. **Frontend UI**: Build approval notification UI
3. **Background job**: Set up cron to process pending extractions
4. **Notifications**: Integrate with notification system
5. **Testing**: Test with real images from 707 Yucca

