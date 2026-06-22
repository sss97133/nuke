# Chapter 16: The Image Attribution Harness

## Why this chapter exists

Deep image analysis can be excellent and still produce a worthless vehicle profile.
On a real garage (test user, 2026-06-21) the analysis read a data plate down to the
serial — "International Harvester Scout 80 4x4, serial FC 26799A" — and correctly
flagged the frame off-subject. Yet that frame, and ~40 others, were attached to a
**1966 Mustang**. The analysis was right; the *attribution* was wrong. Only 45% of
the Mustang's analyzed photos actually depicted a Mustang.

The lesson that organizes this chapter: **a count of "images analyzed" is a vanity
metric. The unit of correctness is whether each verdict is bound to the right
vehicle.** A fast wrong attribution is negative value — it pollutes a profile you
then pay to clean. Accuracy, not throughput, is what compute is spent on.

This chapter defines the vocabulary and the architecture for getting the binding
right, especially for the hard case: the close-up and the non-obvious frame.

---

## The thesis: model the expert glance

An expert can look at almost any vehicle photo and be reliably close. Naming *why*
gives us the architecture, because the machine must be handed deliberately what the
expert carries for free.

1. **Gestalt over priors.** The expert matches the whole-image signature against a
   vast library of examples and resolves the **genus** instantly (square-body Chevy,
   early Bronco, a '66 Mustang). Fast, holistic, sub-second.
2. **Convergence, not single cues.** No one cue decides. Valve-cover color, bolt
   pattern, casting roughness, patina, fastener style — each is weak, but they
   **converge**. Confidence is *agreement among independent cues*, not a single
   score. This is why the genus is reliably right: it is over-determined.
3. **Context as a silent prior.** The expert knows whose shop this is and what was
   just in frame. A carburetor close-up is not ambiguous to them because *they know
   they are standing at the Scout.* This is Bayesian context the machine throws away
   when it judges a frame in isolation.
4. **Calibrated humility.** "Almost always close" ≠ "certain." The expert nails the
   genus and holds the **species** (exact trim, casting date, build history) as an
   open question. The system must likewise be confident about the genus and explicit
   about the unresolved species.

A frame analyzed alone will always underperform the expert, because the expert's
edge is the context the frame doesn't contain. **The harness is the machine's
substitute for that context.**

---

## Definitions (the new vocabulary)

- **Subject identity.** What vehicle a frame actually depicts: `{depicted_make,
  depicted_model, confidence, identity_evidence}`. Distinct from `vehicle_id`, which
  is the vehicle the frame is *attributed to*. Mis-attribution = subject identity ≠
  attributed vehicle.

- **Anchor.** A frame whose subject identity is self-evident from its own pixels — a
  full-vehicle shot, a badge, and most authoritatively a **data plate / VIN /
  casting number**. Anchors carry identity for everything around them.

- **Detail (non-obvious) frame.** A close-up — carburetor, weld, bolt, bracket —
  that cannot self-identify. It must **inherit**, never be guessed from its pixels.

- **Capture session.** The unit of attribution, *not* the image. A continuous
  shooting run, reconstructed from `taken_at` proximity + GPS + (when populated)
  `upload_batch_id`. You shoot a vehicle wide, then zoom into details; the details
  are temporally bracketed by the anchors. A **sweep** is a session containing more
  than one subject (a lot/facility walk) — it must be segmented by subject, not
  moved wholesale.

- **Inheritance.** A detail frame takes the subject of the nearest anchor within its
  session. This is the formal answer to "how do you attribute a close-up": *you
  don't analyze it, you inherit from its session.* Inheritance is computed by
  comparing the **narratives** of temporally adjacent frames — text against text,
  never re-reading the pixels — so it is nearly free.

- **Context folder (work session).** The strongest prior of all, because it encodes
  *intent* — but it is **evidenced, never declared.** The technician does not tell
  the system what they are working on; **they already testified by shooting.** The
  photo declares the intent (a teardown shot *is* the teardown), the sequence
  declares the session, and the **device signature** signs who testified. A
  dash-teardown close-up that names no marque is not ambiguous, not because anyone
  declared the subject, but because it is signed by the same device, within the same
  time/place run, inside a progression that is visibly the 1989 R3500. **Soliciting a
  declaration is friction for evidence the system already holds.** The rail
  `vehicle_images.work_session_id` is null — but so is the declaration's premise: the
  fix is not a "what are you working on?" prompt, it is to *read the testimony that is
  already on every frame* (see Device signature, Gap as proof of work). For the
  backlog the folder is reconstructed from that evidence; the owner only adjudicates
  genuine ambiguity in review.

- **Device signature.** The phone/account identity in EXIF — the technician's
  signature on the testimony. Present on 100% of the test frames
  (`exif_data.camera_make/camera_model/synced_by` = "Apple / iPhone 15 Pro /
  capture-relay-ios"), yet **never extracted** into the queryable
  `device_fingerprint` / `documented_by_device` columns (both null). Extracting it is
  the real "context folder" rail: same-device + time + place binds a run of frames
  into one work session without asking anyone anything.

- **Gap as proof of work.** A work session is self-proving through *change*. When the
  sequence goes broken → fixed on the same component, the gap between the states
  **is** the work — and the same part progressing **is** the same vehicle, which
  confirms subject continuity for the whole run, including the close-ups that name
  nothing. State-change is therefore both the proof that a session is real and the
  glue that holds its subject together. (This is the image-as-testimony spine of the
  platform applied to attribution: the tech already testified; we read it.)

- **Album context (sequence, not folders).** The uploaded set is a **gappy subset**
  of the real album, and correct sessionization needs to know the whole — but *not*
  by trusting albums. Proof (test user, 2026-06-20): the day's frames are filenames
  IMG_1373–1507 — a 135-frame span, of which only **122 uploaded; 13 neighbors exist
  locally and the cloud never sees them.** The dependable local signal is the
  **chronological sequence and its completeness** — how many frames bracket this one,
  which exist locally but haven't uploaded, which are still coming — so the cloud
  stops sessionizing from a sequence with holes. **Albums/folders are NOT dependable
  and must never key attribution**: a user may treat an album as a random bag (the
  relay even synced `source_type:"user_library"`, the whole roll). The contiguous
  `original_filename`/time run is a useful *session* signal (one IMG_ run ≈ one
  shoot); but the *subject* of those frames always comes from **content** (signatures
  + the harness), never from which album they sit in. This is the real local+cloud
  split: local supplies full-sequence awareness (count, position, neighbors,
  pending); the cloud does the content read.

- **Knowledge-base re-pass.** Once a frame's subject is fixed (by anchor, inheritance,
  or context folder), the read can be sharpened by re-running it *with the correct
  vehicle's dossier as context* — its receipts, parts, prior verdicts. This is not a
  blind vision re-run; it is a cheap, knowledge-informed second look (text over the
  existing verdict + the dossier), and it embodies the DB-as-memory thesis: hand the
  read the right memory and it improves for free. Vision pixels are re-touched only on
  the rare residual the dossier still can't resolve (top rung of the ladder).

- **Component DNA.** Marque-level cues the analysis already extracts
  (`components_seen`, `state_observations`) — an IH slant-4 is not a Ford V8 is not a
  Chevy small-block. Used to *cross-check* an inherited subject (agree → confidence
  up; contradict → flag), never as the primary signal for a detail frame.

- **Kin network.** The set of a user's other vehicles (and discovered/comp
  vehicles). The home-resolution space: a mis-attributed segment is re-homed to the
  kin vehicle it actually depicts (the Scout frames → the 1961 Scout 80), not
  orphaned. Owned vehicles vs discovered/comp vehicles are different kin tiers and
  must not pool their data (see Chapter 9, Discovery System).

