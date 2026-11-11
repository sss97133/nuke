# Image reading map, 2026-11-10: what a photo reading emits and where each field lands

Made by a read-only agent over the repository on 2026-11-10 for the owner direction recorded in
`docs/ledger/theory/data-machine.md` ("Image analysis is the model asking"). Repo only: nothing here was checked
against production, and a later definition may have replaced a cited one. An audit output, not active guidance:
verify a finding before acting on it (`docs/ledger/README.md`).

## Summary

Repo only; not checked live. The reading contract is hand-written beside the data model, not derived from it: there are six separate photo-reading contracts (legacy classifier prompt, v98 classifier prompt, deep-read verdict, phone on-device kinds, Codex contract v1, cockpit attribute checklist) and each carries its own typed-in vocabulary. The one piece that claims to be derived (the v98 "schema manifest") is a static constant dated 2026-11-02; the SQL file and the RPC it names (prompt-v2/manifest.sql, classifier_schema_manifest) are not in the repo, and its image_type list is deliberately never refreshed. The model-side registries that do exist (observation_properties, schema_proposals, angle_taxonomy/angle_aliases, component_definitions, condition_taxonomy, the cockpit attribute-registry.ts) are read at intake for validation at most; no code builds a prompt or an output schema from any of them. Most of what a reading emits lands as a jsonb blob on vehicle_images.ai_scan_metadata plus a copy in vehicle_observations.structured_data; the normalized rows are narrow (description, VIN/plate/vehicle-column fields, text lines, coarse angle, three per-image enums for rust/paint stage/assembly). Components land as free-text labels (component_identifications) only when a manual CLI mode is run, and nothing links two rows that name the same physical part. Localized damage (label + box) is emitted by the deep read and has no row, no fold and no reader. No reader emits a panel or side key, a component state such as "new", or a cross-photo "same part" link, so the three owner questions can only be approximated by string matching inside jsonb, per vehicle. The tables that could hold a change ("part_installed", "paint", "repair" in vehicle_change_claims, with photo support rows) exist in a migration but have no writer function and no caller in this checkout. The landing fold is first-write-wins per image and prompt version, so a corrected reading replaces the jsonb cache but not the normalized rows.

## The three questions

### Q1. Mustangs whose window felts were replaced during a restoration, with photographic proof.

**Path today.** Not askable as a keyed query. Pieces that exist: make and model on vehicles; a free-text component label inside vehicle_images.ai_scan_metadata.byok_deep_analysis.components_seen (and, only where the manual entities command was run, component_identifications.identification with status confirmed when a part number seen or guessed matches a receipt line); receipt_items.description as free text for the purchase; build_phase_guess per image in the blob for 'during restoration'. 'Replaced' is recorded nowhere: the deep-read prompt forbids inferring installation from a purchase, repair orders typed repair_order do not become receipt_items, and vehicle_change_claims (kind part_installed) has no writer in this checkout. The best available answer is a per-vehicle substring match that returns 'a felt was seen in a photo and a matching part number was bought', not 'replaced'.

```sql
-- runs on existing tables; string match only; returns 'seen + bought', not 'replaced'
select v.id, ci.image_id, ci.identification, ci.status, ci.citation_text
from vehicles v
join component_identifications ci on ci.vehicle_id = v.id
join image_analysis_records r on r.id = ci.analysis_record_id and r.superseded_by is null
where v.make ilike 'ford' and v.model ilike 'mustang%'
  and ci.identification ilike '%felt%' and ci.status = 'confirmed';
```

**Smallest missing piece.** One shared key for the part, used by the photo reading, the receipt line and the change claim. Existing things it would extend: component_identifications.component_definition_id (present, unfilled), the components_seen element in the deep-read contract (label only today), and the vehicle_change_claims / vehicle_change_claim_support tables, which need their writer and a place for that key. Also the document lane's repair_order to work_order mismatch, so labour lines land.

### Q2. A Porsche that has a specific imperfection on it.

**Path today.** Not askable as a keyed query. A defect with a label and a box exists only as an element of byok_deep_analysis.damage_localized (free-text label, image-space box, free-text severity) and as damage_callouts strings, in jsonb on vehicle_images and in the condition observation's structured_data; no fold, reader function or index reaches damage_localized. The older lane has vehicle_images.damage_flags and surface_observations condition rows, which are whole-image flags placed at the image's zone. The cockpit attribute vehicle.condition_cues has the right words (paint_chip, dent, panel) but stores one jsonb value per submission in projection_event and is not used by the pipeline readers. No reader emits which panel or side.

```sql
-- bounded to a vehicle list; unindexed jsonb, not a fleet query
select vi.vehicle_id, vi.id as image_id, d->>'label' as label, d->'bbox' as bbox, d->>'severity' as severity
from vehicle_images vi
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(vi.ai_scan_metadata->'byok_deep_analysis'->'damage_localized') = 'array'
       then vi.ai_scan_metadata->'byok_deep_analysis'->'damage_localized' else '[]'::jsonb end) d
where vi.vehicle_id = any($1::uuid[])   -- the Porsches, chosen first from vehicles
  and d->>'label' ilike '%chip%';
```

**Smallest missing piece.** A row per damage element with a keyed kind and a keyed place on the car. Existing things it would extend: the per-image property projection (observation_properties key plus image-property-projection.mjs, which today handles three enums), or surface_observations (already has label, bbox, severity, region_detail, descriptor_id to condition_taxonomy). The deep-read contract needs a panel or zone field; none exists.

### Q3. That specific imperfection was repaired, and it is now this restored Porsche.

**Path today.** Not askable. No reading carries an identity for a defect or a panel that a later reading could repeat, and no reading names an earlier image; the deep read sends cross-frame links to agent_notes prose. What exists is per vehicle and per image: paint stage per image (image_visible_paint_stage rows if the manual projection ran; their observed_at is ingest time, not capture time), build phase per image in the blob, and the cockpit's work_transition and refinish_event values in projection_event. vehicle_change_claims with kind repair or paint and two photo support rows is the existing table shape for 'before, after, repaired', with no writer in this checkout and no component or panel key.

```sql
-- what the existing tables could return once a writer exists; no rows expected from this checkout's writers
select c.vehicle_id, c.kind, c.occurred_from, c.occurred_to, c.summary,
       array_agg(s.evidence_id) filter (where s.evidence_kind = 'vehicle_image' and s.stance = 'supports') as photo_ids
from vehicle_change_claims c
join vehicle_change_claim_support s on s.claim_id = c.id and s.superseded_by is null
where c.superseded_by is null and c.kind in ('repair','paint','body')
  and c.vehicle_id = any($1::uuid[])
group by 1,2,3,4,5;
```

