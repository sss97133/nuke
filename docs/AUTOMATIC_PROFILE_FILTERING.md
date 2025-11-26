# Automatic Profile Filtering Based on Evidence

## Core Principle

**If a vehicle appears in someone's profile, there's a reason. If they have to manually say "not responsible," the system is wrong.**

The system should automatically determine who should see what vehicles in their profile based on evidence hierarchy - no manual "offload" or "not responsible" buttons needed.

---

## The Problem

**First user has 100 vehicles in their profile** because:
- They're `uploaded_by` (first uploader - weak claim)
- They're `user_id` (but shouldn't be for many)
- System shows all vehicles they're associated with, regardless of evidence strength

**But many shouldn't be there** because:
- Vehicle belongs to organization (GPS/receipt evidence)
- Someone else has title ownership
- User is just first uploader with no other claim

---

## Solution: Automatic Profile Filtering

### Personal Profile Should Show:

1. **Vehicles where user is canonical owner** (title or direct ownership)
2. **Vehicles where user is organization responsible party**
3. **Vehicles user discovered** (only if no stronger claim exists AND user actively contributed)

### Personal Profile Should NOT Show:

1. **Vehicles only linked to organizations** (unless user is responsible party)
   - If GPS/receipt links vehicle to org → show in org context, not personal
   - User can switch to org view to see them

2. **Vehicles where user is just first uploader** (no other claim)
   - If user is `uploaded_by` but has no title, no org responsibility, no active contribution → don't show
   - Vehicle exists in system, just not in this user's profile

