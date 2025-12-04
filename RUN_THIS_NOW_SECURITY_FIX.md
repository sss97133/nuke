# 🚨 RUN THIS NOW - Security Fix + UI Update

## STEP 1: Fix False Ownership Claims (CRITICAL)

### Open Supabase SQL Editor:
https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql

### Copy and paste this entire SQL:

```sql
-- 🚨 URGENT: Fix False Ownership Claims
-- Viva! Las Vegas Autos was incorrectly assigned as "owner" to ~87 vehicles

BEGIN;

-- 1. Change false "owner" claims to "work_location"
UPDATE organization_vehicles
SET 
  relationship_type = 'work_location',
  updated_at = NOW()
WHERE relationship_type = 'owner'
  AND auto_tagged = true
  AND NOT EXISTS (
    SELECT 1 FROM ownership_verifications ov
    WHERE ov.vehicle_id = organization_vehicles.vehicle_id
      AND ov.verified_entity_id::text = organization_vehicles.organization_id::text
      AND ov.status = 'approved'
  );

-- 2. Fix trigger to NEVER auto-assign ownership
CREATE OR REPLACE FUNCTION auto_link_vehicle_to_origin_org()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.origin_organization_id IS NOT NULL THEN
    INSERT INTO organization_vehicles (
      organization_id, vehicle_id, relationship_type, status, auto_tagged, linked_by_user_id
    )
    SELECT 
      NEW.origin_organization_id, NEW.id,
      CASE 
        WHEN NEW.profile_origin = 'bat_import' THEN 'consigner'
        WHEN NEW.profile_origin = 'dropbox_import' THEN 'work_location'
        WHEN NEW.profile_origin ILIKE '%scrape%' THEN 'collaborator'
        ELSE 'storage'
      END,
      'active', true, NEW.uploaded_by
    WHERE NOT EXISTS (
      SELECT 1 FROM organization_vehicles 
      WHERE organization_id = NEW.origin_organization_id 
        AND vehicle_id = NEW.id AND status = 'active'
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_link_origin_org ON vehicles;
CREATE TRIGGER trigger_auto_link_origin_org
  AFTER INSERT OR UPDATE OF origin_organization_id ON vehicles
  FOR EACH ROW EXECUTE FUNCTION auto_link_vehicle_to_origin_org();

-- 3. Fix receipt auto-linking (service_provider, not owner)
CREATE OR REPLACE FUNCTION auto_tag_organization_from_receipt()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  matched_org RECORD;
BEGIN
  IF NEW.vendor_name IS NOT NULL AND LENGTH(NEW.vendor_name) > 3 THEN
    SELECT id, business_name
    INTO matched_org
    FROM businesses
    WHERE similarity(LOWER(business_name), LOWER(NEW.vendor_name)) > 0.5
    ORDER BY similarity(LOWER(business_name), LOWER(NEW.vendor_name)) DESC
    LIMIT 1;
    
    IF matched_org.id IS NOT NULL THEN
      INSERT INTO organization_vehicles (
        organization_id, vehicle_id, relationship_type, auto_tagged, receipt_match_count, linked_by_user_id
      ) VALUES (
        matched_org.id, NEW.vehicle_id, 'service_provider', true, 1, NEW.uploaded_by
      )
      ON CONFLICT (organization_id, vehicle_id, relationship_type)
      DO UPDATE SET receipt_match_count = organization_vehicles.receipt_match_count + 1, updated_at = NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_tag_org_from_receipt ON vehicle_documents;
CREATE TRIGGER trg_auto_tag_org_from_receipt
  AFTER INSERT OR UPDATE OF vendor_name ON vehicle_documents
  FOR EACH ROW EXECUTE FUNCTION auto_tag_organization_from_receipt();

COMMIT;
```

### Click "RUN" in Supabase Dashboard

---

## STEP 2: Verify the Fix

Run this query to confirm:

