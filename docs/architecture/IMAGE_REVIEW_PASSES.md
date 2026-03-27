# Image Review Passes

## Principle

Every pass through the image corpus makes the data better. Nothing is wiped. Corrections are documented. The history of corrections is itself evidence of system maturity.

A photo that was assigned `vehicle_id = K2500` by bulk import and later reassigned to `Suburban` by visual match isn't an error being hidden — it's a correction being recorded. The audit trail shows: "Pass 0: bulk import assigned to K2500. Pass 1: visual classifier reassigned to Suburban with confidence 0.87. Reason: body shape match, chrome trim pattern."

## Pass Model

Each pass is a named, versioned operation that:
1. Examines a scope of images
2. Applies a classification method
3. Records findings as observations (not overwrites)
4. Proposes corrections (not executes them)
5. Executes corrections only when approved (auto or human)
6. Logs every action with before/after state

```sql
CREATE TABLE IF NOT EXISTS image_review_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_number INTEGER NOT NULL,
  pass_name TEXT NOT NULL,          -- 'initial_bulk_audit', 'exif_extraction', 'visual_vehicle_match'
  pass_version TEXT NOT NULL,       -- 'v1.0'

  -- Scope
  scope_query TEXT,                 -- the SQL/filter that defined what images were reviewed
  total_images_in_scope INTEGER,
  images_reviewed INTEGER,

  -- Results
  images_correct INTEGER,           -- assignment confirmed
  images_reassigned INTEGER,        -- assignment changed
  images_unassigned INTEGER,        -- removed from vehicle (goes to user library)
  images_new_assignment INTEGER,    -- assigned for first time
  images_flagged INTEGER,           -- needs human review
  errors_found JSONB,               -- structured error summary

  -- Method
  classification_method TEXT,       -- 'visual_ai', 'exif_device', 'exif_gps', 'human_review', 'content_ocr'
  model_version TEXT,               -- which AI model if applicable
  confidence_threshold NUMERIC,     -- minimum confidence to auto-approve

  -- Metadata
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  initiated_by TEXT,                -- 'system', 'user', 'scheduled'
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS image_review_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id UUID REFERENCES image_review_passes(id),
  image_id UUID REFERENCES vehicle_images(id),

  -- Before state
  previous_vehicle_id UUID,
  previous_confidence NUMERIC,
  previous_method TEXT,

  -- Action
  action TEXT NOT NULL,             -- 'confirm', 'reassign', 'unassign', 'flag', 'enrich'
  reason TEXT,                      -- human-readable why

  -- After state
  new_vehicle_id UUID,
  new_confidence NUMERIC,
  new_method TEXT,

  -- Enrichment (things learned about the image during this pass)
  enrichments_added JSONB,          -- { "vehicle_zone": "exterior_front", "exif_date": "2024-06-15" }

  -- Approval
  auto_approved BOOLEAN DEFAULT false,
  approved_by TEXT,                 -- 'auto:confidence>0.85', 'user:skylar', 'review_queue'
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Pass Sequence

### Pass 0: Original Import (already happened)
- Method: `bulk_upload_context`
- What happened: Photos from iPhoto/photo-export assigned to vehicle based on upload target
- Confidence: 0.2 (low — assignment was assumed, not earned)
- This pass is retroactively documented, not re-run

### Pass 1: EXIF Extraction
- Method: `exif_device` + `exif_timestamp` + `exif_gps`
- Scope: All user photos where `exif_data IS NULL`
- Actions:
  - Extract device, timestamp, GPS from every photo
  - Match device fingerprint to user's known devices → confirms attribution
  - Cluster by timestamp → identify photo sessions (20 photos within 30 min = one session)
  - Cluster by GPS → identify locations (shop, home, dealer, event)
  - Does NOT change vehicle assignment yet — just enriches metadata
- Enrichments: `taken_at`, `device_fingerprint`, `gps_lat`, `gps_lng`, `session_id`

### Pass 2: Visual Vehicle Classification
- Method: `visual_ai`
- Scope: All user photos where device = user's known device (owner-captured)
- Actions:
  - Run visual classifier: is there a vehicle in this photo?
  - If yes: which vehicle from user's fleet? (compare against known vehicle profiles)
  - If multiple vehicles: create soft assignments for each
  - If no vehicle: classify as document/tool/workspace/person/other
  - Propose reassignments where visual match disagrees with current vehicle_id
- Confidence threshold for auto-approve: 0.85
- Below threshold: flag for human review in `/photo-library` queue

### Pass 3: Document/Receipt OCR
- Method: `content_ocr`
- Scope: Photos classified as `is_document = true` in Pass 2
- Actions:
  - Full OCR extraction
  - Parse receipt line items → `document_line_items` table
  - Match part numbers to catalog
  - Match store/vendor to actors
  - Link receipt to vehicle by content (part fitment, work order reference)
  - A receipt with parts for multiple vehicles gets soft assignments to each

### Pass 4: Cross-Reference Validation
- Method: `cross_reference`
- Scope: All photos with vehicle assignments from Pass 0 (bulk) that weren't confirmed by Pass 2
- Actions:
  - Compare Pass 0 assignment (bulk context) vs Pass 2 suggestion (visual match)
  - If they agree: bump confidence to 0.9
  - If they disagree: flag for review, show both suggestions in `/photo-library`
  - If Pass 2 found no vehicle: unassign (move to user library inbox)
- This is where the 42K mis-assigned photos get corrected

### Pass N+1: Continuous
- Every new upload goes through Pass 1-3 immediately
- Periodic re-runs of Pass 2 as the visual classifier improves
- Each re-run documents what changed from the previous pass
- The system's correction rate over time is a measure of its own improvement

## The Correction Record

When a photo moves from K2500 to Suburban:

```json
{
  "action": "reassign",
  "image_id": "abc-123",
  "previous_vehicle_id": "a90c008a (K2500)",
  "previous_confidence": 0.2,
  "previous_method": "bulk_upload_context",
  "new_vehicle_id": "73085dcf (Suburban)",
  "new_confidence": 0.87,
  "new_method": "visual_ai_v2",
  "reason": "Visual classifier detected square-body Suburban body shape. Chrome trim pattern matches Suburban profile. K2500 has different bed configuration.",
  "enrichments_added": {
    "vehicle_zone": "exterior_driver_side",
    "ai_detected_angle": "side",
    "ai_detected_angle_confidence": 0.92
  },
  "auto_approved": true,
  "approved_by": "auto:confidence>0.85"
}
```

This record is permanent. It shows:
- What the system believed before
- What it believes now
- Why it changed its mind
- How confident it is
- Whether a human approved or it was auto-approved

## Integration with Photo Library UI

The `/photo-library` page gains a new mode: **Review Queue**

- Shows photos flagged by the latest pass (confidence < threshold)
- Side-by-side: "Pass 0 says K2500. Pass 2 says Suburban. Which is correct?"
- User confirms/overrides → logged as `approved_by: 'user:skylar'`
- Keyboard shortcuts: Y (accept suggestion), N (keep current), V (assign to different vehicle), S (skip)

The photo library isn't just an inbox for new photos. It's the human-in-the-loop correction interface for every pass the system runs.

## Metrics

Each pass produces a quality report:

```
PASS 2 RESULTS (Visual Vehicle Classification)
  Scope: 42,163 user photos
  Reviewed: 42,163 (100%)

  Confirmed correct:     18,421 (43.7%)  — bulk assignment matches visual
  Reassigned:             8,234 (19.5%)  — wrong vehicle, now corrected
  Unassigned:            11,892 (28.2%)  — not a vehicle photo (tools, docs, people)
  Flagged for review:     3,616 (8.6%)   — ambiguous, needs human

  Net accuracy improvement: 43.7% → 63.2% confirmed
  Remaining uncertainty: 8.6% in review queue
```

Over time, the confirmed-correct percentage should approach 95%+. The rate of improvement between passes is the system's learning curve made visible.