- **Authority / resolution ladder.** Where the system "turns" when gestalt
  confidence is low — descended only as far as needed, never skipped to a guess:
  1. the object's own marks (data plate, VIN, casting numbers, date codes),
  2. the paper (title, build sheet, receipts, original listing),
  3. the reference corpus (marque registry, casting-number books, decoders),
  4. the kin and comps (compare to known examples),
  5. the human of last resort (marque club, the person who knows).

- **Two-speed engine.** The analysis as a whole: **fast gestalt** for coverage and
  calibrated confidence, **slow authority-resolution** for the details that matter.
  Low confidence escalates down the ladder; it does not emit a coin-flip dressed as
  a verdict.

---

## Architecture

### Stage 0 — Deep analysis (existing)
`scripts/deep-image-analysis-byok.mjs` writes per-frame verdicts to
`vehicle_images.ai_scan_metadata.byok_deep_analysis` against the contract in
`scripts/schemas/byok-image-verdict.schema.json` (schema-as-DNA: a tourist-caption
verdict cannot land). Rich today: scene_type, components_seen, state_observations,
camera_pose, GPS place_hint, narrative_one_line.

**The gap:** the verdict schema has no structured `subject`. The model identifies the
vehicle in prose ("International Harvester Scout 80") but never asserts it as data,
and never states whether it matches the attributed vehicle. So a Scout verdict
validates fine on a Mustang. The early-stage fix (forward): add a required `subject`
block —
```
subject: { matches_target: yes | no | detail_inherits | uncertain,
           depicted_make, depicted_model, match_confidence, identity_evidence }
```
`detail_inherits` is the close-up declaring it must be resolved by the harness, not
by itself.