3. **Vehicles user relinquished** (system already determined they shouldn't be there)

---

## Evidence-Based Filtering Logic

### Function: `should_show_in_user_profile(vehicle_id, user_id)`

```sql
CREATE OR REPLACE FUNCTION should_show_in_user_profile(
  p_vehicle_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_has_title_ownership BOOLEAN;
  v_is_direct_owner BOOLEAN;
  v_is_org_responsible BOOLEAN;
  v_has_active_contribution BOOLEAN;
  v_is_just_uploader BOOLEAN;
  v_has_org_link BOOLEAN;
BEGIN
  -- 1. Title ownership (strongest - always show)
  SELECT EXISTS (
    SELECT 1 FROM ownership_verifications
    WHERE vehicle_id = p_vehicle_id
      AND user_id = p_user_id
      AND status = 'approved'
  ) INTO v_has_title_ownership;
  
  IF v_has_title_ownership THEN
    RETURN true;
  END IF;
  
  -- 2. Direct ownership (strong - show)
  SELECT EXISTS (
    SELECT 1 FROM vehicles
    WHERE id = p_vehicle_id
      AND user_id = p_user_id
  ) INTO v_is_direct_owner;
  
  IF v_is_direct_owner THEN
    RETURN true;
  END IF;
  
  -- 3. Organization responsible party (strong - show)
  SELECT EXISTS (
    SELECT 1 FROM organization_vehicles
    WHERE vehicle_id = p_vehicle_id
      AND responsible_party_user_id = p_user_id
      AND status = 'active'
  ) INTO v_is_org_responsible;
  
  IF v_is_org_responsible THEN
    RETURN true;
  END IF;
  
  -- 4. Check if vehicle is linked to organization (weakens personal claim)
  SELECT EXISTS (
    SELECT 1 FROM organization_vehicles
    WHERE vehicle_id = p_vehicle_id
      AND status = 'active'
      AND (auto_tagged = true OR relationship_type IN ('owner', 'in_stock'))
  ) INTO v_has_org_link;
  
  -- 5. Active contribution (images, timeline events in last 90 days)
  SELECT EXISTS (
    SELECT 1 FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND user_id = p_user_id
      AND created_at > NOW() - INTERVAL '90 days'
    UNION
    SELECT 1 FROM timeline_events
    WHERE vehicle_id = p_vehicle_id
      AND user_id = p_user_id
      AND created_at > NOW() - INTERVAL '90 days'
  ) INTO v_has_active_contribution;
  
  -- 6. Just first uploader (weak - don't show if org-linked)
  SELECT EXISTS (
    SELECT 1 FROM vehicles
    WHERE id = p_vehicle_id
      AND uploaded_by = p_user_id
      AND (user_id IS NULL OR user_id != p_user_id)
  ) INTO v_is_just_uploader;
  
  -- Decision logic:
  -- If vehicle is org-linked AND user is just uploader → don't show (belongs to org)
  IF v_has_org_link AND v_is_just_uploader AND NOT v_has_active_contribution THEN
    RETURN false;
  END IF;
  
  -- If user has active contribution → show (they're working on it)
  IF v_has_active_contribution THEN
    RETURN true;
  END IF;
  
  -- If user is just uploader with no org link → show (they discovered it)
  IF v_is_just_uploader AND NOT v_has_org_link THEN
    RETURN true;
  END IF;
  
  -- Default: don't show (no strong claim)
  RETURN false;
END;
$$ LANGUAGE plpgsql;
```

---

## Updated Vehicle Relationships Query

### Modify `get_user_vehicle_relationships` to use filtering:

```sql
CREATE OR REPLACE FUNCTION get_user_vehicle_relationships(p_user_id UUID)
RETURNS TABLE (
  -- ... existing columns ...
) AS $$
BEGIN
  -- Only return vehicles that should actually be in user's profile
  RETURN QUERY
  SELECT 
    v.*,
    CASE
      WHEN EXISTS (SELECT 1 FROM ownership_verifications WHERE vehicle_id = v.id AND user_id = p_user_id AND status = 'approved')
        THEN 'owned'
      WHEN v.user_id = p_user_id
        THEN 'owned'
      WHEN EXISTS (SELECT 1 FROM organization_vehicles WHERE vehicle_id = v.id AND responsible_party_user_id = p_user_id)
        THEN 'managing'
      WHEN EXISTS (SELECT 1 FROM vehicle_images WHERE vehicle_id = v.id AND user_id = p_user_id AND created_at > NOW() - INTERVAL '90 days')
        THEN 'contributing'
      WHEN EXISTS (SELECT 1 FROM discovered_vehicles WHERE vehicle_id = v.id AND user_id = p_user_id)
        THEN 'discovered'
      ELSE NULL
    END as relationship_type
  FROM vehicles v
  WHERE should_show_in_user_profile(v.id, p_user_id) = true;
END;
$$ LANGUAGE plpgsql;
```

---

## What This Means for the First User's 100 Vehicles

### Automatic Cleanup:

1. **Run evidence check** on all 100 vehicles
2. **For each vehicle**:
   - If GPS/receipt links to org → Remove from personal view, show in org view
   - If someone else has title → Remove from personal view, show in title owner's view
   - If user is just first uploader with no active contribution → Remove from personal view
   - If user has active contribution → Keep in personal view as "contributing"

3. **Result**: User's profile shows only vehicles they should actually see
   - Maybe 10-20 vehicles they actually own/manage
   - Not 100 vehicles they just happened to upload first

---

## UI Changes

### Remove:
- ❌ "OFFLOAD" button (doesn't make sense)
- ❌ "NOT RESPONSIBLE" button (system shouldn't show it if they're not responsible)
- ❌ Manual organization tools (system should do it automatically)

### Keep:
- ✅ Organization context filter (switch between personal/org views)
- ✅ Relationship type tabs (owned, contributing, discovered)
- ✅ GPS auto-linking (already works)

### Add:
- ✅ **Automatic filtering** (vehicles only show if user has strong claim)
- ✅ **Smart defaults** (org-linked vehicles show in org context, not personal)
- ✅ **Evidence indicators** (show why vehicle is in profile: "Title verified", "GPS linked to [Org]")

---

## Key Insight

**The system should be smart enough to automatically determine who should see what vehicles in their profile based on evidence - no manual intervention needed.**

If a vehicle appears in someone's profile, it's because:
- They have title ownership (strongest)
- They have direct ownership
- They're organization responsible party
- They have active contribution (working on it)
- They discovered it (and no stronger claim exists)

If none of these are true, the vehicle shouldn't be in their profile in the first place.

**No "offload" needed - the system just shows the right vehicles to the right people automatically.**

