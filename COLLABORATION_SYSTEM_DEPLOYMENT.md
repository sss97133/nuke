# Collaboration & Data Quality System - Deployment Guide

## Overview

This system solves critical data management issues identified in your Viva! Las Vegas Autos inventory:

### Problems Solved

1. **Invalid VINs Going Public** - Vehicles with fake VINs like "VIVA-1762059695512" are now blocked from public view
2. **Days on Lot Miscalculation** - Now calculated based on first photo date with high confidence scores
3. **Data Originator vs Responsible Party** - Separates who imported data from who manages the vehicle
4. **Cluttered "All" View** - New "CURRENT" filter (default) hides sold vehicles
5. **No Collaboration Workflow** - Automated notifications to verify responsibilities

---

## 🔧 What Was Built

### 1. VIN Validation & Public Safety System
**File:** `supabase/migrations/20251122150000_vin_validation_public_safety.sql`

**Features:**
- ✅ ISO 3779 VIN check digit validation
- ✅ Pattern matching to detect fake VINs (VIVA-, TEST-, FAKE-, etc.)
- ✅ Automatic validation on insert/update
- ✅ **PUBLIC SAFETY TRIGGER**: Blocks invalid VINs from going public
- ✅ Backfills all existing VINs with validation status

**New Database Columns:**
```sql
vehicles.vin_is_valid         -- NULL = not validated, TRUE = valid, FALSE = invalid
vehicles.vin_validation_method -- How it was validated
vehicles.vin_validated_at      -- When it was validated
```

**Admin View:**
```sql
SELECT * FROM invalid_vins_report;  -- See all vehicles with invalid VINs
```

---

### 2. Days on Lot Auto-Calculator
**File:** `supabase/migrations/20251122150001_days_on_lot_calculator.sql`

**How it works:**
1. Uses **earliest photo date** with confidence score >= 70 (arrival inspection quality)
2. Fallback to timeline events (arrival, inspection, acquisition)
3. Final fallback to vehicle creation date
4. Automatically updates when new images are added
5. Calculates to sale date (if sold) or today

**Functions:**
```sql
calculate_days_on_lot(vehicle_id, organization_id)  -- Calculate for a vehicle
get_vehicle_arrival_date(vehicle_id)                -- Get best arrival date estimate
```

**Triggers:**
- Updates automatically when organization_vehicles record changes
- Updates when vehicle images are added/modified
- Daily scheduled job (requires pg_cron)

---

### 3. Collaboration & Responsibility System
**File:** `supabase/migrations/20251122150002_collaboration_responsibility_system.sql`

**New Tables:**

#### `organization_vehicles` (enhanced)
```sql
responsible_party_user_id    -- Who is responsible (vs who imported)
responsibility_type          -- owner, manager, listing_agent, etc.
assigned_by_user_id          -- Who assigned them
assigned_at                  -- When assigned
responsibility_notes         -- Notes about responsibility
pending_responsibility_transfer  -- Flag for transfers in progress
```

#### `vehicle_collaborators`
Tracks all users involved with a vehicle:
- Roles: owner, co_owner, manager, contributor, photographer, technician, appraiser, viewer
- Permissions: can_edit, can_delete, can_approve, can_sell
- Contribution tracking: count, last_contribution_at
- Invitation system: pending, active, inactive, rejected

#### `collaboration_notifications`
Smart notifications for:
- `verify_responsibility` - "Are you responsible for this vehicle?"
- `collaboration_invite` - "You've been invited to collaborate"
- `responsibility_transfer` - "Vehicle responsibility transferred to you"
- `data_quality_check` - "Please verify this vehicle data"
- `missing_vin` - "This vehicle needs a VIN to be public"
- `invalid_vin` - "This vehicle has an invalid VIN" (URGENT)
- `assignment_needed` - "This vehicle needs a responsible party"

**Functions:**
```sql
send_collaboration_verification(organization_id, vehicle_ids[])
  -- Send notifications to all org collaborators

assign_vehicle_responsibility(
  org_vehicle_id,
  user_id,
  responsibility_type,
  assigned_by_user_id,
  notes
)
  -- Assign a responsible party and notify them
```

---

### 4. Inventory Current Filter
**File:** `supabase/migrations/20251122150003_inventory_current_filter.sql`

**Materialized View: `organization_current_inventory`**
- Fast view of current (non-sold) inventory
- Includes vehicle details, metrics, images
- Flags: missing_vin, invalid_vin, needs_assignment
- Auto-refreshes on changes

**Views:**
```sql
organization_current_inventory     -- Current inventory with all metrics
organization_inventory_summary     -- Summary stats by organization
vehicles_needing_attention         -- Vehicles flagged with issues (priority scored)
```

**Priority Score System:**
- Invalid VIN: +100 (CRITICAL)
- Missing VIN (public vehicle): +80 (URGENT)
- No responsible party: +40-50 (HIGH)
- Aged inventory (180+ days): +30 (MEDIUM)
- Aged inventory (90+ days): +15 (MEDIUM)
- Low image count (<3): +20 (MEDIUM)

---

### 5. Frontend Components