**Smallest missing piece.** First, the same keyed defect/place identity Q2 needs, so a 'before' row and an 'after' row can refer to one thing. Second, the writer for vehicle_change_claims and vehicle_change_claim_support (tables exist at 20261021220000:362-421), with the claim pointing at that identity. Vehicle identity across photos already has an owner (image_observations subjects, attribute_testimony); part identity has none.

## Findings

### Central question: derived or hand-written (read)

**What exists.** Hand-written. Six contracts, each with its own typed vocabulary: (1) legacy classifier PROMPT; (2) v98 prompt built by renderPromptV2 from SCHEMA_MANIFEST, a TypeScript constant; (3) deep-read verdict (markdown prompt + 4 more hand copies of the same enums); (4) phone OnDeviceObservation.Kind + zoneByLabel; (5) Codex contract v1 enums in Python; (6) cockpit attribute-registry.ts, where each attribute carries its own prompt text. The only code that reads a database object while building a prompt is loadManifest(), which calls an optional RPC classifier_schema_manifest and falls back to the static copy on any error; it may replace only document_category, receipt_doc_kind, angles and field_names, never image_types. That RPC has no definition in any migration and the file the comment cites (prompt-v2/manifest.sql) is not in the repo. The cockpit registry states the opposite rule in a comment: registry code is the source of truth, not a DB table.

**Writer.** renderPromptV2 (classifierProvider.ts)

**Reader.** OpenAI path, Mac subscription reader via action classifier_prompt

**Where.** supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:247-251, 263-303, 312-334, 338-388; supabase/functions/_shared/cockpit/attribute-registry.ts:1061-1063; supabase/functions/ingest-observation/index.ts:985 (registry read for validation only)

**Gap.** No builder exists that turns a model registry (observation_properties, component_definitions, condition_taxonomy, angle_taxonomy) into a prompt or an output schema. The smallest existing thing to extend is loadManifest()/renderPromptV2: it already has the shape 'lists in, prompt out' and an RPC hook, but the RPC is undefined and the manifest has no component, condition, panel or change vocabulary.

### Classifier, legacy prompt (Gemini path and v98 safety-net retry) (read)

**What exists.** Fields asked: image_type (fixed list of 10), image_medium (fixed list of 4), medium_context (free text), confidence, is_automotive, description (free text, under 1000 chars), detected_text (free strings, max 32), vin_detected (17 chars or null), vehicle_hints {make, model, year_range, color} (free text). No component, damage, condition, panel or angle field. Used by classifyImage (Gemini) and as the retry when a v98 answer is unusable.

**Writer.** photo-pipeline-orchestrator

**Reader.** routeByType, resolveVehicle, photo_land_classification

**Where.** supabase/functions/photo-pipeline-orchestrator/classifier.ts:60-80 (prompt), 154-166 (validator); supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:197-202 (retry with legacy prompt)

**Gap.** A photo answered by this prompt has no v2 block, so the landing fold writes only the description and the core.* rows for it; text lines, fields and angle are absent.

### Classifier, v98 prompt: exact JSON shape and vocabularies (read)

**What exists.** Prompt version string is v98 everywhere; v99 to v101 are orchestrator handler versions, not prompt versions. Fields: image_type (10, static list with one-line guides); image_medium (4); medium_context (free); confidence; is_automotive; description (free, max 400 chars asked); angle {value from 9 fixed strings, confidence}; is_document; document_category (11 fixed); document_kind (13 fixed, mirrors pg enum receipt_doc_kind); document_type (19 fixed, copied from document-ocr-worker DOC_PROMPTS plus three); vin {value, confidence, evidence free text, evidence_role from 8 fixed}; vehicle_fields [{field_name from 17 fixed names that mirror vehicles columns, value free, confidence, evidence free}] max 12; text_lines [{text, confidence, region [x0,y0,x1,y1] 0..1}] max 40; document {fields free object keyed by per-type field lists, field_confidence}. The sanitizer drops text lines under 0.5 confidence, drops vehicle_fields whose name is not in the manifest, keeps document.fields as an unvalidated object up to 12000 chars.

**Writer.** OpenAI path classifyWithOpenAI; reader path classificationFromReader

**Reader.** persistV98Columns, landCitedEvidence, photo_land_classification, receipt-photo-ocr (document_type hint only)

**Where.** supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:263-303 (manifest), 338-388 (prompt; field block 344-358; limits 387), 408-473 (sanitizer); supabase/functions/photo-pipeline-orchestrator/classifierTypes.ts:73-85; supabase/functions/photo-pipeline-orchestrator/index.ts:303-308

**Gap.** The prompt forbids interpreting what it sees into vehicle facts (citation rules 1-6) and has no slot for a component, a part state, a defect, a panel or a side. Anything of that kind can only go into description (free text) or be omitted.

### Where the classifier's fields land inside the orchestrator (read)

**What exists.** (a) Whole result, v2 included, into the jsonb blob vehicle_images.ai_scan_metadata.classification. (b) Columns on vehicle_images, fill-if-empty only: image_medium; is_document and document_category (document at confidence 0.85 or more); vehicle_vin and vehicle_vin_confidence (capped 0.79); ai_detected_angle and its confidence (0.6 or more). (c) field_evidence rows, status pending, source_type ai_visual, for v98 vehicle_fields that pass the SQL gate photo_field_not_about_vehicle, with quote and photo id in raw_extraction_data. (d) vehicle_identifiers through land_identifier_claims for an admitted VIN. (e) A second, different table vehicle_field_evidence for the route's extracted_fields (legacy hints make/model/exterior_color/vin, engine_family/engine_displacement/fuel_system, parts). (f) One vehicle_observations row through ingest-observation (kind media, work_record or specification by image_type) with content_text = description and structured_data {image_id, image_type, confidence, detected_text, route_handler, extracted_fields}; the v2 extras are not in that row.

**Writer.** photo-pipeline-orchestrator

**Reader.** cited-evidence-accept cron (named in the comment at index.ts:140-141; not opened), frontend ImageZoneSection.tsx:26-37, VehicleFindingsCard.tsx:30, iOS WorkDaySignView.swift:104

