# Image reading map, 2026-11-10: free signals for choosing what to read

Made by a read-only agent over the repository on 2026-11-10 for the owner direction recorded in
`docs/ledger/theory/data-machine.md` ("Image analysis is the model asking"). Repo only: nothing here was checked
against production, and a later definition may have replaced a cited one. An audit output, not active guidance:
verify a finding before acting on it (`docs/ledger/README.md`).

## Summary

Repo only; nothing here was checked live. Plenty of free signal exists, but almost none of it reaches the thing that decides what gets read: reconcile_image_stages and claim_image_stage_work order photos by upload time only (newest upload in a two-day "live" lane, oldest upload in the backfill lane), and a work item carries no priority, vehicle, set, label or document flag. The phone computes labels, an is-vehicle verdict, a face check, OCR text, checked VIN and plate reads, a zone guess, a similarity print and a perceptual hash for free; only the label names, clock, place, byte hash and asset id travel on the row, the OCR and VIN reads land buried in image_observations jsonb, the tag push lands in a jsonb key nothing reads, and the hashes never leave the phone. The one index the queue walks (idx_vehicle_images_capture_ledger) already carries capture clock, filed-or-not (vehicle_id) and vision_gate_status without touching the 57 GB heap; every other signal is a heap column or a side table keyed by image or vehicle. Sets are computed on demand by the filing scorer and stored only as uuid arrays; the only per-photo session key stored at insert is timeline_event_id, and no code picks one frame to stand for a set. The only label-based skip of the paid classifier is unreachable for phone photos (it needs vehicle_score, which the phone never sends), and the stage registry's document test names types the classifier never emits. "What matters this week" exists without forms (open work orders and their photo windows, work sessions, vehicle views, last-7-day inflow per vehicle, open receipt questions ranked by price) and none of it is read by the queue. The repo holds one measured warning about prejudice: sets filed on day-pattern priors alone were wrong about half the time, so priors were demoted to "hold for review" unless the photos themselves gave evidence. For the three questions: Q1 has a real path (receipt line to zone to candidate frames to a bounded paid question) that stops for felts because weatherstrip is classed as not photographable; Q2 and Q3 depend on the deep read's free-text damage notes and on change-claim tables whose writers are not in the repo. Seven different queue orderings coexist, and the dearest read (the deep read) is the one that already goes earliest-day-first and reads every frame of the day.

## The three questions

### Q1. Mustangs whose window felts were replaced during a restoration, with photographic proof.

**Path today.** A receipt for the felts is read (classifier, then receipt-photo-ocr, then document pages and receipt lines). receipt_work_lines then looks for photos of the line's zone taken after the purchase date, using zones that are free (Apple labels) or already paid for (classifier angle, vehicle_zone, deep scene_type), and the producer raises a 'receipt_part_visible' question over at most eight candidate frames, ranked by the line's price. An answered question (visible, installed, image_id, bbox) is the photographic proof; it is stored in evidence_judgment_requests.answer and read per vehicle by get_vehicle_receipt_work_context. For felts the chain stops at the first step: receipt_line_photo_zone returns NULL for 'weatherstrip' (grouped with loose hardware as something a photo would not show) and has no word for felt, window channel or door glass, so the line concludes part_zone_unknown and no frame is ever nominated (supabase/migrations/20261111210500_receipt_work_reconciliation.sql:55,241). 'During a restoration' has no stored marker beyond free-text fabrication_stage and build_phase_guess on frames and work_sessions rows. 'Mustangs' needs a join to vehicles across vehicles; the reader is per vehicle.

```sql
-- not run; repo only. Askable only after questions are answered and felts have a zone:
select v.id, v.year, v.model, j.answer->>'image_id' as proof_image, j.answer->'bbox' as bbox
from evidence_judgment_requests j join vehicles v on v.id = j.vehicle_id
where j.question_kind = 'receipt_part_visible' and j.status = 'answered'
  and j.answer->>'installed' = 'yes'
  and lower(v.make) = 'ford' and v.model ilike 'mustang%'
  and j.params #>> '{context,description}' ~* 'felt|window sweep|belt ?(line )?weatherstrip';
```

**Smallest missing piece.** A zone for door and window-opening parts in the two existing immutable functions receipt_line_photo_zone and image_photo_zones; without it no free signal can nominate a frame for this part. Then a cross-vehicle reader over answered receipt_part_visible questions (or over vehicle_change_claims once it has writers); none exists. For ordering reads: the queue has no way to learn that a receipt is waiting on a vehicle's frames, because evidence_judgment_requests.vehicle_id is read by neither reconcile_image_stages nor claim_image_stage_work.

### Q2. A Porsche that has a specific imperfection on it.

**Path today.** A flaw is recorded only by a dear read. The deep read writes damage_localized (free-text label, bbox, severity surface, pitting or perforation) and state_observations into ai_scan_metadata.byok_deep_analysis, a heap jsonb key per frame (scripts/daily-receipt/byok-vision-prompt.md:36-40). Older columns damage_flags and condition_score hold YONO-era values. surface_observations (zone, severity, lifecycle_state, descriptor_id to condition_taxonomy, surface coordinates) is described in the repo as unwritten since May 2026 (supabase/migrations/20261007222000_describe_surface_observations.sql:6). component_identifications holds free-text labels with nothing linking the same part across frames (supabase/migrations/20261008020000_describe_component_identifications.sql:53). No free signal points at a flaw frame: Apple labels have no damage words. The first paid pass gives image_type detail_closeup and angle detail_shot, which mix flaws with badges and trim. A free CLIP embedding exists per frame but is compared only with vehicle anchors.

```sql
-- not run; repo only. Heap jsonb, no supporting index in the repo; free-text label match:
select vi.vehicle_id, vi.id
from vehicle_images vi join vehicles v on v.id = vi.vehicle_id
where lower(v.make) = 'porsche'
  and exists (select 1 from jsonb_array_elements(coalesce(vi.ai_scan_metadata #> '{byok_deep_analysis,damage_localized}', '[]')) d
              where d->>'label' ilike '%<the flaw>%');
```

**Smallest missing piece.** For routing: the deep read is not a registered stage and its pool is 'filed and gate approved', so 'read close-ups first, one frame per near-identical group' cannot be expressed; the smallest existing thing to extend is image_pipeline_stages (a row for the deep read, with applies_when able to use the first-pass fields already stored: classification.image_type and v2.angle). For the model: the flaw has no key. The label is free text and vehicle_observations.descriptor_id was added empty (supabase/migrations/20261001140000_c26_condition_claims_notation.sql:10,32), so one specific imperfection cannot be matched across frames or vehicles.