#### `CollaborationNotifications.tsx`
**Location:** `nuke_frontend/src/components/collaboration/CollaborationNotifications.tsx`

**Features:**
- Real-time notifications via Supabase subscriptions
- Filter by: Unread, Urgent, All
- Priority badges: URGENT (red), HIGH PRIORITY (orange), Normal, Low
- Action buttons: "Verify Now", "Mark Read", "Dismiss"
- Vehicle details shown inline
- Links to vehicle profiles

**Usage:**
```tsx
<CollaborationNotifications 
  userId={currentUserId}
  organizationId={organizationId}  // Optional: filter by org
  limit={10}                       // Optional: limit results
  showAll={false}                  // Optional: show all notifications
/>
```

#### `VehicleResponsibilityManager.tsx`
**Location:** `nuke_frontend/src/components/collaboration/VehicleResponsibilityManager.tsx`

**Features:**
- Shows current responsible party
- "I'm Responsible" button for self-assignment
- Assignment form for managers:
  - Select team member
  - Choose responsibility type
  - Add notes
- Sends automatic notifications on assignment

**Usage:**
```tsx
<VehicleResponsibilityManager
  vehicleId={vehicleId}
  organizationId={organizationId}
  currentUserId={currentUserId}
  canManage={true}  // User can assign others
/>
```

#### `EnhancedDealerInventory.tsx` (Updated)
**Location:** `nuke_frontend/src/components/organization/EnhancedDealerInventory.tsx`

**Changes:**
- ✅ **Default view changed from "ALL" to "CURRENT"** (hides sold)
- ✅ New "CURRENT" filter tab (first position)
- ✅ VIN validation warnings shown on vehicle cards
- ✅ Invalid VIN badge: ❌ INVALID VIN (red)
- ✅ Missing VIN badge: ⚠️ NO VIN (yellow)
- ✅ Fetches `vin_is_valid` from database

---

## 📋 Deployment Steps

### Step 1: Deploy Database Migrations

```bash
cd /Users/skylar/nuke

# Apply all 4 migrations in order
supabase db push
```

**Migrations will:**
1. Validate all existing VINs (may take 1-2 minutes for large datasets)
2. Force invalid VIN vehicles to private
3. Calculate days_on_lot for all active vehicles
4. Create new tables and views

### Step 2: Generate Notifications for Viva

```bash
# Run the notification generation script
supabase db execute -f scripts/send_collaboration_notifications.sql
```

**This will:**
- Find all Viva! Las Vegas Autos collaborators
- Send notifications for vehicles needing assignment
- Prioritize vehicles with invalid VINs (URGENT)
- Show summary of what was sent

### Step 3: Deploy Frontend Changes

```bash
cd /Users/skylar/nuke/nuke_frontend

# Install any new dependencies (none required)

# Deploy to production
cd /Users/skylar/nuke
vercel --prod --force --yes
```

### Step 4: Verify Deployment

```bash
# Check that bundle hash changed
curl -s https://n-zero.dev | grep -o '_next/static/[^/]*' | head -1

# Compare with previous hash to confirm new deployment
```

---

## 🧪 Testing & Verification

### Test 1: VIN Validation

```sql
-- Check invalid VINs report
SELECT 
  year, make, model, vin, 
  vin_is_valid, 
  validation_details->>'reason' as reason
FROM invalid_vins_report
LIMIT 10;

-- Try to make vehicle with invalid VIN public (should fail)
UPDATE vehicles 
SET is_public = true 
WHERE vin = 'VIVA-1762059695512';
-- Expected: ERROR: Cannot set vehicle to public with invalid VIN
```

### Test 2: Days on Lot Calculation

```sql
-- Check days_on_lot for a specific vehicle
SELECT 
  v.year, v.make, v.model,
  ov.days_on_lot,
  get_vehicle_arrival_date(v.id) as arrival_date,
  (
    SELECT MIN(captured_at)
    FROM vehicle_images
    WHERE vehicle_id = v.id
  ) as first_photo_date
FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
WHERE ov.organization_id = 'VIVA_ORG_ID'
LIMIT 10;
```

### Test 3: Collaboration Notifications

```sql
-- Check notifications sent
SELECT 
  cn.notification_type,
  cn.title,
  cn.priority,
  p.full_name as recipient,
  v.year || ' ' || v.make || ' ' || v.model as vehicle
FROM collaboration_notifications cn
JOIN profiles p ON p.id = cn.user_id
JOIN vehicles v ON v.id = cn.vehicle_id
WHERE cn.created_at > NOW() - INTERVAL '1 hour'
ORDER BY cn.priority DESC, cn.created_at DESC;
```

### Test 4: Frontend Display

1. **Navigate to Organization Page:** https://n-zero.dev/organization/VIVA_ORG_ID
2. **Check Default Tab:** Should be "CURRENT" (not "ALL")
3. **Check VIN Warnings:** 
   - Vehicles with invalid VINs show red ❌ badge
   - Vehicles without VINs show yellow ⚠️ badge
4. **Check Days on Lot:** Should show actual calculated days, not 0
5. **Check Notifications:** Click notifications icon (should see new collab notifications)

---

## 🚨 Important Safeguards

