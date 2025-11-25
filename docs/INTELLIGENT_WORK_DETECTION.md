# Intelligent Work Detection and Probabilistic Matching

## Overview

This system automatically:
1. **Extracts work data from images** (work type, date, location, components)
2. **Probabilistically matches work to organizations** based on location, work type, and date ranges
3. **Sends approval notifications** to likely organizations asking "Did you do this work?"
4. **Auto-links work** when organizations approve

## How It Works

### Step 1: Image Analysis

When a vehicle image is uploaded, the `intelligent-work-detector` edge function:

1. **Extracts EXIF data**: GPS coordinates, date taken
2. **AI Vision Analysis**: Uses GPT-4 Vision to detect:
   - Work type (upholstery, paint, engine, etc.)
   - Work description
   - Components worked on
   - Visual date/location clues

3. **Saves extraction** to `image_work_extractions` table

### Step 2: Probabilistic Matching

The `match_work_to_organizations()` function matches work to organizations using:

**Scoring System (100 points total):**
- **Location Match (40 points)**: Same address or within 100m
- **Work Type Match (50 points)**: Organization has capability for this work type
- **Date Range Match (10 points)**: Organization was active during work period

**Match Threshold**: Only matches with ≥70% probability are created

### Step 3: Approval Workflow

**High Confidence (≥90%)**:
- Notification sent immediately
- Organization gets: "Did you do this work? [Approve] [Reject]"

**Medium Confidence (70-89%)**:
- Queued for review
- Can be manually sent or auto-sent after review

**When Approved**:
- Automatically creates `vehicle_work_contribution` record
- Links work to the approving organization
- Vehicle owner can see all work done on their vehicle

## Example: 707 Yucca St

### Scenario: Upholstery Work Detected

1. **Image uploaded** showing reupholstered seats
2. **AI extracts**:
   - Work type: `upholstery`
   - Date: `2024-09-15` (from EXIF)
   - Location: `707 Yucca St` (from GPS)

3. **Matching algorithm**:
   - Ernies Upholstery: **99% match**
     - Location: ✅ Same address (40 points)
     - Work type: ✅ Specializes in upholstery (50 points)
     - Date: ✅ Active during period (10 points)
   - Taylor Customs: **40% match**
     - Location: ✅ Same address (40 points)
     - Work type: ❌ Doesn't do upholstery (0 points)
     - Date: ✅ Active (10 points)
   - Viva! Las Vegas Autos: **40% match**
     - Location: ✅ Same address (40 points)
     - Work type: ❌ Doesn't do upholstery (0 points)
     - Date: ✅ Active (10 points)

4. **Notification sent** to Ernies Upholstery:
   ```
   "Did you reupholster seats on this 1977 Chevrolet K5 Blazer 
   around September 15, 2024 at 707 Yucca St?"
   
   [Approve] [Reject] [View Images]
   ```

5. **Ernies approves** → Work automatically linked to their organization

## API Usage

### Trigger Work Detection

```typescript
// Call edge function when image is uploaded
const { data, error } = await supabase.functions.invoke('intelligent-work-detector', {
  body: {
    image_id: 'image-uuid',
    vehicle_id: 'vehicle-uuid',
    image_url: 'https://...'
  }
});
```

### Get Pending Approvals

```typescript
// Get pending approvals for an organization
const { data } = await supabase.rpc('get_pending_work_approvals', {
  p_organization_id: 'org-uuid'
});
```

### Approve/Reject Work

```typescript
// Approve a work match
const { data } = await supabase.rpc('approve_work_match', {
  p_match_id: 'match-uuid',
  p_approved: true,
  p_user_id: 'user-uuid',
  p_rejection_reason: null
});

// Reject a work match
const { data } = await supabase.rpc('approve_work_match', {
  p_match_id: 'match-uuid',
  p_approved: false,
  p_user_id: 'user-uuid',
  p_rejection_reason: 'We did not do this work'
});
```

## Organization Capabilities

Organizations should set up their capabilities for accurate matching:

```sql
-- Add capability
INSERT INTO organization_capabilities (
  organization_id,
  capability_type,
  capability_name,
  description,
  proficiency_level
) VALUES (
  'org-uuid',
  'upholstery',
  'Interior Upholstery',
  'Full interior restoration',
  'expert'
);
```

**Capability Types**:
- `upholstery` - Interior work
- `paint` - Paint and body work
- `engine` - Engine work
- `body_work` - Body repair/fabrication
- `transmission` - Transmission work
- `suspension` - Suspension work
- `electrical` - Electrical work
- `detailing` - Detailing/cleaning
- `other` - Other work types

## Matching Logic Details

### Location Matching

- **Exact address match**: 40 points
- **GPS within 100m**: 40 points × (1 - distance/100)
- **GPS 100-500m**: 20 points × (1 - distance/500)
- **GPS >500m**: 0 points

### Work Type Matching

- **Organization capability matches**: 50 points
- **Business type suggests capability**: 40 points
- **No match**: 0 points

### Date Range Matching

- **Organization active during work date**: 10 points
- **Organization not active**: 0 points

## Workflow Example

```
1. User uploads image of reupholstered seats
   ↓
2. intelligent-work-detector analyzes image
   - Extracts: upholstery, seats, 2024-09-15, 707 Yucca St
   ↓
3. match_work_to_organizations() runs
   - Ernies Upholstery: 99% match
   - Creates work_organization_match record
   ↓
4. Notification sent to Ernies
   - "Did you do this work?"
   ↓
5. Ernies approves
   - Auto-creates vehicle_work_contribution
   - Links work to Ernies organization
   - Vehicle owner sees work in history
```

## Benefits

1. **Automatic Attribution**: Work is automatically attributed to the right organization
2. **Reduced Manual Entry**: Organizations don't need to manually log every job
3. **Complete History**: Vehicle owners see all work done, even by collaborators
4. **High Accuracy**: 99% confidence matches for location + work type + date
5. **Approval Workflow**: Organizations verify work before it's linked

## Future Enhancements

1. **Batch Processing**: Process multiple images at once
2. **Learning System**: Improve matching based on approval/rejection patterns
3. **Multi-image Correlation**: Match work across multiple images
4. **Receipt OCR**: Extract work data from receipts/invoices
5. **Timeline Integration**: Auto-create timeline events from approved work

