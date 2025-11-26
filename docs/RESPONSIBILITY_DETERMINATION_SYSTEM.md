# Responsibility Determination System

## The Core Problem

**Current State**: First user uploaded 100 vehicles → associated with all of them via `uploaded_by`/`user_id` → but they're not actually responsible for all of them.

**The Issue**: "First access point" doesn't mean "responsible party". The system needs to determine **who should be responsible** based on **evidence hierarchy**, not just "who was first".

---

## Responsibility Hierarchy (Strongest → Weakest)

### 1. **Title Ownership** (100% confidence)
- **Source**: `ownership_verifications` table with `status = 'approved'`
- **Evidence**: Title document with user's name
- **Action**: Vehicle "falls to" this user as canonical owner
- **Override**: Can override `uploaded_by` and `user_id`

### 2. **Direct Ownership Claim** (90% confidence)
- **Source**: `vehicles.user_id` (explicit ownership)
- **Evidence**: User explicitly claimed ownership
- **Action**: Vehicle belongs to this user
- **Note**: Can be overridden by title ownership

### 3. **Organization Link with Responsibility** (85% confidence)
- **Source**: `organization_vehicles.responsible_party_user_id`
- **Evidence**: Organization assigned responsibility to specific user
- **Action**: Vehicle "falls to" this user in organization context
- **Note**: Only applies when viewing organization context

### 4. **Organization Auto-Link** (70% confidence)
- **Source**: `organization_vehicles` with GPS/receipt auto-tagging
- **Evidence**: GPS coordinates or receipts link vehicle to organization
- **Action**: Vehicle belongs to organization (not individual user)
- **Note**: User sees it in org context, not personal view

### 5. **Primary Contributor** (50% confidence)
- **Source**: Most images uploaded, most timeline events created
- **Evidence**: User did most of the work documenting the vehicle
- **Action**: Suggests this user as responsible, but doesn't auto-assign
- **Note**: Weak claim - needs verification

### 6. **First Uploader** (10% confidence - WEAKEST)
- **Source**: `vehicles.uploaded_by` (just happened to be first)
- **Evidence**: None - just temporal priority
- **Action**: **Should NOT determine responsibility** - just tracks data origin
- **Note**: This is the problem - first uploader shouldn't own everything

---

## Solution: Auto-Determine Responsible Party

### Function: `determine_canonical_responsible_party(vehicle_id)`

```sql
CREATE OR REPLACE FUNCTION determine_canonical_responsible_party(p_vehicle_id UUID)
RETURNS TABLE (
  user_id UUID,
  organization_id UUID,
  confidence_score INTEGER,
  evidence_type TEXT,
  evidence_details JSONB
) AS $$
DECLARE
  v_title_owner UUID;
  v_direct_owner UUID;
  v_org_responsible UUID;
  v_org_id UUID;
  v_primary_contributor UUID;
  v_uploader UUID;
BEGIN
  -- 1. Check title ownership (strongest)
  SELECT ov.user_id INTO v_title_owner
  FROM ownership_verifications ov
  WHERE ov.vehicle_id = p_vehicle_id
    AND ov.status = 'approved'
  ORDER BY ov.approved_at DESC
  LIMIT 1;
  
  IF v_title_owner IS NOT NULL THEN
    RETURN QUERY SELECT 
      v_title_owner,
      NULL::UUID,
      100,
      'title_ownership',
      jsonb_build_object('verification_id', ov.id, 'approved_at', ov.approved_at);
    RETURN;
  END IF;
  
  -- 2. Check direct ownership
  SELECT user_id INTO v_direct_owner
  FROM vehicles
  WHERE id = p_vehicle_id AND user_id IS NOT NULL;
  
  IF v_direct_owner IS NOT NULL THEN
    RETURN QUERY SELECT 
      v_direct_owner,
      NULL::UUID,
      90,
      'direct_ownership',
      jsonb_build_object('source', 'vehicles.user_id');
    RETURN;
  END IF;
  
  -- 3. Check organization responsible party
  SELECT responsible_party_user_id, organization_id 
  INTO v_org_responsible, v_org_id
  FROM organization_vehicles
  WHERE vehicle_id = p_vehicle_id
    AND responsible_party_user_id IS NOT NULL
    AND status = 'active'
  ORDER BY assigned_at DESC
  LIMIT 1;
  
  IF v_org_responsible IS NOT NULL THEN
    RETURN QUERY SELECT 
      v_org_responsible,
      v_org_id,
      85,
      'organization_responsible_party',
      jsonb_build_object('org_id', v_org_id, 'assigned_at', ov.assigned_at);
    RETURN;
  END IF;
  
  -- 4. Check organization auto-link (vehicle belongs to org, not user)
  SELECT organization_id INTO v_org_id
  FROM organization_vehicles
  WHERE vehicle_id = p_vehicle_id
    AND auto_tagged = true
    AND status = 'active'
  ORDER BY gps_match_confidence DESC
  LIMIT 1;
  
  IF v_org_id IS NOT NULL THEN
    RETURN QUERY SELECT 
      NULL::UUID,  -- No individual user responsible
      v_org_id,
      70,
      'organization_auto_link',
      jsonb_build_object('auto_tagged', true, 'gps_confidence', ov.gps_match_confidence);
    RETURN;
  END IF;
  
  -- 5. Primary contributor (weak - just suggestion)
  SELECT user_id INTO v_primary_contributor
  FROM (
    SELECT 
      user_id,
      COUNT(*) as contribution_count
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
    GROUP BY user_id
    ORDER BY contribution_count DESC
    LIMIT 1
  ) contribs
  WHERE contribution_count >= 5;  -- Need at least 5 images
  
  IF v_primary_contributor IS NOT NULL THEN
    RETURN QUERY SELECT 
      v_primary_contributor,
      NULL::UUID,
      50,
      'primary_contributor',
      jsonb_build_object('image_count', contribs.contribution_count);
    RETURN;
  END IF;
  
  -- 6. First uploader (weakest - just tracks origin, not responsibility)
  SELECT uploaded_by INTO v_uploader
  FROM vehicles
  WHERE id = p_vehicle_id;
  
  IF v_uploader IS NOT NULL THEN
    RETURN QUERY SELECT 
      v_uploader,
      NULL::UUID,
      10,
      'first_uploader',
      jsonb_build_object('note', 'Data origin only - not responsible party');
    RETURN;
  END IF;
  
  -- No responsible party found
  RETURN QUERY SELECT NULL::UUID, NULL::UUID, 0, 'none', '{}'::jsonb;
END;
$$ LANGUAGE plpgsql;
```