### VIN Safety
- **Vehicles with invalid VINs CANNOT be set to public** (database trigger prevents it)
- **Vehicles without VINs CAN be public** (for classified/discovered vehicles)
- **Manual override:** Admins can use `vin_validation_method = 'manual_override'` to bypass check digit validation

### Data Integrity
- **Days on lot recalculates automatically** when images are added
- **Responsibility assignments are logged** (assigned_by, assigned_at)
- **Notifications expire after 30 days** automatically

### Performance
- **Materialized view** for current inventory (fast queries)
- **Indexed fields:** vin_is_valid, responsible_party_user_id, pending_responsibility_transfer
- **RLS policies** enforce security

---

## 🔍 Admin Tools & Queries

### Find Vehicles Needing Attention

```sql
SELECT * FROM vehicles_needing_attention
WHERE organization_id = 'VIVA_ORG_ID'
ORDER BY priority_score DESC
LIMIT 20;
```

### Bulk Assign Responsibility

```sql
-- Assign all consignment vehicles to specific user
DO $$
DECLARE
  v_org_vehicle RECORD;
BEGIN
  FOR v_org_vehicle IN
    SELECT id FROM organization_vehicles
    WHERE organization_id = 'VIVA_ORG_ID'
      AND relationship_type = 'consigner'
      AND responsible_party_user_id IS NULL
  LOOP
    PERFORM assign_vehicle_responsibility(
      v_org_vehicle.id,
      'TARGET_USER_ID',
      'consignment_agent',
      'ADMIN_USER_ID',
      'Bulk assigned: consignment vehicles'
    );
  END LOOP;
END $$;
```

### Fix Invalid VINs

```sql
-- Update vehicle with corrected VIN
UPDATE vehicles
SET vin = 'CORRECT_VIN_HERE'
WHERE id = 'VEHICLE_ID';
-- VIN will be auto-validated on update

-- Manually override validation (use sparingly!)
UPDATE vehicles
SET 
  vin_is_valid = true,
  vin_validation_method = 'manual_override'
WHERE id = 'VEHICLE_ID';
```

### Refresh Current Inventory View

```sql
-- Manual refresh (automatic via triggers, but can force)
REFRESH MATERIALIZED VIEW CONCURRENTLY organization_current_inventory;
```

---

## 📊 Monitoring & Maintenance

### Daily Checks

1. **Invalid VINs:** Check `invalid_vins_report` for new problems
2. **Unassigned Vehicles:** Check `vehicles_needing_attention` 
3. **Pending Notifications:** Check for unread urgent notifications
4. **Days on Lot:** Spot-check calculations match reality

### Weekly Maintenance

1. **Refresh materialized view** (if auto-refresh not working)
2. **Review collaboration assignments**
3. **Clear expired notifications** (automatic after 30 days)

### Monthly Review

1. **VIN validation accuracy** - Are we catching all fake VINs?
2. **Days on lot accuracy** - Do calculations match reality?
3. **Notification engagement** - Are collaborators responding?
4. **Data quality trends** - Improving or declining?

---

## 🎯 Success Metrics

### Before System
- ❌ 37+ vehicles with fake VINs public
- ❌ Days on lot = 0 or incorrect
- ❌ No clear ownership/responsibility
- ❌ "All" view cluttered with sold vehicles
- ❌ Manual responsibility tracking

### After System
- ✅ Invalid VINs blocked from public view
- ✅ Days on lot calculated from photo dates
- ✅ Clear responsible party for each vehicle
- ✅ "Current" view default (clean inventory)
- ✅ Automated collaboration notifications

---

## 🆘 Troubleshooting

### VIN validation not working
```sql
-- Check if trigger is enabled
SELECT * FROM pg_trigger WHERE tgname = 'trigger_auto_validate_vin';

-- Manually validate specific VIN
SELECT validate_vin('YOUR_VIN_HERE');
```

### Days on lot showing 0
```sql
-- Check if vehicle has images with dates
SELECT 
  captured_at, 
  confidence_score, 
  angle_classification
FROM vehicle_images
WHERE vehicle_id = 'VEHICLE_ID'
ORDER BY captured_at ASC;

-- Manually recalculate
UPDATE organization_vehicles
SET days_on_lot = calculate_days_on_lot(vehicle_id, organization_id)
WHERE vehicle_id = 'VEHICLE_ID';
```

### Notifications not sending
```sql
-- Check if function exists
SELECT * FROM pg_proc WHERE proname = 'send_collaboration_verification';

-- Check notification status
SELECT * FROM collaboration_notifications
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

---

## 📚 Next Steps

1. **Run deployment** (Steps 1-4 above)
2. **Monitor notifications** - Check if collaborators respond
3. **Assign responsibilities** - Use admin tools to bulk assign
4. **Fix invalid VINs** - Correct or remove vehicles with fake VINs
5. **Train team** - Show collaborators how to use notification system

---

## 🤝 Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review migration logs: `supabase db inspect`
3. Check frontend console for errors
4. Verify bundle deployed: `curl https://n-zero.dev | grep _next/static`

Remember: The system is designed to be **production-safe**. Invalid VINs cannot break your public listings.