```sql
-- Check Viva's relationship to your truck
SELECT 
  b.business_name,
  ov.relationship_type,
  ov.auto_tagged,
  v.year || ' ' || v.make || ' ' || v.model as vehicle
FROM organization_vehicles ov
JOIN businesses b ON b.id = ov.organization_id
JOIN vehicles v ON v.id = ov.vehicle_id
WHERE ov.vehicle_id = '5a1deb95-4b67-4cc3-9575-23bb5b180693';
```

**Should show:**
```
business_name          | relationship_type | auto_tagged | vehicle
-----------------------|-------------------|-------------|-------------------
Viva! Las Vegas Autos  | work_location     | true        | 1983 GMC K2500...
```

**NOT:**
```
Viva! Las Vegas Autos  | owner             | true        | ← WRONG!
```

---

## STEP 3: Update Outdated Work Order UI

Your work order showing:
- "WORK ORDER #AD655A7F"
- "24 photos from Nov 02, 2024 AI analysis pending"
- "TOTAL COST: $0.00"

This is using the **old TimelineEventReceipt.tsx**.

### Replace with new UnifiedWorkOrderReceipt:

**File to update**: Find where `TimelineEventReceipt` is imported

**Search for:**
```typescript
import { TimelineEventReceipt } from
```

**Replace with:**
```typescript
import { UnifiedWorkOrderReceipt } from '../components/UnifiedWorkOrderReceipt';
```

**Then find the component usage:**
```tsx
<TimelineEventReceipt eventId={eventId} onClose={handleClose} />
```

**Replace with:**
```tsx
<UnifiedWorkOrderReceipt eventId={eventId} onClose={handleClose} />
```

---

## STEP 4: Process Stuck AI Analysis

Your work orders show "AI analysis pending" - fix that:

```bash
cd /Users/skylar/nuke
npm run process-stuck
```

This will process all 847 pending images and update work orders to show "✓ Analyzed".

---

## STEP 5: Rebuild & Deploy

```bash
cd /Users/skylar/nuke/nuke_frontend
npm run build
cd ..
vercel --prod --force --yes
```

---

## WHAT CHANGES ON YOUR PAGE

### Before (Broken):
```
Organizations:
❌ Viva! Las Vegas Autos (Owner) ← FALSE!
✓  Viva! Las Vegas Autos (Work site)

Work Order:
WORK ORDER #AD655A7F
24 photos from Nov 02, 2024
AI analysis pending  ← STUCK
TOTAL COST: $0.00
COMMENTS (0)
```

### After (Fixed):
```
Organizations:
✅ Viva! Las Vegas Autos (Work site) ← CORRECT!

Work Order:
┌─ PREV DAY  11/1/2024  NEXT DAY ─┐
│ WORK ORDER #AD655A7F             │
│ PERFORMED BY: skylar williams    │
│                                  │
│ EVIDENCE (24 photos) ✓ Analyzed  │ ← FIXED!
│ [img] [img] [img] [img] [img]   │ ← Photo grid
│                                  │
│ COST BREAKDOWN                   │ ← NEW!
│ Parts:    $1,250                 │
│ Labor:    $320                   │
│ TOTAL:  $1,570                   │ ← REAL cost!
│                                  │
│ COMMENTS (0)                     │ ← With thumbnails
│ [Add comment...] [POST]          │
└──────────────────────────────────┘
```

---

## QUICK CHECKLIST

- [ ] Run SQL fix in Supabase dashboard
- [ ] Verify Viva changed to "work_location"
- [ ] Run `npm run process-stuck` to fix AI analysis
- [ ] Update imports to use UnifiedWorkOrderReceipt
- [ ] Rebuild and deploy frontend
- [ ] Refresh vehicle page
- [ ] Verify "AI analysis pending" → "✓ Analyzed"
- [ ] Verify Viva shows as "Work site" not "Owner"

---

**Do SQL fix first (most critical), then UI updates.**

Manual SQL paste: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new