### Q3. That specific imperfection was repaired, and it is now this restored Porsche.

**Path today.** This needs two reads of the same place at two times and a link between them. What exists: taken_at order per vehicle; the deep read's by-day mode, which reads a vehicle's earliest unread day first 'for component lifecycle and before/after' (scripts/deep-image-analysis-byok.mjs:728,744); vehicle_change_claims (kinds repair, body, paint; occurred_from and occurred_to) with vehicle_change_claim_support (vehicle_image, stance supports or contradicts, about condition) as the schema for a claim with before and after photo support; the receipt question's 'installed' answer for a part. What does not: the claim tables have no writer in the repo; nothing links the same physical spot across frames; 'restored' as a state is free text (fabrication_stage, build_phase_guess, lifecycle_state).

```sql
-- not run; repo only. Tables exist, no writer in the repo:
select c.vehicle_id, c.id, s.evidence_id as image_id, s.stance
from vehicle_change_claims c join vehicle_change_claim_support s on s.claim_id = c.id and s.superseded_by is null
where c.superseded_by is null and c.kind in ('repair','body','paint')
  and s.evidence_kind = 'vehicle_image' and s.about = 'condition';
```

**Smallest missing piece.** The writers for vehicle_change_claims and vehicle_change_claim_support, which the guard list names (supabase/migrations/20261021220000_image_evidence_tables.sql:84) and the repo does not contain. For ordering: this is the question where capture order matters, since the earlier frame must be read before or with the later one. The only reader that orders by capture day is the deep read, per vehicle; the stage queue orders by upload time. An unused cheap pairing signal exists: same vehicle, same zone (vehicle_zone, classifier angle or the phone's zone guess), taken_at before and after a receipt or work-session date.

## Findings

### 1. Phone: what Apple Vision computes for free per photo (read)

**What exists.** On the phone, at no cost: scene/object labels with confidences and an is-vehicle verdict (a core vehicle label over 0.10, or all vehicle labels summing over 0.30); a prominent-face check (face box at least 4.5% of the frame); a clutter verdict (screenshot, or a document/web/product label in the top three); OCR text boxes with three candidates each; VIN reads validated by check digit with at most one glyph repair, labelled pre-1981 serials, plate guesses; a zone guess from labels (engine_bay, interior, wheel, shop, outdoor_lot, road, exterior, paperwork); a feature print for similarity; a dHash in the library walk; and a decision category work / not_work / sensitive / work_with_people.

**Writer.** VisionEngine / OnDeviceAnalysis on the device

**Reader.** SyncEngine, AttributionEngine, LibraryIngest (all on the device)

**Where.** apps/nuke-capture-ios/Sources/NukeCapture/VisionEngine.swift:24-33,46-67,203-220,247-258,331-364,410-425; apps/nuke-capture-ios/Sources/NukeCapture/OnDeviceAnalysis.swift:30-37,167-184,271-289,304-337; apps/nuke-capture-ios/Sources/NukeCapture/VisionDecision.swift:20-67; apps/nuke-capture-ios/Sources/NukeCapture/LibraryIngest.swift:253

**Gap.** The decision category, the face result, the is-vehicle confidences, the feature print and the dHash are computed and stay on the phone. Only the consequence of the decision (pixels or no pixels) reaches the server.

### 1. Phone: the capture gate and its skip reasons (read)

**What exists.** Gates run on metadata first, before any bytes are read: not_library (not the user's own library), screenshot (PhotoKit subtype), no_location, off_site (GPS not at a confirmed site); then already-seen and gave_up; the contributor firewall in contributor mode only; then the original bytes; then not_own_camera (EXIF make is not Apple); dedupe; then owner triage (pixels or metadata only). Skips are reported to capture_skips(user_id, asset_id, reason, taken_at, device, decided_at) through report_capture_skips, at most 500 per call. Reasons: no_location, off_site, screenshot, not_library, not_own_camera, personal, gave_up.

**Writer.** report_capture_skips (phone, authenticated)

**Reader.** get_capture_ledger, get_capture_ledger_day (supabase/migrations/20261111190000_capture_ledger_index.sql:164-236)

**Where.** apps/nuke-capture-ios/Sources/NukeCapture/SyncEngine.swift:1053-1066,1077-1083,1106,1109-1110,571-591; apps/nuke-capture-ios/Sources/NukeCapture/CaptureLedgerReport.swift:27-31,105; supabase/migrations/20261111170000_capture_ledger.sql:38-47,58-91

**Gap.** For a skipped photo the server holds an asset id, a reason and a clock: no label, no is-vehicle flag, no place. It cannot rank skipped photos for a later ask; a rescan can only be requested by date (capture_rescan_requests.from_date, same file lines 98-108). The gate is GPS-first, so a vehicle photo taken away from a confirmed site is dropped before Vision looks at it.

### 1. Phone: what travels on the upload row (read)

**What exists.** One vehicle_images row per photo: image_url (public URL, or the empty string when pixels stay on the phone), storage_path, source capture_relay_ios, mime_type, file_name, file_size, is_external false, ai_processing_status (pending with pixels, skipped without), user_id, documented_by_user_id, latitude, longitude, taken_at (EXIF DateTimeOriginal, else PhotoKit creation date), file_hash (SHA-256 of the bytes), apple_ml_labels (up to 12 label names, no confidences), exif_data {uuid = PHAsset id, original_filename, synced_by, camera_make, camera_model, source_type, owner_verified}.

**Writer.** SupabaseService.buildImageRow

**Reader.** insert trigger, orchestrator, reconciler

**Where.** apps/nuke-capture-ios/Sources/NukeCapture/SupabaseService.swift:22-49,561-597; apps/nuke-capture-ios/Sources/NukeCapture/SyncEngine.swift:1117-1148

**Gap.** Not on the row: OCR text, VIN or plate hits, label confidences, is-vehicle, face, decision category, perceptual hash, album, burst, session key. Of what does travel, idx_vehicle_images_capture_ledger carries user_id, coalesce(taken_at, created_at), the exif uuid, id, taken_at, created_at, vehicle_id and vision_gate_status (supabase/migrations/20261111190000_capture_ledger_index.sql:29-32). Labels, place, file_hash and source need the heap.

### 1. Phone: metadata-only rows (pixels held on the phone) (inferred)

**What exists.** A frame the device rule calls clutter (document, receipt, paper, text, form and similar in the top three labels), personal (prominent face with no vehicle or work context) or work-with-people uploads as a row with image_url '' and ai_processing_status 'skipped'. Its label names still travel.

**Where.** apps/nuke-capture-ios/Sources/NukeCapture/VisionDecision.swift:54-67; apps/nuke-capture-ios/Sources/NukeCapture/VisionEngine.swift:345-363; apps/nuke-capture-ios/Sources/NukeCapture/SyncEngine.swift:1128,1150-1164; apps/nuke-capture-ios/Sources/NukeCapture/SupabaseService.swift:564,579; supabase/migrations/20261113140000_image_stage_reconciler_refill.sql:236

**Gap.** The queue requires an http(s) URL, so these rows are never read. That is right for privacy, but a receipt or title photographed with the phone is held by the same rule as a paycheck, and nothing separates vehicle paperwork worth asking the owner to release from personal paper. Mechanism read; the consequence for receipts is inferred.

### 1. Server landing: sync_local_vision_tags (newest definition) (read)

**What exists.** The phone pushes its whole-library tag store in batches of 200: {local_id, labels, is_vehicle, is_personal, owner_verdict}. The newest definition matches the caller's rows by exif_data->>'uuid' with source capture_relay_ios or capture_relay, fills apple_ml_labels only when empty, writes ai_scan_metadata.on_device_vision = {source, labels, is_vehicle, is_personal, owner_verdict, synced_at}, rewrites a row only when something changed, and logs a tag_sync_batch row in analysis_events.

**Writer.** sync_local_vision_tags (phone, authenticated)

**Reader.** none found in the repo

**Where.** apps/nuke-capture-ios/Sources/NukeCapture/LocalTagPush.swift:13,23-49; supabase/migrations/20261017160000_sync_vision_tags_capture_rows.sql:21-127 (source filter 73, labels 78-82, payload 83-91); earlier body supabase/migrations/20261016200000_sync_local_vision_tags_noop.sql:20-123

**Gap.** A repo-wide search finds no reader of ai_scan_metadata.on_device_vision outside tests and merge-preservation code: is_vehicle, is_personal and owner_verdict land and are consulted by nothing (not the gate script, the orchestrator or the reconciler). It is an unindexed jsonb key on the heap. Library imports carry no PHAsset uuid, so the push cannot reach them; the file names a perceptual-hash bridge as a follow-up that does not exist.

### 1. Server landing: check-image-vehicle-match mode record_device_reading (read)

**What exists.** For acknowledged uploads the phone posts groups of one to three image ids (an anchor plus up to two set mates) with expected byte hashes, a run id and, per image, {read_at, is_vehicle, is_document, up to 12 labels, up to 8 vin_candidates, up to 40 on_device observations: ocr_text, vin, classic_serial, plate, classification_label, scene_zone, each with confidence and source}, plus device privacy receipts. Document frames send only labels and zone. The server validates, checks the stored hash and stores one image_observations row per image through ingest_image_observation: observed_by visual_subject_reading_v1, role part, confidence 0, payload at confidence_basis.visual_subject_reading_v1.envelope.raw_model_reading (kind on_device_identity_read_v1). The privacy receipt is stored the same way under observed_by device_privacy_v1.

**Writer.** retainDeviceSourceReading via ingest_image_observation

**Reader.** check-image-vehicle-match subject reader only

**Where.** apps/nuke-capture-ios/Sources/NukeCapture/AttributionEngine.swift:97-117,809-855; apps/nuke-capture-ios/Sources/NukeCapture/OnDeviceAnalysis.swift:404-410; supabase/functions/check-image-vehicle-match/subjectService.ts:195-293,766-775,798-807; supabase/functions/check-image-vehicle-match/index.ts:342-346; apps/nuke-capture-ios/Sources/NukeCapture/SyncEngine.swift:655; apps/nuke-capture-ios/Sources/NukeCapture/NukeCaptureApp.swift:414-415

**Gap.** This is the only place the phone's OCR text, VIN and plate reads and zone guess exist on the server, nested four levels deep in a jsonb column. No migration in the repo creates image_observations, so the repo cannot say whether any index reaches these reads; no SQL in the repo unpacks raw_model_reading.observations (only the function's own TypeScript, subjectService.ts:49-71,132). The queue does not look at it. The automatic foreground run passes an OCR budget of 0; the background drain passes 200.

### 1. Server landing: device triage holds (the phone rule run on a Mac) (read)

**What exists.** scripts/ios-vision-triage compiles VisionEngine.swift for the Mac and posts clutter or personal holds for one vehicle's public frames. hold_frames_by_device_triage moves approved, pending or null frames to vision_gate_status rejected_personal, records the rule, engine, top labels and prior status in vision_gate_agent_reasoning, fills apple_ml_labels when null, and recomputes the vehicle's cover.

**Writer.** hold_frames_by_device_triage (service role)

**Reader.** public read policy, cover picker

**Where.** supabase/migrations/20261016151000_device_triage_holds_and_public_cover.sql:153-226 (update 189-205); scripts/ios-vision-triage/README.md:1-13

**Gap.** Per vehicle and by hand; it only hides. It is the one route by which library imports (never seen by the phone gate) get Apple labels, and only on the frames it holds.

### 1. apple_ml_labels: who reads the free labels (read)

**What exists.** Readers: the orchestrator (skips the paid classifier with policy skip 'apple_ml_non_automotive' when vehicle_score = 0 and labels exist; otherwise only appends the labels to the description); vision-gate-classify layer L2; the deep-read prompt, which receives them as apple_hints; receipt_zone_labels and image_photo_zones, which use them as zone evidence only when no reader has placed the frame; a service-card document guard.

**Where.** supabase/functions/photo-pipeline-orchestrator/index.ts:468-469,532-549,598-600; supabase/functions/image-intake/index.ts:436,481; scripts/vision-gate-classify.mjs:48-50,187-213; scripts/deep-image-analysis-byok.mjs:806; scripts/daily-receipt/byok-vision-prompt.md:9-14; supabase/migrations/20261111210500_receipt_work_reconciliation.sql:84-117; supabase/migrations/20260727000000_service_card_strip_document_guard.sql:134; supabase/migrations/20261003230000_describe_vehicle_images_status_columns.sql:13

**Gap.** The only label-based skip of the paid classifier cannot fire for phone photos: vehicle_score is written only by image-intake and the iOS row never carries it. The gate script runs only per vehicle id (never for unfiled photos) from a launchd job the repo's own comment says was not loaded on 2026-10-03. Label spellings differ by writer (lowercase Vision identifiers such as engine_vehicle from the phone; capitalised words such as Document or Muscle Car in SQL readers), so one list does not match both: inferred from the reader lists. No index on apple_ml_labels appears in the repo: heap only.

### 2. Sets: computed on demand by the filing scorer, stored as arrays (read)

**What exists.** capture_sets_score cuts one user's photos into sets as it runs: a new set starts when the gap to the previous photo exceeds 1,200 s or 300 m; set_key is 'ios:<user>:<UTC start>'. Per photo it reads taken_at, lat/lon, vehicle_id, vehicle_vin, is_document/doc_flag, the block flags, classifier vehicle_fields and the CLIP embedding. Sets are stored only as outputs: capture_landing_sets (chunk_id, set_key, t0, t1, vehicle_id, image_ids uuid[], cells, score, margin, decision clear|review, reason, top3), capture_set_review (set_key, image_ids, reason) and capture_set_links (set_key, image_id, vehicle_id; index csl_set_key).

**Writer.** capture_landing_plan_step, capture_landing_finalize_plan

**Reader.** capture_ledger_frames / capture_ledger_states

**Where.** supabase/migrations/20261111130000_capture_sets_v3_gated_anchors.sql:43-73,254-258; supabase/migrations/20261109000300_capture_landing_pipeline.sql:48-61,121-125; supabase/migrations/20261022213500_capture_set_linking.sql:7-12,48-60; supabase/migrations/20261109000100_vehicle_identifier_observations.sql:212; supabase/migrations/20261111190000_capture_ledger_index.sql:56-60

**Gap.** No column on the photo names its set and there is no image-to-set index: membership is in uuid arrays (found by unnest, as the ledger does) or recomputed from the heap. Set rules differ by place: scorer 20 min / 300 m, insert trigger 20 min, phone 45-minute anchor window and about 100 m cell, and an earlier measured 480 s / 100 m. A set exists only for photos with a taken_at. The scorer runs to file unfiled photos, not to choose which frame to read; nothing picks one frame to stand for a set.

### 2. Session keys stored on the photo row: timeline_event_id and work_session_id (read)

**What exists.** The insert trigger function auto_group_photos_into_events gives every photo with a taken_at a timeline_event_id: an unfiled photo joins the pending event of the same user's nearest unfiled photo within 20 minutes; a filed photo joins its vehicle's event for that date. The event's metadata keeps photo_count, session_start and session_end. work_session_id (vehicle by capture day) is set by derive_work_sessions and the daily-receipt scripts; a repo comment dated 2026-10-06 puts it on under half of owner rows.

**Writer.** auto_group_photos_into_events (trigger); derive_work_sessions

**Reader.** timeline readers; set scorer reads work_sessions

**Where.** supabase/migrations/20261109000400_timeline_session_grouping.sql:10-52; supabase/migrations/20261006230000_describe_vehicle_images.sql:79,279

**Gap.** Both are heap columns, not in the capture-ledger index. timeline_event_id is the only per-photo session key that exists at insert time for unfiled photos, and neither reconcile_image_stages nor claim_image_stage_work reads it. Whether the trigger is live with this body is not checked.

### 2. Bursts and duplicates (read)

**What exists.** Three detectors set is_duplicate: a file-hash trigger at insert; flag_image_burst_duplicates (same vehicle, 16-hex phash, Hamming distance up to 6, within 300 s, keeps the highest hero score); and the orchestrator's cross-sweep moment check (filed, non-external photos with taken_at only), which records a policy skip instead of a paid read. phash and dhash are filled by a Mac script from stored pixels.

**Where.** supabase/migrations/20260622070000_image_burst_dedup.sql:16-57; supabase/functions/photo-pipeline-orchestrator/index.ts:499-530; scripts/backfill-perceptual-hash.py:3-15,46-66; apps/nuke-capture-ios/Sources/NukeCapture/LibraryIngest.swift:253

**Gap.** Both near-duplicate detectors work per vehicle, so a burst of unfiled photos is never collapsed before reading, and the first needs a phash that exists only after a separate backfill. The phone's own dHash is never uploaded. For a fresh unfiled upload the only duplicate signal the queue sees is exact byte equality.

### 2. Day and place (read)

**What exists.** taken_at, latitude and longitude on the row. The ledger groups by local day of coalesce(taken_at, created_at). The scorer rounds lat/lon to three decimals as a cell. get_orphan_sessions returns unfiled photos by day and GPS cell with a suggested vehicle. Tables image_capture_time_claims (corrected capture times) and user_day_vehicle_context (user, day, place_cluster, vehicle, with a basis such as work_session, custody_window, confirmed_photo_pm14d) exist.

**Where.** supabase/migrations/20261111190000_capture_ledger_index.sql:29-32,128-129; supabase/migrations/20261111130000_capture_sets_v3_gated_anchors.sql:72; supabase/migrations/20261018201500_org_chronology_session_confirm_functions.sql:538-561; supabase/migrations/20261021220000_image_evidence_tables.sql:216-239,426-444; supabase/migrations/20261006230000_describe_vehicle_images.sql:79-81

**Gap.** The index carries the capture clock (first key after user_id) but not the place. user_day_vehicle_context and image_capture_time_claims have no writer in the repo. The repo's column comment says older iOS builds stored the library-add date as taken_at until reconciled, so 'earliest by taken_at' is not uniformly a capture time.

### 3. Vision gate: values and who sets them (read)

**What exists.** Enum values: pending, approved, rejected_personal, rejected_misattributed, review_needed; the column default is pending and null means a legacy row. Writers: scripts/vision-gate-classify.mjs (layers L0 caption and file-name text, L1 source rules, L2 Apple labels, L3 is_sensitive / is_document flags, L0.5 sender affinity, optional paid L4), whose header quotes the owner on 2026-05-03: use all signals, cheapest first, pixels last; the orchestrator, which sets approved when it resolves a photo to a vehicle and thereby puts the frame in the deep-read pool; hold_frames_by_device_triage (rejected_personal); owner day confirmations and bulk approvals. The ledger turns the gate into states (private, pulled, on_vehicle, unverified).

**Where.** supabase/migrations/20260503210000_vehicle_images_vision_gate.sql:18-34; supabase/migrations/20261003230000_describe_vehicle_images_status_columns.sql:13; scripts/vision-gate-classify.mjs:5-17,119-330; supabase/functions/photo-pipeline-orchestrator/index.ts:1066-1103; supabase/migrations/20261016151000_device_triage_holds_and_public_cover.sql:189-205; supabase/migrations/20261111190000_capture_ledger_index.sql:130-147

**Gap.** vision_gate_status is in the capture-ledger index, so the queue could read it without the heap; today reconcile and claim use it only to exclude rejected_personal (rejected_misattributed and review_needed stay eligible for a first read). 'approved' means two things (cheap layers found no contradiction, or the orchestrator filed the photo) and is also the deep-read selection key, so one column is privacy filter, filing signal and deep-read queue at once.

### 3. is_sensitive, is_duplicate, is_superseded, is_external (read)

**What exists.** is_sensitive hides an image from everyone but its owner (set_image_sensitivity, detect-sensitive-document, web upload). is_external is true on listing-extractor rows and false on phone rows; the insert trigger and the queue skip external rows. is_superseded is the supersession stamp. is_duplicate is set by the three detectors above. All four sit in the eligibility test that reconcile and claim repeat verbatim.

**Where.** supabase/migrations/20261006230000_describe_vehicle_images.sql:92; apps/nuke-capture-ios/Sources/NukeCapture/SupabaseService.swift:578; supabase/migrations/20261015150000_photo_pipeline_trigger_skips_external_listing_photos.sql:16-19; supabase/migrations/20261113140000_image_stage_reconciler_refill.sql:236; supabase/migrations/20261113130000_image_stage_reconciler_first_pass.sql:115

**Gap.** All four are heap columns. The queue reads them by primary key for the candidates it has already scanned, so they cost nothing extra there, but they cannot pre-filter the candidate walk. Index presence on these columns was not checked live.

### 4. Filing: vehicle_id, suggestions, unfiled pools, candidate table (read)

**What exists.** vehicle_id is on the row and in the capture-ledger index. The unfiled pool has its own partial index, idx_vehicle_images_unorganized (user_id, created_at DESC) WHERE vehicle_id IS NULL. A placeholder vehicle id is treated as unfiled by the scorer. suggested_vehicle_id and auto_suggested_vehicle_id (with confidence and reasons) are written by the orchestrator's prior, the phone's album leads and scripts. album_sync_map (album to vehicle) lets the phone file by 'album_map' at 0.9 through device_file_images. claim_image_stage_work returns vehicle_id to the reader.

**Where.** supabase/migrations/20261111190000_capture_ledger_index.sql:29-32; supabase/migrations/20251123200000_personal_photo_library.sql:33; supabase/migrations/20261014040300_my_unorganized_photo_count.sql:10; supabase/migrations/20261111130000_capture_sets_v3_gated_anchors.sql:45; supabase/migrations/20261006230000_describe_vehicle_images.sql:189,203-207; apps/nuke-capture-ios/Sources/NukeCapture/AttributionEngine.swift:455-473,638-652,739; supabase/migrations/20261113130000_image_stage_reconciler_first_pass.sql:95,134; supabase/functions/photo-pipeline-orchestrator/index.ts:943-957,1022-1027,1153-1156; supabase/migrations/20261021220000_image_evidence_tables.sql:50-52,76-88,154-195

**Gap.** Filed or not changes what a first read buys: every dear route after the classifier (deep read, progress shot) is skipped when the photo has no vehicle, yet the queue hands out filed and unfiled photos alike in upload order. image_vehicle_candidates (verdict, pass, confidence, frame_role, image_class; indexed by image and by vehicle and day; pass list ordered 'cheapest first') exists as a table, but its writer propose_image_candidates is defined nowhere in the repo.

### 5. What the owner has in hand, with no form filled (read)

**What exists.** work_orders.status (draft, pending, quoted, approved, scheduled, in_progress, completed, paid, cancelled) with vehicle_id; work_order_evidence_window gives a job's from/until clock and job_evidence_candidates_read lists the caller's own photos of that vehicle inside it; work_order_evidence_images records photos a party attached by a Sign. work_sessions (vehicle by day, owner_confirmed_at), already cited by the set scorer. user_interactions (view, save, follow) written by record_interaction, which the phone calls from the vehicle screen. image_coverage_by_vehicle (inflow_7d, seen_7d, gated_t0, seen_t1), by which the deep-read loop ranks vehicles with unread last-7-day photos first. capture_rescan_requests.from_date (the owner's explicit re-scan ask). evidence_judgment_requests (priority, vehicle_id, status): open receipt questions per vehicle, priority set from the line's price. The scorer's 'recent' leg (last confirmed filing under 48 h). work_order_quotes exists by name in two migrations (not opened).

**Where.** supabase/migrations/20251212000010_work_orders_schema_backfill.sql:37,48; supabase/migrations/20261019220000_job_evidence_attach.sql:24-45,198-234; supabase/migrations/20261111130000_capture_sets_v3_gated_anchors.sql:148-168; supabase/migrations/20260616190000_engagement_primitive_pilot.sql:19-39; apps/nuke-capture-ios/Sources/NukeCapture/VehicleDetailView.swift:1053,1703,1724; scripts/daily-receipt/byok-fleet-next.mjs:11-17,41-53; supabase/migrations/20260617000000_image_analysis_coverage_rpc.sql:167; supabase/migrations/20261111170000_capture_ledger.sql:98-108,119-143; supabase/migrations/20261111210500_receipt_work_reconciliation.sql:337-376; scripts/receipt-work/reconcile-receipt-work.mjs:68; supabase/migrations/20261019094500_work_order_quotes.sql

**Gap.** None of these is read by reconcile_image_stages or claim_image_stage_work, and image_stage_work has no vehicle_id or priority to hold the result. All are small tables keyed by vehicle or user, so they are cheap to read, but being keyed by vehicle they can speak only for filed photos or for a set that already has a suggested vehicle.

### 6. Document-likeness and the receipt path (read)

**What exists.** Free signals: the phone's clutter rule and isIdentityDocument (labels, or OCR markers such as invoice, receipt, estimate, work order, bill to, amount due, or three line-item words); is_document sent in record_device_reading; image_text_reads.is_document from the Mac OCR pass; document terms in apple_ml_labels. Paid first-pass signals: classifier image_type receipt_document, v2.is_document, document_category (11 values), document_kind, document_type; copied to vehicle_images.is_document and document_category only at confidence 0.85 or more. Route: the orchestrator sends receipt_document frames to receipt-photo-ocr; the subscription document reader's worklist is frames with classification.v2.document_type set or a route_result starting receipt-photo-ocr, minus pages already in capture_document_pages, newest taken_at first.

**Where.** apps/nuke-capture-ios/Sources/NukeCapture/VisionEngine.swift:63-80; apps/nuke-capture-ios/Sources/NukeCapture/AttributionEngine.swift:100-101; supabase/migrations/20261022213500_capture_set_linking.sql:25-41; supabase/functions/photo-pipeline-orchestrator/index.ts:109-134,997-1000; supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:263-280; supabase/functions/photo-pipeline-orchestrator/classifier.ts:156; scripts/photo-pipeline/subscription-document-reader.mjs:67-81; supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql:69,85,284-285

**Gap.** The stage registry's document test cannot match: image_stage_gaps tests classification.image_type in ('receipt','document','invoice','text_document'), but the classifier's only document type is 'receipt_document', validated against a closed list. The receipt_ocr stage is registered as not required, so this is dormant; made required as written, it would queue nothing. Document-likeness known for free (labels, the device's is_document) never routes a photo straight to the document read: it must first pay for the general classifier.

### 7. image_stage_work: lanes and order (read)

**What exists.** Columns: image_id, stage, target_version, reason (missing, outdated, retryable_outcome), lane (live, backfill), status, not_before, lease_until, created_at, finished_at; one open item per image and stage. Reconciler: the live lane is owner photos uploaded within live_days (2) and older than min_age_minutes (15), newest upload first, on every tick; the backfill lane walks everything by a (created_at, id) cursor, oldest upload first, and is skipped while refill_below (100) items are claimable; backfill_share 0.5, max_open 300, scan_per_lane 200, scoped to user_ids. Claim: live and backfill interleaved one for one, each lane in the work item's created_at order, eligibility and the gap re-checked, at most 25 per call, optional p_user_id.

**Where.** supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql:120-138,161-165; supabase/migrations/20261113140000_image_stage_reconciler_refill.sql:182-198,205-209,214-231,241-258,299-301; supabase/migrations/20261113130000_image_stage_reconciler_first_pass.sql:108-121,141-145

**Gap.** The only ordering inputs are upload time (vehicle_images.created_at) and the two-day live window. 'Oldest first' means oldest uploaded, not earliest taken: old photos imported today count as live, and a 2017 photo uploaded last month waits behind everything uploaded before it. A work item has no priority, vehicle, set, document flag or label; the only per-item lever is not_before (a later time defers an item). The candidate walk orders by created_at using an index keyed on (user_id, coalesce(taken_at, created_at), uuid) where created_at is only an included column, so it reads the user's whole slice of the index each time; fine for one user, and it grows with the library (inferred).

### 7. What the queue could read cheaply, by where each signal lives (inferred)

**What exists.** From the index alone, no heap: user_id, capture clock coalesce(taken_at, created_at), exif uuid (present means a capture-app row), id, taken_at (present or not), created_at, vehicle_id (filed or not), vision_gate_status. Already fetched from the heap for each scanned candidate (at most scan_per_lane per lane per tick): is_duplicate, image_url, is_sensitive, is_external, is_superseded, ai_processing_status, ai_processing_started_at, and inside image_stage_gaps ai_scan_metadata and exif_data.

**Where.** supabase/migrations/20261111190000_capture_ledger_index.sql:29-32; supabase/migrations/20261113140000_image_stage_reconciler_refill.sql:233-237; supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql:272-295; supabase/migrations/20261022213500_capture_set_linking.sql:42; supabase/migrations/20261109000100_vehicle_identifier_observations.sql:31-33; supabase/migrations/20261111110000_vision_pool_library_sources.sql:22

**Gap.** Since those candidate rows are already read by primary key, any other vehicle_images column (apple_ml_labels, is_document, latitude, longitude, timeline_event_id, work_session_id, source, file_hash, suggested vehicle) costs no extra row fetch for them, but only to order or defer within the scanned window. Ordering the whole backlog by a signal not in the index needs that user's rows in the 57 GB heap or a small side table keyed by image. Cheap by image id in the repo's definitions: image_text_reads (itr_image), vehicle_identifier_observations (vio_image), capture_set_links, image_stage_receipts, and image_observations (idx_image_obs_image is named in a comment, not defined in the repo). Small per-vehicle tables: image_coverage_by_vehicle, work_orders, work_sessions.

### 7. Other queues and their orderings (read)

**What exists.** Paid orchestrator drain (claim_photo_pipeline_batch): owner pending rows, newest upload first, optional recent_days cut, circuit breaker. Subscription frame reader fallback and document reader: newest taken_at first. Deep read: vehicles ranked by unread last-7-day inflow, then within a vehicle the earliest unread day first, whole days, up to LIMIT frames a pass. Capture landing (filing): 'forward' track oldest unresolved first in 30-day chunks gated by a viewed sample, 'recent' track last 7 days. CLIP carrier backfill and OCR batch: newest taken_at first, last two years. Phone sync: last three days newest first, then the watermark window oldest first, 200 per pass, 40 per foreground pass. analysis_queue.priority 1 to 10. evidence_judgment_requests ordered by priority descending.

**Where.** supabase/migrations/20261109000500_photo_pipeline_backoff.sql:78-106; scripts/photo-pipeline/subscription-frame-classifier.mjs:88; scripts/photo-pipeline/subscription-document-reader.mjs:73-74; scripts/daily-receipt/byok-fleet-next.mjs:11-13,47-52; scripts/deep-image-analysis-byok.mjs:727-745; supabase/migrations/20261109000300_capture_landing_pipeline.sql:3-10,18-21; supabase/migrations/20261111110000_vision_pool_library_sources.sql:58-67,84-95; apps/nuke-capture-ios/Sources/NukeCapture/SyncEngine.swift:467-493,536-542; supabase/migrations/20250130_create_analysis_queue.sql:9,114; supabase/migrations/20261111210500_receipt_work_reconciliation.sql:347,602

**Gap.** Seven orderings in four directions (newest upload, oldest upload, newest taken, earliest taken day) with no shared priority. The dearest read, the deep read, is the one that already runs earliest-day-first and reads every frame of the day.

### 8. Zero-cost and local models in the repo (read)

**What exists.** Apple Vision on the phone, and the same engine compiled for the Mac. CLIP ViT-B/32 run locally on Apple MPS, writing image_observations.embedding_clip_vitb32; carrier rows are made at insert for phone uploads (trigger) and by a 10-minute backfill for library sources, and a launchd job embeds every 30 minutes; the set scorer's visual leg compares up to 12 sampled photos per set with a vehicle's confirmed anchors. RapidOCR on the Mac writing image_text_reads (lines with confidence, vin_candidates, is_document), which feeds vehicle_identifier_observations and the scorer's vin, plate and badge legs. A perceptual-hash backfill script. derive-image-exif, registered as the 'exif' stage, not required. YONO: the edge proxy answers available:false without its sidecar (default 127.0.0.1:8472) and the orchestrator no longer calls it; its older outputs (vehicle_zone, condition_score, damage_flags, fabrication_stage) remain on roughly a third of owner rows per the 2026-10-06 repo comment. Ollama scripts wrote area, part and operation on early-2026 rows.

**Where.** scripts/clip-embed-image-observations.py:2-19,41-45; scripts/com.nuke.clip-embed.plist:8-27; supabase/migrations/20261111110000_vision_pool_library_sources.sql:6-22,37-48,51-82,84-99; supabase/migrations/20261111130000_capture_sets_v3_gated_anchors.sql:50-51,101-119; supabase/migrations/20261022213500_capture_set_linking.sql:25-41; supabase/migrations/20261109000100_vehicle_identifier_observations.sql:9-33; scripts/backfill-perceptual-hash.py:3-15; supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql:83; supabase/functions/yono-classify/index.ts:35,83,133; supabase/functions/photo-pipeline-orchestrator/index.ts:1050-1053; supabase/migrations/20261006230000_describe_vehicle_images.sql:121-127,241-243,259,320

**Gap.** The three live local readers (CLIP, RapidOCR, Mac Apple Vision) run on one Mac from launchd or by hand, outside the stage ledger: no receipt says which photo has an embedding or an OCR read, so the queue cannot tell that the free passes are done. Embeddings are used only to name a vehicle for a set; nothing uses them to group near-identical frames, pick a representative, or find frames like a known flaw. Of my earlier scratch notes on YONO, two points were re-checked and hold (proxy returns available:false; orchestrator dropped it); the rest was not re-verified. Whether the launchd jobs are loaded cannot be read from the repo.

### 9. What the first paid pass knows, and how it routes the dearer reads (read)

**What exists.** Classifier v98 returns image_type (vehicle_exterior, vehicle_interior, engine_bay, undercarriage, detail_closeup, vin_plate, part_closeup, receipt_document, progress_shot, other), confidence, is_automotive, description, image_medium, vehicle_hints, vin_detected, and v2: is_document, document_category, document_kind, document_type, angle (nine values with confidence), vin (value, confidence, checksum, evidence role), text_lines, vehicle_fields (17 names), document fields. Stored in ai_scan_metadata.classification (heap jsonb); copied to columns is_document, document_category, vehicle_vin, ai_detected_angle; capture_upload_status.image_type and confidence. Routes: exterior, interior, detail, undercarriage, other and vin_plate go to the deep-read pool only when the photo is filed (gate set to approved); engine_bay also calls analyze-engine-bay; part_closeup calls part-number-ocr; receipt_document calls receipt-photo-ocr; progress_shot goes to the deep pool when filed.

**Where.** supabase/functions/photo-pipeline-orchestrator/classifierTypes.ts:31-85; supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:263-281; supabase/functions/photo-pipeline-orchestrator/index.ts:109-134,926-1044,1066-1103; supabase/migrations/20261107130125_v101_supporting_schema_capture.sql:60-80; supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql:81-86

**Gap.** The step from first pass to dear read is all-or-nothing per filed photo: every filed frame except receipts and loose parts enters the same deep-read pool; image_type, angle, confidence and 'one of forty near-identical frames' do not narrow it. The deep read is not a row in image_pipeline_stages (only classifier, exif, engine_bay, receipt_ocr), so its queue is still 'gate approved and no byok_deep_analysis key', and applies_when is a closed two-value list (always, document_like). supabase/functions has no analyze-engine-bay or part-number-ocr folder, so two specialised routes point at functions the repo does not contain (deployed state not checked).

### Prejudice: the repo's own measured warning about free priors (read)

**What exists.** In November 2026 the landing pipeline was found filing sets on day-pattern priors alone (filed siblings in the segment, place cell, recent filing, work session, previous day) with nothing read from the photos. The migration records that sets cleared without an evidence leg were wrong in about half of the viewed frames, against about a quarter with one. The rule added: a set clears only when visual, vin, plate, badge or model evidence is above zero; otherwise it is held for review with reason priors_only.

**Where.** supabase/migrations/20261111200000_capture_landing_priors_only.sql:1-18,52-60

**Gap.** This is the measured boundary in this codebase: time, place, session and recent-activity signals were good enough to order and to hold, not to decide. Nothing comparable has been measured for ordering paid reads: a stage receipt's detail keeps reader, prompt_version, image_type and orchestrator_http only, so what a read yielded per free-signal bucket is not recorded anywhere (scripts/photo-pipeline/stage-queue.mjs:63-64,92).

### The existing bounded paid look: receipt-to-work reconciliation (read)

**What exists.** receipt_work_lines(vehicle) pairs each linked receipt line with the vehicle's gate-approved, non-sensitive, non-duplicate, non-document photos by EXIF day and zone. The line's zone comes from keywords in its printed description (dashboard, interior, engine, wheel, undercarriage, exterior); a photo's zone comes from classifier angle, vehicle_zone or deep scene_type, and from Apple labels only when no reader has placed the frame. Conclusions include install_window_photographed, photographed_after_window, no_zone_photo_after_purchase and part_zone_unknown, with up to eight cited frames. For lines with candidate frames the producer raises an evidence_judgment_requests row (question_kind receipt_part_visible, priority from the line's price, params holding the candidate image ids); an answer must give visible and installed as yes, no or cannot_tell, a confidence, an image_id from the candidates, and optionally a bbox and quote. get_vehicle_receipt_work_context reads it per vehicle.

**Where.** supabase/migrations/20261111210500_receipt_work_reconciliation.sql:51-73,84-117,143-151,154-165,203-246,337-376,588-613,617-648; supabase/migrations/20261113090000_receipt_work_context_reader.sql:1-21,26; scripts/receipt-work/reconcile-receipt-work.mjs:68,171

**Gap.** This is the one place in the repo where a paid look is asked for a named reason on a small set of frames chosen by free signals. It sits apart from the stage queue, has one question kind, and a repo search finds no reader that calls claim_evidence_judgments (only the migration, tests and docs). It depends on photos already having a zone, that is, on an earlier read or on Apple labels.

### The change-claim store has tables and no writers (read)

**What exists.** Tables: image_vehicle_candidates, image_capture_time_claims, evidence_links, vehicle_change_claims (kinds include part_installed, part_removed, paint, body, interior, repair, work_performed; occurred_from and occurred_to; indexed by vehicle, kind and date), vehicle_change_claim_support (evidence_kind vehicle_image, image_candidate, work_session and others; stance supports or contradicts; about date, condition and others; indexed by claim and by evidence), user_day_vehicle_context, evidence_decisions.

**Where.** supabase/migrations/20261021220000_image_evidence_tables.sql:8-12,76-88,154-195,216-239,356-421,426-444; supabase/sql/test_image_evidence_tables.sql:268; AGENTS.md (section 'Writes and deploys', Row writes)

**Gap.** The writers named in the guard list (propose_change_claim, propose_claim_support, propose_image_candidates, record_day_context and the rest) are defined nowhere in the repo: migration 20261021221000, which AGENTS.md names, is absent, and the only body is a test stub. By the migration's own words the store is inert until they exist. The one schema shaped like 'this change happened to this vehicle, supported by these photos' cannot be written from the repo.

## To read from production

- pg_indexes for public.vehicle_images: which of idx_vehicle_images_capture_ledger, idx_vehicle_images_unorganized, idx_vehicle_images_pending_user, idx_vehicle_images_timeline_event, idx_vehicle_images_user_capture_stats exist and are valid, and whether any index covers apple_ml_labels, is_document, timeline_event_id or work_session_id
- vehicle_images where user_id is not null, by source: count with apple_ml_labels non-empty; count with ai_scan_metadata ? 'on_device_vision'; count with image_url = '' (metadata-only); count with taken_at null; count with vehicle_id null; count with timeline_event_id not null; count with work_session_id not null; count with phash not null; count with is_document true; count with vehicle_score not null
- vehicle_images where user_id is not null: counts by vision_gate_status (including null), and by ai_scan_metadata #>> '{classification,image_type}' and #>> '{classification,v2,angle,value}'
- vehicle_images.apple_ml_labels for owner rows: distinct label spellings by source (lowercase Vision identifiers versus capitalised words), to settle whether one label list matches both writers
- image_observations: table definition and indexes (not in the repo); counts by observed_by for 'visual_subject_reading_v1' rows whose confidence_basis #>> '{visual_subject_reading_v1,envelope,raw_model_reading,kind}' = 'on_device_identity_read_v1', for 'device_privacy_v1' and for 'clip_embed_carrier_v1'; share of owner images with embedding_clip_vitb32 not null
- image_text_reads: count of unrevoked rows per user and how many owner images have none; vehicle_identifier_observations: counts by kind and status
- capture_skips: counts by reason per user
- platform_config where config_key = 'image_stage_reconciler' (enabled, user_ids, refill_below, scan_per_lane); image_stage_work counts by lane, status and reason; image_stage_receipts counts by stage and outcome; image_stage_reconciler_state rows; image_pipeline_stages rows (required, contract, applies_when)
- to_regprocedure for public.propose_change_claim, propose_claim_support, propose_image_candidates, record_day_context; row counts of vehicle_change_claims, vehicle_change_claim_support, image_vehicle_candidates, user_day_vehicle_context, image_capture_time_claims
- evidence_judgment_requests: counts by question_kind and status; garage_derivation_evidence where kind = 'receipt_work_correlation' and superseded_at is null: counts by conclusion (especially part_zone_unknown)
- image_coverage_by_vehicle: number of vehicles with inflow_7d > seen_7d and with gated_t0 > seen_t1
- work_orders: counts by status with vehicle_id not null for the owner's account; work_sessions: rows in the last 14 days; user_interactions: rows with interaction_type = 'view' and target_type = 'vehicle' in the last 7 days
- capture_landing_sets: counts by decision and reason; capture_set_review: open rows; capture_landing_config (enabled, halted, forward_cursor)
- cron.job: whether image-stage-reconciler, clip-carrier-backfill, capture-review-sweep and the capture-sets drain are scheduled and active; pg_trigger on vehicle_images for the photo-pipeline insert trigger, the CLIP carrier trigger and trg_auto_group_photos
- Deployed function list: whether analyze-engine-bay and part-number-ocr answer (404 or 401), since the orchestrator routes to both and neither has a folder in the repo

## Open questions

- Does 'earliest' mean earliest taken or earliest uploaded? The stage queue orders by upload time (vehicle_images.created_at); the deep read orders by capture day within a vehicle; the repo comment says taken_at was a library-add date on older phone builds until reconciled.
- Should a document frame the phone holds (metadata only, pixels on the phone) ever be asked for, and on what signal? Today a shop receipt and a personal paper are held by the same rule and neither can be read.
- Which set rule is the set: the scorer's 20 min / 300 m, the insert trigger's 20 minutes, the phone's 45-minute anchor window and 100 m cell, or the earlier measured 480 s / 100 m?
- Are the Mac launchd jobs (vision-gate approver, CLIP embedder, subscription reader, RapidOCR pass) loaded and running? Neither the repo nor the database can say; the repo's own comment says the gate approver was not loaded on 2026-10-03.
- Is migration 20261021221000 (the evidence-store writers) on another branch or applied by hand? AGENTS.md names it; the repo does not contain it.
- Who answers evidence_judgment_requests? The producer raises questions; no reader in the repo claims them.
- What has a paid read actually yielded per free-signal bucket (filed or unfiled, label says vehicle or not, first frame of a set or the fortieth)? No record of it exists, so any ordering rule would start unmeasured.
- Is the vehicle_score fast path meant to apply to phone photos? As written it cannot, because only image-intake writes vehicle_score.
- image_observations has no definition in the repo: is there an index that can find device VIN or plate reads, or embeddings, by image without scanning?