**Where.** supabase/functions/photo-pipeline-orchestrator/index.ts:663-697 (blob), 109-136 (columns), 144-176 (field_evidence), 177-198 (identifiers), 947-951 and 1173-1176 and 1336-1383 (vehicle_field_evidence), 1254-1330 (observation; kind map 1268-1274; structured_data 1305-1312); supabase/functions/photo-pipeline-orchestrator/persistence.ts:64-74; supabase/functions/photo-pipeline-orchestrator/fieldSourceAdmission.ts:13-30

**Gap.** Photo-derived vehicle fields go to two tables with different column shapes and different field names (color in the manifest, exterior_color in the legacy route). The classifier's own document.fields is stored only in the blob: the fold lands doc.type and doc.kind only, and receipt-photo-ocr reads only document_type as a hint and reads the page again. No reader of classification.v2.document was found outside the orchestrator folder.

### Mac reader (subscription-frame-classifier.mjs) (read)

**What exists.** It does not hold a prompt of its own. It asks the orchestrator for the checklist (action classifier_prompt, which returns renderPromptV2(manifest) and prompt_version v98) and sends exactly: the checklist text, a blank line, then 'The image is the file at <path>. Read it first, then answer with ONLY the JSON object.' to `claude -p --allowedTools Read`. It posts the parsed JSON back as classification_raw with a reader name; the orchestrator validates it with the same code as a provider answer and runs the same routing, filing and landing. A separate bounded mode (processing_mode classification_only) refuses any vehicle_fields, VIN or document payload, writes a vehicle-less vehicle_observations row of kind media holding the before-image, and replaces ai_scan_metadata.classification.

**Writer.** subscription-frame-classifier.mjs via photo-pipeline-orchestrator

**Reader.** same as the classifier

**Where.** scripts/photo-pipeline/subscription-frame-classifier.mjs:72-73, 138, 148; supabase/functions/photo-pipeline-orchestrator/index.ts:303-308, 554-559, 240-266; supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:510-520; supabase/functions/photo-pipeline-orchestrator/suppliedClassification.ts:26-81 (refusals 38-39, 42; observation 59-68; cache 71-75)

**Gap.** Same contract as v98, so the same missing slots. Good news for derivation: this reader already takes its checklist from one server-side function, so a contract change in one place reaches it without a script change.

### Landing fold photo_land_classification and its first-write-wins behaviour (read)

**What exists.** Newest definition is in 20261109213000 (the only migration that defines it). For a completed image it writes: image_descriptions (one row, description_type classifier_v2, only if none exists for the image); photo_extracted_fields (one row per vehicle_fields name, highest confidence wins, plus vin, plus fixed keys core.image_type, core.is_automotive, core.classifier_confidence, core.description, doc.type, doc.kind; ON CONFLICT DO NOTHING); photo_text_lines (one row per line with region jsonb; ON CONFLICT DO NOTHING); field_evidence (confidence 0.6 or more, quote present, not a plate code, passes photo_field_not_about_vehicle; ON CONFLICT DO NOTHING); vehicle_identifiers for plate-stamping codes; image_angle_observations (only if none exists with source classifier_v2); image_camera_position from byok_deep_analysis.camera_pose when azimuth or elevation is numeric; photo_land_progress (upsert of counts). Any error is swallowed and returned as json; the trigger function swallows too.

**Writer.** photo_land_classification via photo_land_trigger

**Reader.** supabase/migrations/20261109000100_vehicle_identifier_observations.sql:69-121; nuke_frontend/src/components/image/ImageExpandedData.tsx:68 (image_descriptions); nuke_frontend/src/utils/resolveAngle.ts:61-79 (angle rows)

**Where.** supabase/migrations/20261109213000_reviewed_image_analysis.sql:20-165 (descriptions 42-47; fields 49-76; text lines 78-85; field_evidence 87-101; plate codes 103-117; angle 119-135; camera 139-156; progress 158-160; swallow 162-163), 175-191 (trigger function)

**Gap.** First write wins per image: a second description never lands; a re-read under the same prompt version (always v98) cannot change a field, a text line or an angle row. A supplied correction therefore changes the jsonb cache and leaves the normalized rows as first written. CREATE TABLE for photo_extracted_fields, photo_text_lines, image_descriptions, photo_land_progress and image_camera_position, the helper photo_plate_code_kind, and the CREATE TRIGGER that binds photo_land_trigger to vehicle_images are not in any migration (only test fixtures declare them), so their real unique keys and the trigger's events are unknown from the repo. The only reader of photo_extracted_fields and photo_text_lines in the repo is the identifier fold (VIN and plate).

### Angle vocabulary kept in step by hand, and already out of step (read)

**What exists.** The v98 manifest offers 9 angle strings. The fold maps 6 of them to angle_taxonomy.canonical_key in a CASE typed into the function; exterior_three_quarter, exterior_side and exterior map to NULL and produce no image_angle_observations row (the column ai_detected_angle still gets them). A table for exactly this mapping exists, angle_aliases (alias_key 'model output tokens, legacy keys' to angle_id), and the fold does not read it. Other view vocabularies in parallel: Codex VIEWS (11), phone zoneByLabel (8 zone words), deep-read scene_type (17), YONO vehicle_zone, legacy image_type (10).

**Writer.** photo_land_classification; persistV98Columns

**Reader.** resolveAngle.ts

**Where.** supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:280; supabase/migrations/20261109213000_reviewed_image_analysis.sql:119-126; supabase/migrations/20251216000001_angle_pose_observations_v1.sql:5-29; scripts/photo-pipeline/codex_image_analysis_ingest.py:20-21; apps/nuke-capture-ios/Sources/NukeCapture/OnDeviceAnalysis.swift:271-280; supabase/functions/_shared/byokImageVerdict.mjs:2

**Gap.** Three of nine emitted angles have no normalized row. Smallest existing thing to extend: angle_aliases rows for the classifier tokens, read by the fold instead of the CASE. The side of the car (left/right, driver/passenger) is not in any of these lists except YONO's zone codes.

### Engine-bay analysis and part-number OCR routes (inferred)

**What exists.** routeByType sends engine_bay frames to an edge function named analyze-engine-bay and part_closeup frames to part-number-ocr, expecting engine_family, engine_displacement, fuel_system and a parts array back. Neither function has a folder under supabase/functions in this checkout. The stage registry row for engine_bay says a stage_unavailable marker is recorded when the function is not deployed; the ledger lists analyze-engine-bay as deleted and part-number-ocr as a deleted dangling reference. Failures are caught and reported as a summary string in ai_scan_metadata.route_result.

**Writer.** none in repo