### Stage 1 — Subject extraction
For the **backlog** (verdicts already written), extract structured subject from the
existing prose with a **text-only LLM pass** — no re-vision, cheap compute. This is
the load-bearing step: it was proven empirically that SQL token-matching *cannot* do
it (see Empirical Findings). The output is normalized `{depicted_make,
depicted_model, confidence}` that matches cleanly against the kin garage.

### Stage 2 — Sessionize → anchor → inherit
Group a vehicle's frames into capture sessions (`taken_at` 30-min bucket + GPS, until
`upload_batch_id` is backfilled). Within each session: anchors set the subject; detail
frames inherit the session's dominant anchor; component DNA cross-checks. A session
with **no anchor** resolves to nothing and goes to review — it is not guessed.

### Stage 3 — Reconcile and re-home (reversible)
Each frame whose resolved subject ≠ its attributed vehicle is a **proposal**, written
to `image_attribution_review` (status `proposed`) with its evidence, resolution
(`anchor` | `inherit` | `review`), session key, and proposed kin home. Applying a
proposal sets `image_vehicle_match_status` and (on confirmation) moves `vehicle_id`,
recording provenance so it is reversible. **Nothing moves until applied.** The
primary-image chooser already excludes `mismatch`/`unrelated` (Chapter, primary
image), so flagging a frame removes it from the wrong profile *before* the move.

### Tables / functions
- `image_attribution_review` — reversible staging of proposals.
- `reconcile_vehicle_attribution(vehicle_id)` — runs Stages 2–3, writes proposals.
- `image_vehicle_match_status` — the early-stage mismatch signal (exists; was dead —
  null on the Scout frames — because nothing fed it).
- `image_component_targets`, `image_text_targets`, `get_vehicle_component_inventory()`
  — depth-promotion views exposing the per-frame component/OCR targets as queryable
  rows (see "Depth promotion" below).

---

## Empirical findings (2026-06-21, test user)

- Deep analysis quality is high: it reads data plates and identifies marque/model.
- Attribution is the failure: 168 analyzed frames are explicitly self-flagged
  off-subject; the Mustang held a full Scout shoot.
- The session + inheritance mechanics **work**: they cleanly split 30 Scout frames
  (anchors + inherited close-ups) from 209 Mustang frames and parked 24 un-anchorable
  frames in review — no pixel-guessing of close-ups.
- A single capture sweep is **many-subject**, not two. One 2026-06-20 sweep on the
  Mustang held: a Scout, a square-body Suburban/Blazer, a crew-cab pickup, a *second*
  (later) Mustang, a Honda CB motorcycle, dash-teardown close-ups that name no
  vehicle, and shop-context frames. Text extraction over the existing narratives
  recovered every self-identifying subject for ~zero compute; the residual was
  exactly the unnameable close-ups — which the work session resolves (the technician
  knows that teardown is the 1989 R3500 Cheyenne, `b1edd5c1`, confirmed in the
  garage).
