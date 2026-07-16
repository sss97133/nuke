# Vehicle Profile Testing Playbook

## End-to-End Test: Photo Pipeline
1. Take a photo at shop GPS
2. Verify it syncs to Photos.app
3. Verify cron job picks it up
4. Query: `SELECT count(*) FROM vehicle_images WHERE vehicle_id = ? AND source = 'photo_auto_sync'`
5. Open vehicle profile on nuke.ag
6. Verify photo appears in gallery
7. Verify photo appears in timeline as photo_session event

## End-to-End Test: Session Pipeline
1. Run context stitcher for a date: `python3 scripts/context-stitcher.py --date YYYY-MM-DD`
2. Query: `SELECT * FROM image_sets WHERE vehicle_id = ? AND session_start::date = ?`
3. Open vehicle profile
4. Verify session appears in barcode timeline
5. Click date dot — verify DayCard popup shows session details

## End-to-End Test: Actor Pipeline
1. Query: `SELECT * FROM actors WHERE id = ?`
2. Check work_orders linked to this actor
3. Open vehicle profile
4. Verify work history shows in WORK tab

## Test Vehicles (known good data)
- K10 SWB: `80e04dd6-983e-4c78-ba15-c0599e50ecd9` — 166 photos, 2 sessions, 1 work order
- K2500 Sierra Classic: `a90c008a-3379-41d8-9eb2-b4eda365d74c` — 2,821 photos, 35 work sessions
- Bronco 71: `c6189023` — 640 photos

## Quick DB Checks

```sql
-- Photo count by source for a vehicle
SELECT source, count(*) FROM vehicle_images
WHERE vehicle_id = '80e04dd6-983e-4c78-ba15-c0599e50ecd9'
GROUP BY source ORDER BY count DESC;

-- Image sets (sessions) for a vehicle
SELECT id, name, event_date, session_duration_minutes
FROM image_sets
WHERE vehicle_id = '80e04dd6-983e-4c78-ba15-c0599e50ecd9'
ORDER BY session_start DESC;

-- Timeline events for a vehicle
SELECT event_type, count(*) FROM timeline_events
WHERE vehicle_id = '80e04dd6-983e-4c78-ba15-c0599e50ecd9'
GROUP BY event_type;
```

## What to Verify on Profile Page

1. **Hero image**: Should be a good exterior shot (not interior/document)
2. **Gallery count**: Should match DB count (minus documents/duplicates/rejected)
3. **Barcode timeline**: Should show activity dots for dates with photos/sessions
4. **DayCard popup**: Clicking a date dot should show session details
5. **No crashes**: Page should not white-screen on any vehicle
6. **BuildManifestPanel**: Should return null gracefully if no manifest data (not crash)
