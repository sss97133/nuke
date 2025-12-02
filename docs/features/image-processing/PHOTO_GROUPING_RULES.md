# Photo Grouping Rules - FINAL SPEC

## Core Grouping Logic

**Photos taken on same DATE = ONE EVENT**

Simple rule:
```
GROUP BY DATE(taken_at)
```

**No device splitting** - all photos on Jan 6 = 1 event regardless of who took them

## Auto-Event Creation Trigger

```sql
CREATE OR REPLACE FUNCTION auto_create_photo_events()
RETURNS TRIGGER AS $$
BEGIN
  -- When new image uploaded, check if event exists for this date
  -- If not, create one
  
  INSERT INTO timeline_events (
    vehicle_id,
    user_id,
    event_type,
    source,
    event_date,
    title,
    description,
    image_urls,
    metadata
  )
  SELECT
    NEW.vehicle_id,
    NEW.user_id,
    'pending_analysis',  -- AI will determine actual type
    'photo_upload',
    DATE(NEW.taken_at),
    'Photos from ' || TO_CHAR(NEW.taken_at, 'Mon DD, YYYY'),
    'Awaiting AI analysis',
    ARRAY[NEW.image_url],
    jsonb_build_object(
      'needs_ai_analysis', true,
      'photo_count', 1,
      'device_fingerprint', NEW.exif_data->'camera'
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM timeline_events
    WHERE vehicle_id = NEW.vehicle_id
    AND event_date = DATE(NEW.taken_at)
  )
  ON CONFLICT DO NOTHING;
  
  -- If event already exists, append image URL
  UPDATE timeline_events
  SET 
    image_urls = array_append(image_urls, NEW.image_url),
    metadata = metadata || jsonb_build_object(
      'photo_count', array_length(image_urls, 1) + 1
    )
  WHERE vehicle_id = NEW.vehicle_id
    AND event_date = DATE(NEW.taken_at);
    
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## AI Analysis During Upload

**When:** Immediately after image upload completes  
**Input:** All photos for that date  
**Process:**

1. **Extract EXIF device fingerprint**
2. **Check if device matches known user** → if not, create ghost_user
3. **Analyze photo content** (GPT-4 Vision):
   - What's visible? (speedsheet, damage, repairs, listing presentation)
   - Activity type? (inspection, delivery, work session, listing photos)
   - Participants? (seller, buyer, technician, photographer)
4. **Update event** with AI-generated title and description
5. **Link participants** (ghost users, organizations from GPS)

## Ghost User Attribution

```javascript
// During upload EXIF extraction
const deviceFingerprint = `${exif.Make}-${exif.Model}-${exif.SerialNumber}`;

// Check if device belongs to uploader
const isKnownDevice = await checkUserDevice(uploaderId, deviceFingerprint);

if (!isKnownDevice) {
  // Create/link ghost user
  const ghostUser = await getOrCreateGhostUser(deviceFingerprint);
  
  // Associate with seller (50% confidence)
  await linkGhostUserToSeller(ghostUser.id, vehicleId, {
    confidence: 50,
    reason: 'Unknown device - likely seller/dealer photographer'
  });
}
```

## Event Display Format

**Before AI Analysis:**
```
Title: "Photos from Jan 06, 2024"
Description: "6 photos • Awaiting AI analysis"
Badge: "PENDING ANALYSIS"
```

**After AI Analysis:**
```
Title: "Initial vehicle inspection"
Description: "Professional documentation showing vehicle condition, speedsheet visible. Unknown photographer (Canon EOS camera)."
Participants:
  - Ghost User #4732 (photographer) [Canon EOS R5]
  - Skylar Williams (uploaded/received photos)
  - Viva Las Vegas Autos (seller - 50% confidence)
Badge: "INSPECTION"
```

## Required Fixes

1. ✅ Timeline events created from photo groups by date
2. ⏳ Ghost user detection from EXIF IMEI
3. ⏳ AI analysis during upload (not after)
4. ⏳ Direct event popup (skip day popup)
5. ⏳ Proper event receipt display

**Ready to implement or need more spec clarification?**