---

## User Actions

### 1. **Relinquish Responsibility** (Replaces "Offload")

**What it does**:
- User says "I'm not responsible for this vehicle"
- Triggers `determine_canonical_responsible_party()` to find real owner
- If found → transfers responsibility automatically
- If not found → marks as "unclaimed" and shows in discovery feed

**When to show**:
- User is first uploader but has no title/ownership claim
- Vehicle is linked to organization but user isn't responsible party
- User contributed data but doesn't own/manage vehicle

**UI**: Button "NOT RESPONSIBLE" → System finds real owner → Transfers

### 2. **Claim Responsibility** (For Real Owners)

**What it does**:
- User with title document claims ownership
- System verifies title → assigns as canonical owner
- Overrides first uploader's claim
- Vehicle "falls to" this user

**When to show**:
- User has title document but isn't marked as owner
- System detected title but hasn't auto-assigned yet

**UI**: Button "CLAIM OWNERSHIP" → Upload title → Verify → Assign

### 3. **Auto-Assign to Organization**

**What it does**:
- GPS/receipt auto-linking already does this
- Vehicle "falls to" organization (not individual user)
- User sees it in org context, not personal view

**When it happens**:
- Image uploaded with GPS near organization
- Receipt uploaded with vendor name matching organization

---

## Vehicle View Logic

### Personal View Shows:
1. Vehicles where user is canonical owner (title or direct ownership)
2. Vehicles where user is organization responsible party
3. Vehicles user discovered (but only if no stronger claim exists)

### Personal View Hides:
1. Vehicles only linked to organizations (unless user is responsible party)
2. Vehicles where user is just first uploader (no other claim)
3. Vehicles user relinquished responsibility for

### Organization View Shows:
1. All vehicles linked to that organization
2. Regardless of who uploaded them first
3. Shows responsible party for each vehicle

---

## Migration Strategy

### For Existing 100 Vehicles:

1. **Run responsibility determination** for all vehicles:
   ```sql
   SELECT 
     v.id,
     v.year || ' ' || v.make || ' ' || v.model as vehicle_name,
     determine_canonical_responsible_party(v.id) as responsible_party
   FROM vehicles v
   WHERE v.uploaded_by = 'FIRST_USER_ID';
   ```

2. **Auto-assign based on evidence**:
   - If title found → assign to title owner
   - If org link found → assign to org (remove from personal view)
   - If no evidence → mark as "unclaimed" (show in discovery)

3. **Update user's view**:
   - Remove vehicles from personal view where user is just first uploader
   - Keep vehicles where user has actual claim (title, ownership, org responsibility)

---

## UI Changes

### Remove:
- ❌ "OFFLOAD" button (doesn't make sense)

### Add:
- ✅ "NOT RESPONSIBLE" button (triggers auto-detection)
- ✅ "CLAIM OWNERSHIP" button (for title holders)
- ✅ Responsibility indicator (shows who is actually responsible)

### Show:
- **Responsible Party Badge**: "Owned by [Name]" or "Managed by [Org]"
- **Evidence Indicator**: "Title verified" or "GPS linked" or "First uploader (weak claim)"
- **Auto-suggestion**: "This vehicle appears to belong to [Org] - transfer?"

---

## Key Insight

**"Offload" doesn't make sense because**:
- You can't "remove" a relationship that exists
- The vehicle profile is canonical (VIN-based)
- Responsibility should be determined by evidence, not manual action

**"Relinquish Responsibility" makes sense because**:
- User acknowledges they're not responsible
- System finds the real responsible party automatically
- Vehicle "falls to" the right person/org based on evidence

**The system should be smart enough to**:
- Auto-determine responsibility from evidence
- Auto-assign vehicles to organizations
- Show vehicles in the right person's view
- Not require manual "offloading" - just smart defaults

