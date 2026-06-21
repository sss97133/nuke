## YOUR JOB: one structured verdict per image, granular enough that a human couldn't have faked it

You are reading real photographs of a real vehicle build. For EACH local image file in the
worklist below, emit ONE line of compact JSON — a *verdict* — that fills the contract exactly.
This is schema-as-DNA: a lazy tourist caption ("a metal disc on a floor") FAILS validation and
is thrown away. A verdict that names the part, places it in the build, boxes what it sees, and
reasons about why the photo was taken is what lands. Be the expert, not the captioner.

### The contract — every verdict MUST contain these keys

```
{
  "image_id":  "<copy the image_id from this frame's worklist line — verbatim>",
  "vehicle_id":"<copy the vehicle_id from the VEHICLE CONTEXT above — verbatim>",

  "scene_type": one of:
     engine_bay | body_exterior | body_interior | undercarriage | receipt_document |
     data_plate | hand_drawn_diagram | shop_context | fabrication_in_progress |
     paint_booth | wheel_assembly | road_test | off_property | cross_reference |
     product_screenshot | spreadsheet | unknown
     (use off_property when the frame's gps resolves AWAY from the main shop)

  "build_phase_guess": one of:
     discovery | teardown | metalwork | paint_prep | paint_application |
     mechanical_assembly | wiring | interior | final_assembly | drivable |
     show_finish | unknown
     (judge the WHOLE day's phase, then place this frame within it)

  "intent": one of:  labor | inspection | parts_sourcing | communication |
                     acquisition | documentation | unknown
  "intent_confidence": 0.0–1.0,
  "needs_clarification": true   // REQUIRED when intent==unknown OR intent_confidence < 0.6

  "components_seen": [
     { "label": "Dana 44 front axle", "confidence": 0.0–1.0,
       "bbox": [x1,y1,x2,y2], "part_number_guess": "string|null" }
     // one entry per distinct part you can actually point to; bbox is REQUIRED on each
  ],

  "state_observations": {
     "rust_severity": none | surface | pitting | perforation | unknown,
     "paint_state":   bare_metal | primer | sealer | base | clear | aged | unknown,
     "completeness":  stripped | partial | assembled | unknown,
     "damage_callouts": ["optional free-text notes"]
  },

  "workshop_signals": {
     "tools_visible": ["floor jack","MIG welder", ...],
     "fixturing":  freehand | clamped | jig | lift | unknown,
     "weld_quality": none_visible | porous_amateur | clean_consistent | professional | unknown,
     "lighting":   natural_outdoor | fluorescent_shop | low | good | unknown
  },

  "presence": { "person": true|false, "dog": true|false, "place_hint": "string|null" },

  "camera_pose": { "azimuth_deg": 0–359, "elevation": "ground|eye|high|overhead",
                   "distance": "macro|close|mid|wide", "framing": "string" },
     // STRUCTURED ONLY. The literal phrase "3/4" or "three-quarter" is BANNED — describe
     // azimuth/elevation/distance instead.

  "narrative_one_line": "one real sentence (>= 12 chars) — what this frame shows and why it matters",
  "confidence": 0.0–1.0,

  // optional but valued when present (each element's bbox is REQUIRED if you include it):
  "damage_localized": [ { "label": "rust-through", "severity": "perforation", "bbox": [x1,y1,x2,y2] } ],
  "text_regions":     [ { "text": "exact OCR of any visible numbers/labels", "bbox": [x1,y1,x2,y2] } ],
  "needs_review": false,
  "agent_notes": "string|null"
}
```

### Bounding boxes — TWVP, always 0–999

Every `bbox` is `[x1, y1, x2, y2]` in **thousand-width virtual pixels**: the image is a 0–999 grid
on BOTH axes regardless of its real resolution or aspect ratio. (0,0) is top-left, (999,999) is
bottom-right. Box the thing you named — never emit a component, damage, or text region without one.

### The intent gate (this is the load-bearing rule)

`intent` is what the photo is FOR, and **only `intent: "labor"` — with high confidence and (later)
owner confirmation — accrues labor value.** A photo of a part on a phone screen is `parts_sourcing`,
not labor. A text to a teammate is `communication`. A title photo is `documentation`. This gate
exists because the system once booked a parts-sourcing text as $410 of labor. So: when you are not
sure what a photo is for, set `intent: "unknown"` (or a low `intent_confidence`) AND
`needs_clarification: true` — surface the question, never assume the billable case.

### How to think before you write

1. Read the VEHICLE CONTEXT and the whole day's frames first. Hold the build in your head.
2. Follow one component across angles and before/after (rusty rotor → new rotor, same wheel station).
3. For each frame: recognize known parts, place the moment in the timeline, reason about the work.
4. Fill the schema granularly. Vague = rejected. Specific, boxed, build-aware = ingested.

Emit exactly one compact JSON object per line (JSONL). No prose, no code fences, no commentary —
only verdict lines. The worklist (with each frame's image_id, local file path, and hard EXIF
evidence) and the output path follow below.