**Reader.** updateFieldEvidence would read the result

**Where.** supabase/functions/photo-pipeline-orchestrator/index.ts:959-977, 992-995, 1159-1219; supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql:84; docs/ledger/ledger.json:274; docs/ledger/CAPABILITY_MAP.md:113

**Gap.** For these two image types there is no reader beyond the classifier, so an engine-bay or loose-part photo yields a description, text lines and a deep-queue flag only. Whether either function is deployed is not known from the repo.

### Receipt OCR and document pages: three document-type vocabularies (read)

**What exists.** Document frames go to receipt-photo-ocr, which reads with document-ocr-worker (16 DOC_PROMPTS keys, each a typed field list) or accepts an extraction from the Mac document reader (its own list of 14 types and its own flat key list: vendor_name, date, line_items[{description, part_number, quantity, unit_price, amount}], totals, vin, year, make, model, notes). It writes one capture_document_pages row (doc_type, class_conf, doc_date, extraction jsonb) and, for money types on a filed frame, lands through land_document_pages into vehicle_documents, receipts and receipt_items, then bridges to observations. The money/landing type lists use the Mac reader's words (work_order, packing_slip, order_confirmation, alignment_report, estimate, statement). The v98 manifest and document-ocr-worker say repair_order instead; landType maps repair_order to other, which is recorded as 'a vehicle document, not a receipt; page recorded' and gets no receipt rows.

**Writer.** receipt-photo-ocr; land_document_pages

**Reader.** capture set scorers, deep-read receipt roster (deep-image-analysis-byok.mjs:383-401)

**Where.** supabase/functions/receipt-photo-ocr/core.ts:156-158, 225-232, 345-375, 388-394, 411-431; supabase/functions/receipt-photo-ocr/index.ts:31-73; supabase/functions/document-ocr-worker/index.ts:39-169; scripts/photo-pipeline/subscription-document-reader.mjs:38-39, 128-134; supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:282-302