- **The testimony is already signed.** All 122 frames of that sweep are stamped in
  EXIF by one device — Apple iPhone 15 Pro via capture-relay-ios — across one work
  day (01:10–21:55). The technician signed every frame; the system simply never
  extracted the signature (`device_fingerprint` null on 100%). Attribution does not
  need a declaration; it needs to *read what is already there*.
- **Subject identity cannot be done in SQL.** Token-overlap against the kin garage
  trades false positives (a pseudo-vehicle "Unassigned Vehicle **Photos**" matching
  any narrative with "photos"/"vehicle"; "Intake Quarantine" matching engine
  "intake") for false negatives (excluding craigslist-source kin to kill garbage
  tokens also drops the real Scout, which is a *discovered* vehicle). An LLM
  disambiguates "international harvester scout" from "intake" trivially; SQL cannot.
  Hence Stage 1 must be an LLM pass.

---

## The schema already encodes this theory (the gap is wiring, not design)

Investigating the live DB, every concept above already exists as schema — the system
was designed for the testimony model and then left unwired at the joins:

- **Device signature**: `generate_device_fingerprint()` →
  `get_or_create_ghost_user()` → `device_attributions` + `ghost_users`, plus the
  denormalized `vehicle_images.device_fingerprint`. *Was* dead on iOS photos because
  it read only standard EXIF keys; **fixed** 2026-06-21 to read the relay's
  `camera_make/camera_model/synced_by`, and backfilled (14,944 frames signed, 59
  devices). This is the one fix that was a true bug, not a missing build.
- **Work session (context folder)**: the `work_sessions` table is fully modeled —
  `technician_phone_link_id` (device link), `place_id`, `start/end_image_id`,
  `zones_touched`, `stages_observed`, `stage_transitions` (the broken→fixed
  progression — *gap as proof of work*, schematized), `intent`/`intent_source`,
  `evidence`, and `owner_confirmed_at/by`. 789 sessions already exist for the test
  user, but the per-frame back-link `vehicle_images.work_session_id` is null — the
  sessions float, unlinked. **Crucially it requires `vehicle_id NOT NULL`**: a work
  session is bound to one vehicle, so a multi-subject sweep cannot be bound until the
  subject is resolved.
- **Mismatch signal**: `image_vehicle_match_status` exists and the primary chooser
  already respects it — but it is null/unfed (see above).

The dependency chain is therefore: **device signature (now wired) → subject identity
(the one missing capability) → work-session binding → attribution reconciliation.**
Every downstream rail waits on the same thing — structured subject extraction — which
is why that LLM-over-prose pass (Stage 1) is the keystone, not an optional nicety.

---

## Depth promotion: the many targets per image (2026-06-22)

Subject identity (which vehicle) is only the *shallow* layer. Each frame is
**many-target**: the deep-analysis verdict already carries ~3.7 `components_seen`
detections + OCR `text_regions` per frame, each with a label/confidence/bbox. That
depth was landing but **trapped**: it lived only as nested arrays inside
`vehicle_observations.structured_data` (one observation row per image) and the JSONB
blob — so you could not query "every frame showing a 289 V8" or "every OCR serial."

The relational tables built to hold it (`component_identifications` + its required
parent `image_analysis_records`) are **dead** — the abandoned "reference system"
pipeline, listed in `docs/dead_tables_candidates.txt`, gated behind an analysis-record
FK nothing populates. Reviving them would fight the grain; backfilling tens of
thousands of target rows would duplicate the 7.5M-row observation firehose.

**Fix (migration `20260622010000`): expose, don't duplicate.** Two `security_invoker`
views explode the already-landed targets, plus an inventory helper:
- `image_component_targets` — one row per component (label, part_number_guess,
  confidence, bbox, scene_type, build_phase, agent_model).
