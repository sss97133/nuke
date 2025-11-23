# Photo Event Grouping Framework

**Core Principle**: Photos taken on the same date by the same device = ONE event that needs AI analysis to understand what happened.

## Grouping Logic

### Primary Grouping Key: `DATE(taken_at)` + Device Fingerprint

Photos are grouped into ONE event when they share:
1. **Same calendar date** (YYYY-MM-DD from EXIF `taken_at`)
2. **Same device** (EXIF camera make/model/IMEI)

### Device Fingerprint

Extract from EXIF:
```sql
device_fingerprint = CONCAT(
  COALESCE(exif_data->>'Make', 'Unknown'),
  '-',
  COALESCE(exif_data->>'Model', 'Unknown'),
  '-',
  COALESCE(exif_data->>'SerialNumber', 'Unknown')
)
```

**Examples:**
- `Apple-iPhone 14 Pro-DMQXH7J2Q6` = Known user device
- `Canon-EOS R5-Unknown` = Professional camera (ghost user)
- `Unknown-Unknown-Unknown` = Screenshot or edited image

### Ghost User Detection

When device fingerprint doesn't match any known user device:
- **Create or link to ghost_user** based on device fingerprint
- Flag event as "photographer unknown - claimable"
- AI can infer: "Initial inspection by third party"

### Time-Based Sub-Grouping

**If >20 photos on same date from same device:**
Split into sessions by time gaps >2 hours

Example:
- 8:00 AM - 9:30 AM: Morning inspection (15 photos)
- 2:00 PM - 4:00 PM: Afternoon detail shots (25 photos)
= 2 separate events same day

## AI Prompt Engineering for Event Analysis

### Input to AI:
```json
{
  "vehicle": {
    "year": 1976,
    "make": "Chevrolet",
    "model": "Silverado C20"
  },
  "photo_session": {
    "date": "2024-01-06",
    "photo_count": 6,
    "device_fingerprint": "Unknown-Unknown-Unknown",
    "is_known_device": false,
    "photographer_user_id": null,
    "uploader_user_id": "0b9f...",
    "time_span": "17:10:54 - 17:11:44 (50 seconds)",
    "gps_coordinates": [lat, lon] or null
  },
  "image_urls": [...]
}
```

### AI Analysis Prompt:
```
Analyze this photo session and determine:

1. **Event Type**: What activity is documented?
   - initial_inspection (first time viewing vehicle)
   - site_visit (owner checking on vehicle)
   - delivery (vehicle arriving at location)
   - work_session (repair/maintenance being performed)
   - listing_photos (professional photography for sale)
   - damage_documentation (accident/issue recording)

2. **Participants**: Who was involved?
   - If unknown device → "Third-party photographer (identity unknown)"
   - If known device → Map to user
   - Check GPS for nearby organizations

3. **Event Title**: Generate concise title (max 50 chars)
   Examples:
   - "Initial vehicle inspection"
   - "Site visit and condition check"
   - "Vehicle delivery to storage"
   - "Professional listing photography"

4. **Description**: 1-2 sentences explaining what photos show

5. **Confidence Score**: How certain are you? (0-100)
```

### AI Output Format:
```json
{
  "event_type": "initial_inspection",
  "title": "Initial vehicle inspection by third party",
  "description": "Professional photos documenting vehicle condition. Unknown photographer (device not recognized). Likely seller or dealer inspection photos.",
  "photographer_type": "ghost_user",
  "participants": [
    {
      "role": "photographer",
      "user_id": null,
      "device_fingerprint": "Unknown-Unknown-Unknown",
      "attribution": "Unknown photographer - claimable"
    },
    {
      "role": "recipient",
      "user_id": "0b9f...",
      "attribution": "Received/uploaded photos"
    }
  ],
  "inferred_location": "Vehicle storage or dealer lot",
  "confidence": 85
}
```

## Implementation Questions

**Q1: What if photos have no EXIF date?**
- Use file `created_at` as fallback
- Flag as "estimated_date" in metadata
- Lower confidence score

**Q2: What if same date but different GPS locations?**
- Split into separate events if GPS distance >1km
- Exception: Transport events (moving vehicle)

**Q3: What about bulk imports (BAT, Dropbox)?**
- External URLs without EXIF: Use listing date or vehicle year
- Group by source URL pattern
- Flag as "listing_documentation" not user-generated

**Q4: Screenshots vs real photos?**
- Screenshots: No camera EXIF = different event type
- Title: "Documentation screenshot" not "photo session"

**Q5: What triggers AI analysis?**
- **Immediately on upload?** (costs API calls)
- **Batch overnight?** (cheaper but delayed)
- **On-demand when user views timeline?** (lazy load)

## Decision Needed

What grouping assumptions should we make?

**Option A: Strict Date Grouping**
- All photos same date = ONE event regardless of device
- Pro: Simple, clean timeline
- Con: Might merge unrelated sessions

**Option B: Date + Device Grouping** (RECOMMENDED)
- Photos grouped by date AND device fingerprint
- Pro: Separate ghost user photos from owner photos
- Con: More events to analyze

**Option C: Date + Time Gap Grouping**
- Photos within 2 hour window = same session
- Pro: Handles multi-session days
- Con: Complex logic, might split related photos

**Which approach should we use?**