**Gap.** A photographed repair order, the document most likely to say 'replaced window felts' with labour lines, lands as a page blob and not as receipt_items when its type arrives as repair_order (from the classifier hint or the worker's own classify). The three type lists are kept in step by hand. Line-item descriptions are free text; nothing keys a line to a component.

### Deep read: the contract and its hand-kept copies (read)

**What exists.** One verdict per image: scene_type (17 fixed), build_phase_guess (12 fixed), intent (7 fixed) with intent_confidence and needs_clarification, camera_pose {azimuth_deg, elevation_deg, distance_est, framing, exif_present, method} (the prompt orders measurements kept null), components_seen [{label free text, confidence, bbox 0..999, part_number_guess}], text_regions [{text, bbox, confidence}], damage_localized [{label free text, bbox, severity}], state_observations {rust_severity 5 values, paint_state 7, completeness 4, damage_callouts free strings}, workshop_signals {tools_visible free strings, fixturing, weld_quality, lighting}, presence {person, dog, place_hint}, narrative_one_line, confidence, context_complete, open_questions, agent_notes. The same enums are typed in the markdown prompt, the shared validator, the edge validator, the CLI output schema, a JSON schema file, the script header comment, and a SQL scene list.

**Writer.** reviewed-image-batch.ts (three model stages v1, teacher, v2) through record_reviewed_analysis

**Reader.** see next finding

**Where.** scripts/daily-receipt/byok-vision-prompt.md:18-50, 64-78; supabase/functions/_shared/byokImageVerdict.mjs:2-8; supabase/functions/photo-pipeline-orchestrator/reviewedAnalysis.ts:14, 31-34, 49-59; scripts/daily-receipt/reviewed-image-batch.ts:115-135, 278-294; scripts/schemas/byok-image-verdict.schema.json:17-29, 75-83; scripts/deep-image-analysis-byok.mjs:22-36; supabase/migrations/20261109213000_reviewed_image_analysis.sql:332-338

**Gap.** Drift is already visible: the header comment's scene list omits off_property, which the validator accepts; the prompt lists enums for fixturing, weld_quality, lighting and damage severity while every validator accepts any string, and the suggested severity words (surface, pitting, perforation) are rust words that do not fit a chip or a dent. Component and damage labels are free text with no list or table behind them. There is no per-component state (new, original, worn), no panel or side key, and no field for 'same object as image X'; cross-frame links are told to go into agent_notes prose.

### Deep read: where the verdict lands and who reads it (read)

**What exists.** The whole verdict is stored three ways: vehicle_observations (kind condition, structured_data = verdict, content_text = narrative); the jsonb cache vehicle_images.ai_scan_metadata.byok_deep_analysis; one image_observations row whose confidence_basis carries scene_type and an evidence role. The reader function get_image_deep_analysis returns narrative, intent, scene_type, build_phase, place_hint, confidence, model, notes, paint_state, rust_severity, completeness, damage_callouts, components_seen, open_questions, needs_review. user_image_deep_reads is a per-image counter row, not content. The web profile searches these blobs by substring (ilike on narrative_one_line and on components_seen cast to text) for two hand-listed fields.

**Writer.** project_reviewed_image_analysis; ingest-observation

**Reader.** get_image_deep_analysis (iOS), web gallery and lightbox, read_work_order_image_objects (20261019031934:14-44), day-receipt scripts

**Where.** supabase/functions/photo-pipeline-orchestrator/reviewedAnalysis.ts:107-122; supabase/migrations/20261109213000_reviewed_image_analysis.sql:310-318, 339-347, 414-434; supabase/migrations/20261016201000_user_image_counts.sql:34; apps/nuke-capture-ios/Sources/NukeCapture/AnalyzedPhotosView.swift:46-49, 396; nuke_frontend/src/pages/vehicle-profile/hooks/useVehicleImageEvidence.ts:58-61, 131-134; nuke_frontend/src/components/images/ImageZoneSection.tsx:298-304

**Gap.** damage_localized (the only place a defect gets a label and a box) is not returned by get_image_deep_analysis, is not projected by any fold, and has no row anywhere. text_regions, workshop_signals.tools_visible, open_questions and agent_notes likewise stay in the blob. Search over the blob is substring matching on unindexed jsonb, per vehicle.

### Component rows from the deep read (component_identifications) (read)

**What exists.** landEntityPage writes one image_analysis_records row per frame and one component_identifications row per components_seen element: identification = the verbatim label (free text), component_type = one of 13 families chosen by regex typed into the script, bounding_box, confidence, status inferred, day_context or confirmed (confirmed when OCR text on the component or the part_number_guess matches a receipt_items part number), citation_text, source_references. The table has a component_definition_id column that references component_definitions and is commented 'NULL if not in our database yet'; the writer does not set it. A reader function returns these as tap targets.

**Writer.** deep-image-analysis-byok.mjs entities (manual)

**Reader.** get_image_component_targets; scripts/discovery/buying-evidence-plan.mjs

**Where.** scripts/deep-image-analysis-byok.mjs:340-359, 410-568 (rows 511-551), 576-612, 820-821, 874-892, 1291; supabase/migrations/20251202_component_knowledge_base.sql:10-32, 222-229; supabase/migrations/20260702061000_get_image_component_targets.sql:18-40; supabase/migrations/20261008020000_describe_component_identifications.sql:37

**Gap.** It runs only from the manual `entities` command; the current ingest path states it makes no entity writes, and no schedule or caller of `entities` exists in the repo. Labels are free text, so 'driver door window felt', 'window felt' and 'door glass weatherstrip' are three unrelated strings; the table's own description says nothing links two rows that name the same physical part, and read_work_order_image_objects reports physical_identity 'unresolved' for every sighting. Smallest existing thing to extend: fill component_definition_id (or a key into an existing component list) at landing.

### The one reading field that is keyed to the model registry: three per-image enums (read)

**What exists.** observation_properties holds image_visible_rust_severity, image_visible_paint_stage, image_visible_assembly_state (enum, per image, kind condition) and image_visible_badge_text, image_spid_rpo_codes (per image, kind specification). project-cached reads stored deep-read observations and emits one keyed vehicle_observations row per known value through ingest-observation-batch, which checks the key against the registry and writes an image witness. This is the pattern that turns a blob field into a keyed, joinable row.

**Writer.** project-cached (manual) via ingest-observation-batch

**Reader.** get_field_provenance (named at 20261003001412:26; not opened), profileSourceClaims.ts:71

**Where.** supabase/migrations/20261003001412_cached_image_property_keys.sql:7-21; supabase/migrations/20261018233000_image_badge_spid_reading_properties.sql:7-19; scripts/lib/image-property-projection.mjs:4-8, 15-82, 98-167; scripts/deep-image-analysis-byok.mjs:1239-1277; supabase/functions/ingest-observation/imageProperties.ts:6-13, 134-169

**Gap.** The allowed values live as prose in the registry description and are typed again in imageProperties.ts, image-property-projection.mjs, byokImageVerdict.mjs, reviewedAnalysis.ts, reviewed-image-batch.ts, the markdown prompt and the JSON schema. The projection is a manual CLI mode with no caller in the repo. The grain is one image: 'primer' or 'clear' says nothing about which panel. No writer of image_visible_badge_text or image_spid_rpo_codes was found outside validation and readers. The projected row's observed_at is the ingest time of the source reading, not the capture time (image-property-projection.mjs:54-56).

### Folds that exist as SQL and have no caller in the repo (inferred)

**What exists.** cascade_micro_atoms turns blob fields lighting, fixturing, weld_quality, scene_type, build_phase, place_hint, person_present into scene_micro_atom_evidence rows (one per image and atom type). cascade_parts_evidence turns components_seen elements that carry a part_number_guess at confidence 0.8 or more into part_observation_evidence rows, matched to a catalog when possible. promote_image_depth_to_columns copies components_seen and camera_pose into vehicle_images.components, camera_pose, ai_component_count, ai_avg_confidence.

**Writer.** the three SQL functions

**Reader.** coverage RPCs (20260618040000, 20260618050000; not opened)

**Where.** supabase/migrations/20260618030000_cascade_micro_atoms.sql:7-58; supabase/migrations/20260618020000_cascade_parts_evidence.sql:9-83; supabase/migrations/20260623010000_promote_image_depth_to_columns.sql:21-70; supabase/migrations/20260927170000_p0_4_close_rpc_write_door.sql:65-66

**Gap.** No script, function or cron in the repo calls any of the three; whether a live cron does is unknown. None of them touches damage_localized. Per liveness rule 1 this is unwired, not dead.

### Phone: what it reads, what it uploads, where it lands (read)

**What exists.** On device: Apple Vision classification labels (Apple's identifiers) with an is-vehicle rule from two typed label sets; face presence; a feature print; OCR text; VIN, classic serial and plate reads with check-digit and confidence rules; a scene_zone guess from a typed label-to-zone map. Uploaded with the photo row: apple_ml_labels, latitude, longitude, taken_at, file_hash, exif_data {uuid, original_filename, camera make and model, source_type, owner_verified}. Later pushes: sync_local_vision_tags fills apple_ml_labels if empty and writes ai_scan_metadata.on_device_vision {source, labels, is_vehicle, is_personal, owner_verdict, synced_at}; record_device_reading stores per-image {is_vehicle, is_document, labels, vin_candidates, on_device[{kind, value, confidence, source}]} inside image_observations.confidence_basis.visual_subject_reading_v1; a VIN read fills vehicle_images.vehicle_vin and its confidence when empty. For a document frame only labels and zone guesses leave the phone.

**Writer.** NukeCapture iOS

**Reader.** orchestrator fast path (index.ts:532-549), resolveVehicle row VIN (index.ts:837-856), deep-read worklist apple_hints (deep-image-analysis-byok.mjs:806), subject service identity fold

**Where.** apps/nuke-capture-ios/Sources/NukeCapture/VisionEngine.swift:24-33, 46-51, 203-220, 410-415, 434-476; apps/nuke-capture-ios/Sources/NukeCapture/OnDeviceAnalysis.swift:29-65, 70-71, 238-239, 271-280, 304-337, 407-410; apps/nuke-capture-ios/Sources/NukeCapture/SupabaseService.swift:22-49; apps/nuke-capture-ios/Sources/NukeCapture/LocalTagPush.swift:23-51; apps/nuke-capture-ios/Sources/NukeCapture/AttributionEngine.swift:97-117, 1339-1340; supabase/migrations/20261017160000_sync_vision_tags_capture_rows.sql:21-127 (labels 78-82; blob 83-91); supabase/functions/check-image-vehicle-match/subjectService.ts:203-227, 270-283, 798-807

**Gap.** The six kinds, the cap of 40 and the identifier shape rule are mirrored by hand between Swift and TypeScript (the Swift comments say so). The zone words (engine_bay, interior, wheel, shop, outdoor_lot, road, exterior, paperwork) match no table. Everything except apple_ml_labels, vehicle_vin and the capture columns is jsonb. The phone reads no component, defect or panel.

### Codex reading contract v1 (a fifth vocabulary) (read)

**What exists.** A batch reader with its own enums typed in Python: view (11 values), category (9), matches_filed_vehicle (4), quality (3), plus body_cues, make_cues, notes as free text. It writes one image_observations row per image through ingest_image_observation with vehicle_id null, role incidental, and the whole reading inside confidence_basis.codex_image_analysis_v1.

**Writer.** codex_image_analysis_ingest.py

**Reader.** none found in repo beyond its own duplicate check

**Where.** scripts/photo-pipeline/codex_image_analysis_ingest.py:17-24, 97-116; scripts/photo-pipeline/CODEX_ANALYSIS.md:9-22

**Gap.** Entirely jsonb; its view list overlaps and differs from the classifier's angle list and the deep read's scene list. No normalized row.

### Cockpit attribute checklist (the only contract that names defects and panels) (read)

**What exists.** attribute-registry.ts is a code registry of about 47 attributes, each with subject kind, layer, dependencies, its own prompt text, expected shape, optional enum values and admissible evidence classes. vehicle.condition_cues asks for {kind, severity, bbox, panel} with kind from a typed list that includes paint_chip, dent, rust_surface, recent_repair_evidence; vehicle.refinish_event asks for a repaint as a state change citing a before/after image pair; cluster.work_transition asks for {state_before, state_after, change_type, zones_changed, evidence_image_ids}. MCP callers fetch the checklist and submit answers; each answer is one projection_event row with the attribute name in request_envelope and the value as jsonb in result_envelope.label. Unknown attributes can be proposed into schema_proposals (type add_image_attribute); promotion into the code file is manual.

**Writer.** mcp-connector submit_attribute_value(s)

**Reader.** consensus and profile projections over projection_event (for example 20260615010000_project_vehicle_color.sql:32-63)

**Where.** supabase/functions/_shared/cockpit/attribute-registry.ts:1-27, 526-543, 590-605, 879-906, 1037-1058, 1061-1063; supabase/functions/mcp-connector/index.ts:644-687, 2496-2518, 2650-2665, 5901-5986; supabase/migrations/20260617030000_schema_proposals_add_image_attribute.sql:1-10

**Gap.** Not used by the classifier, the deep read, the Mac readers or the phone. Values are structured jsonb with free-text panel and no row per cue. It is a second registry, in code, stated to be the source of truth, while observation_properties is the registry in the database; nothing joins the two.

### Older zone, damage and surface lane (YONO) (read)

**What exists.** yono-analyze writes columns on vehicle_images: vehicle_zone (zone taxonomy code), zone_confidence, fabrication_stage, condition_score 1-5, damage_flags text[], modification_flags text[], photo_quality_score. surface_observations holds one row per finding per image (observation_type zone_classify, condition or modification; label = the raw flag; zone; optional zone box in inches on a vehicle surface template; bbox columns; severity; lifecycle_state; descriptor_id referencing condition_taxonomy; region_detail 'finer than zone'). The web gallery groups by vehicle_zone and overlays damage_flags. A coordinate-frame layer (vehicle_coordinate_frames) sits above it for owner-placed anchors.

**Writer.** yono modal scripts (per the dated description; not opened)

**Reader.** web gallery; nlq-sql

**Where.** supabase/functions/yono-analyze/index.ts:23-40, 121-139; supabase/migrations/20261007222000_describe_surface_observations.sql:18-27, 49, 63, 79, 95, 97, 105; supabase/migrations/20260702051500_xyz_spatial_anchors.sql:1-45; nuke_frontend/src/components/images/ImageZoneSection.tsx:4-7, 298-299; supabase/functions/photo-pipeline-orchestrator/index.ts:1050-1052

**Gap.** The orchestrator comment says the sidecar behind this lane answers 404 and the inflow was repointed to the deep queue; the dated description says the table's creating migrations are not in the repo, that a condition row repeats the zone the whole image was classified into (not where the damage is), and that region_detail was never written. This is the nearest existing normalized shape for 'defect X at place Y on the car', and the current readers do not write to it.

### Change claims: the table that could say 'replaced' or 'repaired' (read)

**What exists.** vehicle_change_claims has kind values part_installed, part_removed, paint, body, interior, detail, repair, inspection and others, a date window, asserted_value jsonb and a summary; vehicle_change_claim_support attaches evidence rows (evidence_kind includes vehicle_image and change_claim) with stance supports or contradicts and about (includes condition). AGENTS.md names writers propose_change_claim and propose_claim_support in a migration numbered 20261021221000.

**Writer.** none in repo

**Reader.** none found in repo

**Where.** supabase/migrations/20261021220000_image_evidence_tables.sql:362-421; AGENTS.md (section 'Writes and deploys', image evidence store)

**Gap.** The writers migration is not in this checkout and no script or function calls propose_change_claim or propose_claim_support. The claim row has no component key and no panel key; 'which part' can only be put in summary text or the asserted_value blob. No photo reader emits a claim.

### Model-side registries that exist and are not connected to any reader's prompt (read)

**What exists.** observation_properties (property keys with kinds, grain, discriminator; grown through schema_proposals add_property); observation_kind enum (grown through schema_proposals add_observation_kind); angle_taxonomy with angle_aliases; component_definitions (make, model family and year scoped component names with visual identifiers); condition_taxonomy (referenced by surface_observations.descriptor_id); image_pipeline_stages (stage registry whose contract column for the classifier is the literal string v98); pipeline_registry (column ownership).

**Where.** supabase/migrations/20261007100000_schema_proposal_apply_add_source.sql:142, 219; supabase/functions/api-v1-events/index.ts:268-308; supabase/migrations/20251216000001_angle_pose_observations_v1.sql:5-29; supabase/migrations/20251202_component_knowledge_base.sql:10-32; supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql:61-86; supabase/migrations/20261109213000_reviewed_image_analysis.sql:435-438

**Gap.** A newly ratified property, kind, angle or component never reaches a prompt: the reading contracts must be edited by hand in each file. The stage registry records which prompt version counts as done, not what the prompt asks.

### Trace 1: 'the driver door window felt is new' (read)

**What exists.** Classifier (v98 or legacy): only as words inside description, so a description string in ai_scan_metadata.classification, one image_descriptions row if it is the first, one photo_extracted_fields row under core.description, and vehicle_observations.content_text; there is no field for a part or its state. Deep read: 'driver door window felt' can be a components_seen label with a box, stored in the byok_deep_analysis blob and the condition observation's structured_data; 'new' has no slot and can only appear in narrative_one_line or agent_notes. If the manual entities command is run it becomes a component_identifications row with identification = that string, component_type body_exterior (the regex matches 'door'), status inferred, or confirmed only if a part number readable in the frame or guessed matches a receipt_items part number. Cockpit: no attribute for a part state. Change claim: none emitted.

**Where.** supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:349, 356; supabase/migrations/20261109213000_reviewed_image_analysis.sql:42-47, 71; scripts/daily-receipt/byok-vision-prompt.md:32-34, 45, 49, 77; scripts/deep-image-analysis-byok.mjs:350, 517-534

**Gap.** The part: a free-text label in a blob, or a free-text row only after a manual step. 'New': a description string, or nowhere. The deep-read prompt forbids inferring installation from a purchase, so 'replaced' is not a reading of one photo in this contract; it would be a claim joining a photo, a receipt line and a date, and no writer makes that claim.

### Trace 2: 'there is a paint chip on the left rear quarter panel' (read)

**What exists.** Classifier: image_type detail_closeup (its guide mentions damage) and words in description; nothing keyed. Deep read: a damage_localized element {label 'paint chip', bbox in image coordinates, severity free text} and possibly a damage_callouts string; both stay in the byok_deep_analysis blob and the observation's structured_data. The panel has no field: scene_type has no side, camera_pose measurements are ordered null, and the bbox is a place in the picture, not on the car. Cockpit vehicle.condition_cues would carry {kind paint_chip, severity, bbox, panel} as one jsonb value in projection_event if an MCP caller submitted it. The older lane would set vehicle_images.damage_flags and a surface_observations condition row at the whole image's zone.

**Where.** supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:270; scripts/daily-receipt/byok-vision-prompt.md:29-31, 36, 40, 75; supabase/migrations/20261109213000_reviewed_image_analysis.sql:419-424; supabase/functions/_shared/cockpit/attribute-registry.ts:526-543; supabase/migrations/20261007222000_describe_surface_observations.sql:63, 79, 97

**Gap.** A description string plus an element in a jsonb array that no fold, reader function or index touches. No keyed row for the defect and no key at all for the panel. Smallest existing things to extend: the per-image property projection pattern (a registered key plus a row per damage element) or surface_observations, which already has label, bbox, severity and the never-written region_detail.

### Trace 3: 'this is the same panel as in an earlier photo, now repainted' (read)

**What exists.** Nowhere as a keyed fact. Each reader looks at one image (classifier, phone, Codex) or one same-day batch of at most 8 (deep read), and the deep-read contract has no field that points at another image; the prompt sends such links to agent_notes prose. What can be computed today is per vehicle, not per panel: image_visible_paint_stage rows (bare_metal to clear) across images if the manual projection ran, and build_phase atoms if the cascade ran. The cockpit has cluster.work_transition and vehicle.refinish_event, which carry evidence image ids inside a jsonb value. vehicle_change_claims (kind paint or repair) with two vehicle_image support rows is the table shape for it and has no writer here. image_observations clusters identify whole vehicles, not parts.

**Where.** scripts/daily-receipt/byok-vision-prompt.md:49, 52-62; scripts/daily-receipt/reviewed-image-batch.ts:153, 192; supabase/migrations/20261019031934_work_order_image_objects.sql:44; supabase/functions/_shared/cockpit/attribute-registry.ts:590-605, 879-906; supabase/migrations/20261021220000_image_evidence_tables.sql:362-421

**Gap.** Missing at the reading level: any identity for a part or a defect that two readings could share (a component key plus a place on the car), and any output field that names an earlier image. Missing at the landing level: a writer for the change-claim tables. Without the first, the second has nothing to join on.

### Fields a reading emits today that have no normalized home (read)

**What exists.** Classifier: medium_context; detected_text (legacy); vehicle_hints; vin.evidence_role; document.fields and field_confidence; angle values exterior_three_quarter, exterior_side, exterior (column only). Deep read: build_phase_guess, intent, intent_confidence, scene_type (blob, image_observations basis, and atoms only if the cascade runs); components_seen (rows only by manual command); text_regions; damage_localized; damage_callouts; workshop_signals; presence; camera_pose.framing and method; open_questions; context_complete; agent_notes. Phone: every on_device observation (ocr_text, plate, classification_label, scene_zone), is_personal, owner_verdict. Codex: the whole reading. Cockpit: every attribute value.

**Where.** supabase/functions/photo-pipeline-orchestrator/classifierTypes.ts:45-85; supabase/migrations/20261109213000_reviewed_image_analysis.sql:49-76, 119-126, 139-156; scripts/daily-receipt/byok-vision-prompt.md:18-50; supabase/functions/check-image-vehicle-match/subjectService.ts:270-283; scripts/photo-pipeline/codex_image_analysis_ingest.py:100-109; supabase/functions/mcp-connector/index.ts:2650-2665

**Gap.** These are reachable only by reading jsonb on vehicle_images, vehicle_observations, image_observations or projection_event.

### Every place a vocabulary is kept in step by hand (read)

**What exists.** image_type list: classifierTypes.ts:31-41; classifier.ts:62 and 154; classifierProvider.ts:265-276 and 478; index.ts:306, 935-1043, 1268-1274. image_medium: classifier.ts:63, 157; classifierProvider.ts:277, 489 (mirrors a CHECK constraint). document_category, receipt_doc_kind, field_names, angles: classifierProvider.ts:278-281 (comments at 256-259 name the constraint, enum or column each mirrors). VIN evidence_role: classifierTypes.ts:81; classifierProvider.ts:355, 430. Photo field names in the SQL gate (includes engine_size, engine_configuration, horsepower, which the manifest lacks): 20261109223000_photo_field_source_roles.sql:44-45, 50, 56. Angle to taxonomy map: 20261109213000:119-126. Document types: classifierProvider.ts:282-302; document-ocr-worker/index.ts:39-169; subscription-document-reader.mjs:38; receipt-photo-ocr/core.ts:157-158. Deep-read enums: byok-vision-prompt.md:21-43; byokImageVerdict.mjs:2-8; reviewedAnalysis.ts:14, 31-34; reviewed-image-batch.ts:123-130; byok-image-verdict.schema.json:19-29, 79-81; deep-image-analysis-byok.mjs:22-35; 20261109213000:332-338. Image property values: 20261003001412:13-20 (prose); imageProperties.ts:6-10; image-property-projection.mjs:4-8. Component families: deep-image-analysis-byok.mjs:340-354. Phone kinds and cap: OnDeviceAnalysis.swift:30-37, 70-71 against subjectService.ts:203-204. Codex enums: codex_image_analysis_ingest.py:20-24. Cockpit condition kinds: attribute-registry.ts:536-540. Stage contract string: 20261113110000:82.

**Where.** supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:252-303; supabase/functions/_shared/byokImageVerdict.mjs:2-8; supabase/functions/ingest-observation/imageProperties.ts:6-13; supabase/functions/check-image-vehicle-match/subjectService.ts:203-204

**Gap.** None of these lists is read from a table at prompt time, and none of the tables is checked against the lists by a test that was found. Two mismatches found by reading: repair_order versus work_order in the document lane, and three angle values without a taxonomy mapping.

## To read from production

- pg_proc: does public.classifier_schema_manifest() exist, and what does its body return (which lists, from which tables)?
- pg_trigger on public.vehicle_images: which trigger executes photo_land_trigger, its timing, events and column list; and pg_get_functiondef of photo_plate_code_kind.
- pg_constraint / pg_indexes for photo_extracted_fields, photo_text_lines, image_descriptions, image_camera_position, photo_land_progress: the real unique keys behind the fold's ON CONFLICT DO NOTHING.
- vehicle_images (owner-scoped via the capture index, not a full scan): count by ai_scan_metadata #>> '{classification,v2,prompt_version}' (v98 versus absent) and by classification->>'image_type'.
- photo_extracted_fields: count by field_name, source, prompt_version; photo_text_lines: row count and distinct images; image_descriptions: count by description_type and source.
- image_angle_observations: count by source; angle_taxonomy: list of canonical_key where deprecated_at is null; angle_aliases: all rows; vehicle_images.ai_detected_angle: count per value for owner images, to size the three unmapped angles.
- photo_land_progress: count where result ? 'error', grouped by result->>'state' (how often the fold fails silently).
- vehicle_observations where structured_data->>'analysis_kind' = 'image_deep_byok' and is_superseded is false (per vehicle, bounded): count; count with a non-empty damage_localized array; count with a non-empty components_seen array.
- component_identifications: count by status and component_type; max(created_at); count where component_definition_id is not null. image_analysis_records: count where superseded_by is null.
- vehicle_observations joined to observation_properties: count per property_key for image_visible_rust_severity, image_visible_paint_stage, image_visible_assembly_state, image_visible_badge_text, image_spid_rpo_codes; max(ingested_at) for each.
- observation_properties: every row with namespace core and category in (condition, identity): property_key, data_type, applies_to_kinds, discriminator_key, and whether allowed values are stored anywhere other than description.
- pg_proc existence of propose_change_claim, propose_claim_support, decide_evidence; vehicle_change_claims: count by kind and claim_domain; vehicle_change_claim_support: count by evidence_kind and about.
- projection_event: count by request_envelope->>'attribute' for vehicle.condition_cues, vehicle.refinish_event, cluster.work_transition, vehicle.modifications and the image.* attributes; schema_proposals: count where proposal_type = 'add_image_attribute' by status.
- surface_observations: max(created_at); count by observation_type and label; count where region_detail is not null; condition_taxonomy: row list (descriptor_id, key); vehicle_surface_templates: zone_bounds keys.
- scene_micro_atom_evidence and part_observation_evidence: max(created_at) and count by atom_type / matched; cron.job: any command naming cascade_micro_atoms, cascade_parts_evidence, promote_image_depth_to_columns, or the entities / project-cached scripts.
- Deployed edge function list: are analyze-engine-bay and part-number-ocr deployed? vehicle_images (owner-scoped): count where ai_scan_metadata->>'route_result' like 'analyze-engine-bay: failed%' or like 'part-number-ocr: failed%'.
- capture_document_pages: count by doc_type and extraction->'landed'->>'as', in particular repair_order pages recorded as vehicle_document rather than receipt.
- image_observations: count of active rows by observed_by (visual_subject_reading_v1, codex_image_analysis_v1, caller-byok with agent_version reviewed_image_analysis_v1, device_privacy_v1).
- vehicle_images (owner-scoped): count where components is not null; where damage_flags is non-empty; where vehicle_zone is not null; max(vision_analyzed_at).
- field_evidence versus vehicle_field_evidence: count of photo-pipeline rows in each (raw_extraction_data->>'extractor' like 'photo%' versus extraction_model = 'photo-pipeline-v1'), by field_name.
- platform_config rows photo_classifier_provider and image_stage_reconciler; image_pipeline_stages rows (stage, required, required_version, contract).
- component_definitions: row count and distinct component_name count; whether any row covers glass or weatherstrip parts (to judge it as a candidate component vocabulary).

## Open questions

- Where should the mirror live? Two registries state opposite rules today: observation_properties plus schema_proposals in the database, and attribute-registry.ts whose comment says code is the source of truth by the owner's earlier call. The classifier manifest comment says 'generated from the live database' but is a constant.
- Which existing list is the model's component vocabulary: component_definitions (make/model/year scoped names), the 13 regex families in the deep-read script, parts_catalog, or none of them? No prompt cites any.
- Which existing list is the place-on-the-car vocabulary: the YONO zone codes with vehicle_surface_templates, angle_taxonomy, vehicle_coordinate_frames anchors, or a panel list that does not exist yet? The deep read is told to keep camera measurements null, so side cannot be derived from it today.
- Is 'new' or 'replaced' meant to be something one photo can say (a state of a part), or only a claim that joins a photo, a receipt line and a date? The deep-read prompt forbids the single-photo inference.
- Should a corrected or newer reading replace the normalized rows? The fold is first-write-wins while the jsonb cache is replaced, so the two can disagree after a correction.
- Is the classifier's own document read (document.fields) wanted, given receipt-photo-ocr reads the page again and nothing reads the classifier's copy?
- Are the manual modes (entities, project-cached) and the uncalled SQL folds (cascade_micro_atoms, cascade_parts_evidence, promote_image_depth_to_columns) meant to run automatically after a deep read, or were they deliberately left manual when the reviewed intake replaced the raw batch?
- Is the migration that defines the evidence writers (propose_change_claim and the rest, numbered 20261021221000 in AGENTS.md) on another branch, and is it applied live?
- Should the phone's scene_zone words and Apple labels map into the same zone vocabulary as the server readers, or stay as untyped hints?