- `image_text_targets` — one row per OCR region (text, confidence, bbox) — the
  badges/data-plates/**serials**, the strongest identity evidence.
- `get_vehicle_component_inventory(vehicle_id)` — aggregated sightings per vehicle.

Zero data migration, fully reversible, always fresh as the drain writes more.
Measured on the 1966 Mustang (`8bde1dda`): 368 byok image observations → **1,352
component targets + 194 text targets** instantly queryable. The view did real work the
moment it existed: it surfaced the cross-make pollution as *data* — `"Chevy-orange
small-block V8"` ranked #2 component on a Ford; an OCR'd `SCOUT 80 4X4 FC 2579 A`
data-plate serial on the Mustang record — and flagged a **privacy** hit (an OCR'd
`State of Nevada Declaration of Paternity` / vital-records form sitting in a vehicle
record, which must be quarantined, not re-homed).

**Depth-aware Stage 1.** The subject classifier (`scripts/classify-image-subjects.mjs`
forward; this run fed it `narrative + components + ocr` per frame) is now evidence-rich
rather than caption-only: the OCR/component targets make Scout/Honda/document frames
unambiguous, and the prompt enforces "never guess among near-identical records → NONE,"
so de-pollution is high-precision and specific re-homes require unambiguous evidence.
Runs on the Claude **subscription** (`claude --print`, no per-token API). Note: a
single `--print` call is slow (minutes); batch ~30 frames and run detached.

### Mustang cleanup results + two traps (2026-06-22)

Applied to the 1966 Mustang (`8bde1dda`), the user's "look at my garage" test case.
Outcome: gallery dropped from **385 → 183 visible** (186 frames flagged `unrelated`,
82 `confirmed`); the off-subject set was an orange Chevy small-block engine series, GMC
Suburbans, an International Scout, a C2 Corvette, ~13 personal/family photos (newborns),
a paternity/vital-records form, and a revolver. The sensitive PII was confined to this
vehicle; the "Certificate of Title" OCR hits on other vehicles are legitimate titles.

Two traps worth remembering:
- **Negation defeats keyword matching (again).** A deterministic de-pollution pass keyed
  on `narrative ~ 'mustang'` wrongly marked frames `confirmed` whose narrative read
  *"…Mustang **absent**"* or *"**not the** Mustang"*. One such frame ("garage bay, Mustang
  absent") had even become the lead image. Keyword presence ≠ subject; this is exactly why
  Stage 1 is an LLM, and why deterministic passes must be treated as a stopgap and
  manually reviewed (the 11 mis-marked frames here were corrected by explicit id).
- **The lead image followed the newest upload, not the subject.**
  `recompute_vehicle_primary_image` picked the latest eligible owner photo, so when the
  newest uploads were off-subject shop/parts shots the primary became junk; the old
  "prefer exterior" tier keyed on `vehicle_zone`, which is empty. Fixed (migration
  `20260622030000`): prefer `confirmed` subject first, and detect "exterior" from the
  analysis `scene_type = 'body_exterior'`. Because the `sync_vehicle_primary_image`
  trigger fires on `image_vehicle_match_status` change, every vehicle's lead image now
  **auto-heals** as the classifier confirms/flags its frames.

---

## Drift notes (verify against prod before trusting)

- `byok-vision-prompt.md` is referenced by `byok-image-batch.sh` but **missing from
  the repo** — the cloud drain `cat`s a file that isn't there, degrading the prompt.
  Recreate before relying on the forward-fix.
- `upload_batch_id`, `work_session_id`, `device_fingerprint`, and
  `documented_by_device` are all **null** across `vehicle_images` — the rails exist,
  unpopulated. But the underlying evidence is **not** missing: `exif_data` is present
  on 100% of frames and already carries the device signature
  (`camera_make/camera_model/synced_by`). The highest-leverage fix is therefore to
  **extract the signature from EXIF and derive the work session from evidence**
  (device + time + place + state-change), not to add a declaration UI — the testimony
  is already on the image.
- One-off cleanup scripts exist (`fix-mixed-vehicle-data.js`,
  `cleanup_vehicle_contamination.js`) — prior attempts that did not stick because
  they never fixed the DNA (no structured subject, no harness). This chapter is the
  durable replacement.
