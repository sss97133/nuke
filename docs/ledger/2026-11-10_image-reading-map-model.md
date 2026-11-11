# Image reading map, 2026-11-10: the data model traced against the owner's three questions

Made by a read-only agent over the repository on 2026-11-10 for the owner direction recorded in
`docs/ledger/theory/data-machine.md` ("Image analysis is the model asking"). Repo only: nothing here was checked
against production, and a later definition may have replaced a cited one. An audit output, not active guidance:
verify a finding before acting on it (`docs/ledger/README.md`).

## Summary

Repo only; not checked live. The schema already holds every ingredient of the three questions, but as parallel, half-wired pieces: none of Q1-Q3 can be asked across vehicles today, and nothing in the repo gives a car part or an imperfection a key. Vehicle identity is the solid part: one `vehicles` row carries the car through time (cited VIN correction, merge/unmerge with lineage), so "before and after restoration" is the same vehicle_id at different dates; there is no restoration episode entity. A photo is tied to a vehicle in three places (`vehicle_images.vehicle_id`, `image_observations`, `image_vehicle_candidates`), and a part of a car is named by at least a dozen competing vocabularies (four parts catalogs, six zone lists); the only table that names a window felt is the digital-twin `body_weatherstripping`, which a 2026-10-14 migration comment calls empty and unwritten. "Replaced the window felts" is free text in one of six stores; the newest and most complete path is receipt line -> `receipt_work_lines` -> `garage_derivation_evidence` -> `evidence_judgment_requests`, which is per vehicle, service-only, and deliberately gives weatherstrip lines no photo zone, so a felt line never reaches a photo judgment. Imperfections live in ten or more stores; the current writer lands the deep image verdict as a `vehicle_observations` condition row with `damage_localized` (free-text label, box in the image, severity) plus `observation_witnesses`, beside two separate vocabularies (`condition_taxonomy`, `observation_properties`); no row gives one imperfection an identity across photos or time. "This imperfection was repaired" has a designed home, `vehicle_change_claims` with support rows that cite images, but its writers and readers (migration 20261021221000) are not in the repo and a support row cannot cite a condition observation; the `visual_work_v1` record has before/during/after photo roles and a reader, and no producer in the repo. Photographic proof has one sound bridge, `observation_witnesses` (observation x image x role, same vehicle enforced), read per vehicle only. Site search is make/model/year/price plus full text over description, comment and evidence text (`search_vehicles_deep`); no reader takes a component, a kind of work or a condition and returns vehicles with their photos. The "mirror" itself exists four times (digital-twin DDL used as the prompt, the `attribute-registry.ts` checklist, the `observation_properties` registry, the agent write API schemas), each landing in a different store.

## The three questions

### Q1. Mustangs whose window felts were replaced during a restoration, with photographic proof.

**Path today.** Four partial paths, none complete, all repo only. (A) Receipt path, private and per vehicle: vehicles (make, model text) -> receipt_vehicle_links (linked) -> receipts -> receipt_items.description matching 'felt' -> garage_derivation_evidence (kind receipt_work_correlation, subject_key 'receipt_item:<id>', image_ids) -> evidence_judgment_requests (question_kind receipt_part_visible, answer installed / image_id / bbox). It stops for felts: receipt_line_photo_zone gives weatherstrip lines no zone and has no pattern for 'felt', so the line concludes part_zone_unknown and no photo judgment is raised. (B) Work-record path: vehicle_observations kind work_record whose structured_data text names felts, with observation_witnesses to the photo, or a visual_work_v1 row with before/after visual_sources and a receipt_links entry; no producer of visual_work_v1 is in the repo. (C) Public listing text: activity rows from retained_listing_reported_work (BaT, month-dated sentences, held migration), no photo. (D) Full text: search_vehicles_deep('window felts replaced') returns vehicles and a snippet, no structure and no photo. The component itself has a home only in body_weatherstripping + component_events (event_type replaced), described as empty and unwritten. 'Mustang' is a text match on vehicles.model (canonical_models exists for model keys). 'During a restoration' cannot be tested: there is no episode to belong to.

```sql
-- A: receipt line -> correlated photos -> answered judgment (may return nothing; private tables)
SELECT v.id, v.year, v.model, i.description, l.page_date,
       e.conclusion, e.image_ids, j.answer->>'installed' AS installed, j.answer->>'image_id' AS proof_image, j.answer->'bbox' AS bbox
FROM vehicles v
JOIN receipt_vehicle_links l ON l.vehicle_id = v.id AND l.status = 'linked' AND l.retired_at IS NULL
JOIN receipts r ON r.id = l.receipt_id AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
JOIN receipt_items i ON i.receipt_id = r.id
LEFT JOIN garage_derivation_evidence e ON e.kind = 'receipt_work_correlation' AND e.vehicle_id = v.id
     AND e.subject_key = 'receipt_item:' || i.id AND e.superseded_at IS NULL
LEFT JOIN evidence_judgment_requests j ON j.question_kind = 'receipt_part_visible'
     AND j.subject_table = 'receipt_items' AND j.subject_id = i.id AND j.status = 'answered'
WHERE v.make ILIKE 'ford' AND v.model ILIKE '%mustang%'
  AND i.description ~* '(window|door|belt).{0,20}(felt|sweep|fuzz)|felt kit|weatherstrip';

-- B: work records that say it, with their witness photos
SELECT v.id, o.id AS observation_id, o.observed_at, o.extraction_method, w.image_id
FROM vehicles v
JOIN vehicle_observations o ON o.vehicle_id = v.id AND o.kind = 'work_record' AND o.is_superseded IS FALSE
LEFT JOIN observation_witnesses w ON w.observation_id = o.id
WHERE v.make ILIKE 'ford' AND v.model ILIKE '%mustang%'
  AND o.structured_data::text ~* 'felt|weatherstrip';

-- C: publisher-reported sentences (no photo)
SELECT c.vehicle_id, c.structured_data->>'performed_clause', c.structured_data->>'reported_date'
FROM vehicle_observations c JOIN vehicles v ON v.id = c.vehicle_id
WHERE c.kind = 'activity' AND c.extraction_method = 'retained_listing_reported_work_v1' AND c.is_superseded IS FALSE
  AND v.make ILIKE 'ford' AND v.model ILIKE '%mustang%' AND c.structured_data->>'performed_clause' ~* 'felt';
```

**Smallest missing piece.** Three things, smallest first. (1) A zone for felt / weatherstrip lines in receipt_line_photo_zone (today line 55 returns NULL on purpose), so path A can cite a photo at all. (2) A component key shared by the receipt line, the work record and the photo finding: today each is free text; the existing things it would extend are component_definitions (already an optional FK on component_identifications) or the digital-twin table + position pair that component_events already uses. (3) A cross-vehicle reader: receipt_work_lines and every work reader take one vehicle id. 'During a restoration' additionally needs a parent for work rows; the existing candidates are the work_orders header or a vehicle_change_claims row with a date window.

### Q2. A Porsche that has a specific imperfection on it.

**Path today.** Best path, repo only: vehicles (make Porsche) -> vehicle_observations kind condition written by the reviewed deep image verdict (structured_data.analysis_kind image_deep_byok) -> each element of structured_data.damage_localized (label free text, bbox 0-999 in the photo, severity) -> observation_witnesses -> vehicle_images (image_url, vehicle_zone, taken_at). Second path for text claims and keyed claims: vehicle_observations.descriptor_id -> condition_taxonomy.canonical_key (for example exterior.paint.fading), or property_id -> observation_properties (image_visible_rust_severity and two others), each with its witness image when one was cited. Third, where the photo is a listing photo with no deep verdict: only vehicle_images.damage_flags (rust, paint_fade, dent for the whole frame) and the idle surface_observations rows. An exact place on the body exists only as vehicle_observations.anchor_x/y/z_mm with condition_rating_0_100. Coverage is the limit: these rows exist only for photos that went through the deep review, which the comments place on owner photo libraries, not on the public listing photo population.

```sql
-- image-localized defects from the deep verdict (JSON scan on a very large table: sketch only, bound it by vehicle set first)
SELECT v.id, v.year, v.model, o.id AS observation_id,
       d.elem->>'label' AS label, d.elem->>'severity' AS severity, d.elem->'bbox' AS bbox_0_999,
       w.image_id, i.image_url, i.vehicle_zone, i.taken_at
FROM vehicles v
JOIN vehicle_observations o ON o.vehicle_id = v.id AND o.kind = 'condition' AND o.is_superseded IS FALSE
     AND o.structured_data->>'analysis_kind' = 'image_deep_byok'
CROSS JOIN LATERAL jsonb_array_elements(
     CASE WHEN jsonb_typeof(o.structured_data->'damage_localized') = 'array'
          THEN o.structured_data->'damage_localized' ELSE '[]'::jsonb END) d(elem)
JOIN observation_witnesses w ON w.observation_id = o.id
JOIN vehicle_images i ON i.id = w.image_id AND i.vehicle_id = v.id
WHERE v.make ILIKE 'porsche' AND v.is_public = true AND v.deleted_at IS NULL
  AND d.elem->>'label' ILIKE '%crack%';   -- free text: no descriptor key

-- descriptor-keyed claims (text or image), with photo when cited
SELECT v.id, t.canonical_key, o.citation_excerpt, o.observed_at, w.image_id
FROM vehicle_observations o
JOIN condition_taxonomy t ON t.descriptor_id = o.descriptor_id
JOIN vehicles v ON v.id = o.vehicle_id
LEFT JOIN observation_witnesses w ON w.observation_id = o.id
WHERE v.make ILIKE 'porsche' AND o.is_superseded IS FALSE AND t.canonical_key = 'exterior.paint.fading';
```

**Smallest missing piece.** The defect kind in the live image path is a free-text label: the smallest missing piece is carrying a condition_taxonomy key on each damage_localized element (ingest-observation already resolves descriptor_key for whole observations, and the registry already keys three other verdict fields through observation_properties). Second, the defect's place on the car: the box is in the photo and the zone is the frame's, so 'on the left quarter panel' is not stored; the existing things to extend are the photo's vehicle_zone, or the anchor columns for an exact point. Third, 'this specific imperfection' as one thing seen in several photos has no row; today each sighting stands alone. Fourth, no cross-vehicle reader and no index over these JSON arrays.

### Q3. That specific imperfection was repaired, and it is now this restored Porsche.

**Path today.** The vehicle half is answerable: the vehicle_id is the same before and after, merges keep lineage, and later vehicle_events / auction_events and photos carry later dates. The repair half has two designed shapes and neither closes the loop. (1) vehicle_change_claims of kind repair / body / paint / interior with vehicle_change_claim_support rows that cite photos (evidence_kind vehicle_image, stance supports or contradicts, about condition): the tables are in the repo, the writers and readers are not, the read policy is owner-only, and a support row cannot cite the earlier condition observation. (2) a visual_work_v1 work_record with visual_sources in roles before and after (the reader refuses a before photo later than its after photo) and optional receipt lines: a reader and a frontend hook exist, no producer is in the repo, and the record names no defect. Other partial holders: set_vehicle_build_image (one before and one after photo per vehicle, owner statement), cluster.work_transition atoms in projection_event (state_before, state_after, zones_changed, evidence_image_ids between two work days), component_events (event_type repaired on a digital-twin row). Absence of the defect in later photos is not recorded anywhere as a finding.

```sql
-- before/after visual work on a Porsche (reader-equivalent; may return nothing)
SELECT v.id, o.id AS work_observation_id, o.structured_data->>'title' AS title,
       b.s->>'image_id' AS before_image, a.s->>'image_id' AS after_image
FROM vehicles v
JOIN vehicle_observations o ON o.vehicle_id = v.id AND o.kind = 'work_record' AND o.is_superseded IS FALSE
     AND o.extraction_method = 'visual_work_v1' AND o.structured_data->>'contract' = 'visual_work_v1'
JOIN LATERAL jsonb_array_elements(o.structured_data->'visual_sources') b(s) ON b.s->>'role' = 'before'
JOIN LATERAL jsonb_array_elements(o.structured_data->'visual_sources') a(s) ON a.s->>'role' = 'after'
WHERE v.make ILIKE 'porsche';

-- change claims with photo support (store is owner-scoped; writers not in repo)
SELECT c.vehicle_id, c.kind, c.occurred_from, c.occurred_to, c.summary,
       s.evidence_id AS image_id, s.stance, s.about
FROM vehicle_change_claims c
JOIN vehicle_change_claim_support s ON s.claim_id = c.id AND s.superseded_by IS NULL AND s.evidence_kind = 'vehicle_image'
JOIN vehicles v ON v.id = c.vehicle_id
WHERE c.superseded_by IS NULL AND c.kind IN ('repair','body','paint','interior') AND v.make ILIKE 'porsche';

-- the join that cannot be written today: repair row -> the condition observation it resolved
-- (no column or support kind carries a vehicle_observations id for the defect)
```

**Smallest missing piece.** An edge from the repair to the defect. Exactly: vehicle_change_claim_support.evidence_kind (line 409) has no value for a vehicle_observations row, and visual_work_v1 carries images and receipt lines but no condition observation id; either one is the existing thing a 'resolves this finding' pointer would extend. Before that edge can mean anything, Q2's missing identity for one imperfection is needed (otherwise the repair points at one sighting, not the flaw). Also missing in the repo: the change-claim writers and readers themselves (migration 20261021221000), any producer of visual_work_v1, and a public or cross-vehicle reader over either. 'Restored' as a state of the car has no key; it would be read off the presence of this repair history.

## Findings

### 1a. Vehicle identity and identity over time (read)

**What exists.** One `vehicles` row is the car. VIN is a column on it with source columns (vin_source, vin_confidence, vin_source_image_id); a wrong VIN is corrected only through `correct_vehicle_vin` (expected value, cited source, old value kept in superseded_rows). Duplicate rows for one car are joined by `merge_into_primary` / `merge_carry_children` (moves images, observations, events, work sessions, receipts, work orders; journaled; `unmerge_vehicle` returns them), and moved rows keep `merged_from_vehicle_id`. Time lives on the children: every market episode is a dated `vehicle_events` / `auction_events` row on the same vehicle_id, owner periods are `vehicle_ownerships` rows written by one fold. So the same car before and after a restoration is the same vehicle_id with earlier and later dated rows. The evidence store also reserves identity claims (`vehicle_change_claims.kind` same_vehicle_as, vin_is, model_is).

**Writer.** correct_vehicle_vin; propose_vehicle_merge / propose_listing_vin_merge -> merge_into_primary(_batch); fold_vehicle_ownership_periods

**Reader.** vehicle profile readers; get_merge_proposals_with_details; v_vehicle_owner_periods

**Where.** supabase/migrations/20250101_minimal_setup.sql:22; supabase/migrations/20261015110000_correct_vehicle_vin.sql:1-12; supabase/migrations/20261021200000_merge_carries_records.sql:1-27; supabase/migrations/20261007003000_describe_vehicle_observations.sql:56-57; supabase/migrations/20260307_vehicle_events_unification.sql:12-14; docs/ledger/CAPABILITY_MAP.md:84; supabase/migrations/20261021220000_image_evidence_tables.sql:369-372,389-390

**Gap.** Two tables compete for merge proposals: `merge_proposals` (VIN/listing path) and `vehicle_merge_proposals` (owner fleet, evidence JSON, read by the review screen). Nothing on the vehicle or its children says 'restored' or points at the work that made it so: 'now this restored car' is only an inference from dates. Three unused or legacy holders of a 'build' compete: `vehicle_builds` (2025 project table), `vfc_builds` with `vehicle_observations.applies_to_build_id` (column comment: unused, no writer), and `work_orders` (the job header).

### 1b. How a photo is tied to a vehicle (read)

**What exists.** Three holders. (1) `vehicle_images.vehicle_id` is the filing: set at insert, or later by `attribute_testimony` (first attribution), `relink_testimony`, merges, and `derive_vehicle_image_attribution` (promotes the strongest active `image_observations` subject claim at 0.85 or more). (2) `image_observations` holds role-based links (subject, background, incidental) with a box, a cluster id into `emergent_vehicle_clusters`, is_active and supersession; `vehicle_background_images` reads the background links. (3) `image_vehicle_candidates` holds proposals (verdict, frame_role subject / also_in_frame, subject_key for a car with no row) decided in `evidence_decisions`. `evidence_links` is not an image link: it ties money and document rows (and a Photos item with no image row) to a vehicle.

**Writer.** uploaders/extractors, attribute_testimony, relink_testimony, derive_vehicle_image_attribution, link_background_vehicles; evidence writers absent from repo

**Reader.** public gallery (vehicle_images), vehicle_background_images, check-image-vehicle-match

**Where.** supabase/migrations/20261006230000_describe_vehicle_images.sql:49-50; supabase/migrations/20260614090000_attribute_testimony_and_gps_temporal_backfill.sql:1-30; supabase/migrations/20261110000100_background_vehicle_sightings.sql:1-45; supabase/migrations/20261018165532_bind_visual_subject_observations.sql:343-353; supabase/migrations/20261021220000_image_evidence_tables.sql:156-199,253-264; docs/ledger/CAPABILITY_MAP.md:128,134

**Gap.** Three tables answer 'which car is in this photo'. The third has no writer or reader in the repo: `propose_image_candidates`, `decide_evidence`, `evidence_candidates_for_images`, `v_image_candidates_current` are named in AGENTS.md and the capability map but defined in no migration (only a test stub of decide_evidence exists).

### 2a. Component / part vocabulary: no canonical key (read)

**What exists.** The capability map names a canonical parts catalog (`catalog_parts`, part numbers for sale) and the theory card names `observation_properties` as the property registry, but nothing is named as the key for 'a part of this car'. Competing holders, each with its own free text or enum: `component_definitions` (make/model-family scoped: component_category, component_name; `component_identifications.component_definition_id` is nullable), the digital-twin tables where the table name is the component class and a column is the position (`body_weatherstripping.location` door_lf .. vent_window_rf with material felt; `body_panels.panel_name` fender_lf, quarter_lf ...), `component_events.component_table` + component_id, `component_assembly_map.assembly_name` with sub_components JSON, `component_lifecycles.component_name`, `component_installations.component_type`, `component_conditions.component_name`, `condition_knowledge.system/component/sub_component`, `part_categories`, `labor_operations.code` (operation codes), `work_order_resource_specifications` material_key / process_key, and free-text labels per image (`component_identifications.component_type`, `vehicle_images.part`, `vehicle_images.components[].label`, verdict `components_seen[].label`, `part_observation_evidence.observed_label`).

**Writer.** scripts/deep-image-analysis-byok.mjs (labels); no writer for digital-twin tables per 20261014191500 comment

**Reader.** get_image_component_targets, get_vehicle_parts_ledger, read_work_order_image_objects

**Where.** docs/ledger/CAPABILITY_MAP.md:162; supabase/migrations/20251202_component_knowledge_base.sql:10-61,222-262; docs/archive/database/migrations/digital_twin_body_exterior_subsystem.sql:38,342-372; docs/archive/database/migrations/digital_twin_engine_subsystem.sql:79-105; supabase/migrations/20251206_component_assembly_map.sql:10-37; supabase/migrations/20251206_component_lifecycle_tracking.sql:16-62; supabase/migrations/20250928_component_installations.sql:2-36; supabase/migrations/20251122_professional_appraisal_tables.sql:44-76; supabase/migrations/20260314000001_condition_knowledge.sql:4-52; supabase/migrations/20260327100000_work_order_intelligence_schema.sql:58-71; supabase/migrations/20261006230000_describe_vehicle_images.sql:122-123,221-222; supabase/migrations/20261008020000_describe_component_identifications.sql:52-53; supabase/migrations/20261004000000_part_observation_evidence_keys_and_descriptions.sql:1-7,19-36

**Gap.** A window felt, a quarter panel and a seat cover have no shared key. The part-number catalog is itself forked four ways, stated in a migration comment: parts_catalog / catalog_parts / part_catalog / intelligent_parts_catalog, which is why `part_observation_evidence.catalog_part_id` has no foreign key. Every image-level component label is free text ('labels are free text, so the same physical part seen in many frames has many rows and nothing links them'). The only table that names a window felt is `body_weatherstripping`, whose DDL sits in docs/archive, not in supabase/migrations. Smallest existing thing a canonical key would extend: either the digital-twin table+position pair already used by `component_events`, or the nullable `component_identifications.component_definition_id` FK.

### 2b. Where on the car: six zone lists (read)

**What exists.** (1) `vehicle_images.vehicle_zone`, a 41-zone list from yono/VISION_ARCHITECTURE.md (ext_front_driver, panel_door_fl, int_dashboard ...), about the whole frame. (2) `vehicle_surface_templates.zone_bounds` keys, which use other names (int_door_panel_driver), so some classifier zones never get coordinates. (3) `receipt_line_photo_zone`: six zones (dashboard, interior, engine, wheel, undercarriage, exterior) read from a receipt line's words. (4) The agent write API enum of 13 zones/systems (engine_bay, undercarriage, interior, body ...). (5) Digital-twin position enums (door_lf, quarter_lf ...). (6) `condition_taxonomy.canonical_key` whose middle segment is an area (exterior.metal.oxidation). Fine position: `vehicle_observations.anchor_x/y/z_mm` in a `vehicle_coordinate_frames` frame with `condition_rating_0_100`, and `surface_observations` inch boxes (a template box for the zone, not a measured place).

**Writer.** yono-analyze and scripts (vehicle_zone); receipt_line_photo_zone is a pure function

**Reader.** receipt_work_lines, vehicle_surface_coverage, nlq-sql

**Where.** supabase/migrations/20261006230000_describe_vehicle_images.sql:258-259; yono/VISION_ARCHITECTURE.md:82,97; supabase/migrations/20261007232000_surface_observations_comment_after_door_fix.sql:28-29; supabase/migrations/20261111210500_receipt_work_reconciliation.sql:51-71,99-113; docs/api/schemas/v1/service.json (zones_touched enum); supabase/migrations/20260702051500_xyz_spatial_anchors.sql:27-84; supabase/migrations/20261007003000_describe_vehicle_observations.sql:140-146

**Gap.** No crosswalk between the six lists except the hand-written `image_photo_zones` function (maps classifier angle, vehicle_zone, scene_type and device labels onto the six receipt zones). A zone describes the frame, not the finding: the surface_observations comment says a rust row 'says the image was classified as ext_front_driver, not that rust was found there'. The xyz anchor columns' unit is not recorded consistently (column names say mm, the one frame row says m).

### 2c. The digital twin: one table per component, used as the prompt (read)

**What exists.** About a hundred per-component state tables (engine_blocks ... body_glass, body_trim_chrome, body_weatherstripping, door_panels, seats, paint_systems), each: vehicle_id, a position enum, is_original, condition_grade, condition_notes, provenance (original / nos / reproduction / aftermarket), provenance_detail; plus `component_events` ('universal work log': component_table, component_id, event_type installed / removed / rebuilt / repaired / replaced / painted ..., event_date, actor_id, cost, evidence_ids -> field_evidence, later work_order_id) and `actors`. `scripts/fill-vehicle-form.mjs` loads the table DDL and column comments as the prompt, parses INSERTs and writes `field_evidence` per filled value.

**Writer.** scripts/fill-vehicle-form.mjs, scripts/jury-fill.mjs (scripts; not scheduled)

**Reader.** work-order job path and capability fold read component_events

**Where.** docs/archive/database/migrations/digital_twin_body_exterior_subsystem.sql:1-29,342-372; docs/archive/database/migrations/digital_twin_engine_subsystem.sql:79-124; supabase/migrations/20261014191500_service_role_catalog_policies.sql:1-41; docs/library/reference/dictionary/tables.md:8263-8282,8329-8346,9367-9392; scripts/fill-vehicle-form.mjs:1-13,78; docs/library/reference/dictionary/README.md:105,129,324

**Gap.** The DDL is only in docs/archive (not in supabase/migrations). The 2026-10-14 migration comment says these tables were empty and that nothing writes them. They are mutable state rows (updated_at), with no source, observed_at or image key on the row; `component_events.evidence_ids` points at `field_evidence`, not at images or observations. The job loop reads `component_events` as its 'operations performed' witness, so that one table is in use by readers while the component tables it points into are not.

### 3a. Work done: where 'replaced the window felts' can live today (read)

**What exists.** Six live shapes plus legacy ones. (a) `receipt_items.description` on a `receipts` row linked to the car by `receipt_vehicle_links`. (b) `vehicle_observations` kind work_record: owner/shop build-log rows (item, category, supplier, labor_minutes), agent API `service` / `modification` events (zones_touched, parts[] with status installed, work_performed[], photos_referenced), `visual_work_v1` reviews, `audit_draft_v0` ledger rows. (c) `vehicle_observations` kind activity, method retained_listing_reported_work_v1: one sentence from a BaT description ('The X was replaced in Month YYYY'). (d) `timeline_events` (event_type repair, maintenance, modification, work_completed, service, parts_received) with `event_parts_used`. (e) the job: `work_orders` + `work_order_line_items` (operations) + `work_order_parts` + `component_events`. (f) `vehicle_change_claims` kind part_installed / part_removed / interior / body / repair / work_performed. Also `work_sessions` (one row per vehicle and day of photos, the 'work ledger' in the capability map), and legacy `component_installations`, `component_lifecycles`, `vehicle_builds` / `build_line_items`, `service_records`, `vehicle_modifications`, `image_work_extractions`.

**Writer.** ingest-observation, api-v1-events, receipt extraction, extract-bat-core, work-order Sign functions, derive_work_sessions

**Reader.** vehicle_build_log_public, get_vehicle_build_ledger, work_order_* readers

**Where.** supabase/migrations/20261027000000_receipt_vehicle_links.sql:1-36; supabase/migrations/20261109235000_visual_work_build_log_reader.sql:139-173; supabase/functions/api-v1-events/index.ts:69-75; docs/library/reference/dictionary/service.md:1-13; supabase/migrations/20261015052316_retained_reported_work.sql:1-6,61-97; supabase/migrations/20261006233000_describe_timeline_events.sql:37-38,57-58; docs/ledger/CAPABILITY_MAP.md:145-146; supabase/migrations/20261021220000_image_evidence_tables.sql:362-399; supabase/migrations/20261008044000_describe_work_sessions.sql:56-57; docs/library/technical/work-order-intelligence.md:22-31

**Gap.** In every one of them the part is free text; none carries a component key, so 'window felts' is a string match. Six stores compete for 'a piece of work on a car'; the work-order doc itself says a receipt, an invoice and a work order 'can be several witnesses to one economic item' and must be reconciled before counting. `work_sessions.zones_touched / stages_observed / stage_transitions` are empty on every row per the 2026-10-07 table comment (their only writer was deleted).

### 3b. Receipt line -> photo -> judgment (the newest work-evidence path) (read)

**What exists.** `receipt_work_lines(vehicle)` takes every linked receipt line, reads what it is (`receipt_line_kind`: part, labor, charge ...) and which zone a photo of it would show (`receipt_line_photo_zone`), and matches gate-approved photos of that zone taken on or after the line's date within a window; it returns one proposed conclusion per line (install_window_photographed, photographed_after_window, no_zone_photo_after_purchase, part_zone_unknown ...) with the cited image ids, work_session ids and timeline_event ids. A producer script signs each conclusion into `garage_derivation_evidence` (kind receipt_work_correlation, subject_key receipt_item:<id>, image_ids) and raises a question in `evidence_judgment_requests` (question_kind receipt_part_visible) whose answer shape is fixed: visible yes/no/cannot_tell, installed yes/no/cannot_tell, confidence, image_id from the candidates, bbox. `get_vehicle_receipt_work_context` and `get_vehicle_day_documents` (per-line install status) are the readers. The owner's stated rule for this is in the migration header: 'the cost of labor doesnt land until the proof of install lands'.

**Writer.** scripts/receipt-work/reconcile-receipt-work.mjs via PostgREST (service role); answer_evidence_judgment

**Reader.** get_vehicle_receipt_work_context, get_vehicle_day_documents; frontend ReceiptWorkContext.tsx, VehicleDayDrawer.tsx

**Where.** supabase/migrations/20261111210500_receipt_work_reconciliation.sql:32-71,154-294,337-360,617-648; scripts/receipt-work/reconcile-receipt-work.mjs:66; supabase/migrations/20261111195000_garage_derivation_evidence.sql:30-66; supabase/migrations/20261113090000_receipt_work_context_reader.sql:1-26,187-191; supabase/migrations/20261111090000_day_documents_vendor_page_install.sql:1-21

**Gap.** Per vehicle only; `receipt_work_lines` is service-role only and the context reader needs a signed-in viewer of that vehicle. Line 55 of the zone reader returns no zone for weatherstrip ('a photo would not show them') and no pattern matches 'felt', so a window-felt line concludes part_zone_unknown and no judgment is raised (a judgment is raised only for the two photographed conclusions, line 269). Zone matching is frame-level and six zones wide: 'exterior' cannot tell a door from a bumper. The file names carry dates after today (2026-11-11 to 2026-11-13); whether they are applied is not known from the repo.

### 3c. Visual work record (before / during / after photos) (read)

**What exists.** A `vehicle_observations` row of kind work_record, source internal-inference, extraction_method visual_work_v1, confidence capped at 0.6, whose structured_data holds title, summary, `visual_sources` (1 to 12 entries: image_id, role before | during | after, caption, source_url), `receipt_links` (receipt_id, item_id, link_id, relation candidate_material | documented_operation), `gaps`, and an optional `effort_reference` into `stage_transition_labor_map`. The reader `visual_work_build_log` re-checks every cited image (same vehicle, still eligible, before not later than after), requires the derived `observation_witnesses` row, re-checks each receipt line exactly, and is appended to `vehicle_build_log_public(vehicle, true)`. The frontend hook `useVisualWork` calls it.

**Writer.** none in repo (contract says intake is ingest-observation, internal-inference, agent_inferred)

**Reader.** visual_work_build_log -> vehicle_build_log_public(uuid, boolean) -> useVisualWork.ts

**Where.** supabase/migrations/20261110053000_visual_work_receipt_text.sql:16,40-50,75-78,111,127-128; supabase/migrations/20261109235000_visual_work_build_log_reader.sql:1-3,136-138,175-205; nuke_frontend/src/pages/vehicle-profile/hooks/useVisualWork.ts:22-28; supabase/sql/fixtures/visual_work_owners_20261109.sql:1-14

**Gap.** No producer in the repo writes a visual_work_v1 row (only the reader migrations and their tests name the contract). The record has no component key and no pointer to the condition observation the work fixed; it is read one vehicle at a time. The reader states what it does not assert: 'No installation, payment, performer or measured-time promotion'.

### 3d. Reported work read from listing text (read)

**What exists.** `retained_reported_work_witnesses` (v1: closed lists of parts such as tires, battery, instrument cluster) and `_v2` (one passive clause 'The <object> was|were <verb> in <Month YYYY>.' with an open object phrase) turn a stored BaT description sentence into an `activity` observation carrying source_value (the sentence), performed_clause, reported_date at month precision and the parent listing observation id. `vehicle_build_log_public(vehicle, true)` returns them as reported_work. The header says: publisher-reported, 'never confirmed work_record/work_sessions', 'No actual-occurrence, performer, intent, cost, labor or part-identity inference'.

**Writer.** ingest-observation retained reported-work mode

**Reader.** vehicle_build_log_public(uuid, true)

**Where.** supabase/migrations/20261015052316_retained_reported_work.sql:1-6,61-99; supabase/migrations/20261018120500_retained_reported_work_v2.sql:1-7; supabase/migrations/20261109235000_visual_work_build_log_reader.sql:180-204

**Gap.** The first migration is marked 'HELD: complete local release preparation; no production authorization'; whether it deployed is not known from the repo. One source (BaT), month-dated sentences only, no photo link, no part key. A sentence such as 'window felts were replaced during the restoration' with no month does not match either pattern.

### 3e. Restoration as an episode (read)

**What exists.** No table or kind represents a restoration as one thing with a start, an end and member work. What can stand in: `work_orders` (a job header with operations, parts, evidence and Signs), `vehicle_change_claims` rows with an occurred_from / occurred_to window, `work_sessions` (days), `vehicle_builds` (2025 'Frame-off Restoration' project table with phases and line items), `component_lifecycles` (per vehicle and component: current_state original .. installed, state_history JSON with image ids and labor), `vehicle_images.fabrication_stage` and the verdict's build_phase_guess per photo, `timeline_events`. The case ledger records the owner's view: 'Restoration is a spectrum of interventions' and 'repair' names a cohort of connected data (parts, labor, actions, participants, documents, payments, condition evidence).

**Where.** docs/ledger/theory/data-machine-cases.md:819-834; docs/ledger/theory/data-machine.md:374-376; supabase/migrations/20250929000001_vehicle_build_management.sql:21-34; supabase/migrations/20251206_component_lifecycle_tracking.sql:16-62; supabase/migrations/20261006230000_describe_vehicle_images.sql:319-320; docs/library/technical/work-order-intelligence.md:3-31

**Gap.** 'During a restoration' cannot be tested: a piece of work has no parent episode. Membership today would have to be inferred from the same vehicle and nearby dates. The smallest existing parent is the `work_orders` header (it already owns operations, parts and evidence images) or a `vehicle_change_claims` row of kind work_performed with a date window; neither is linked to receipts lines or visual-work rows by a key.

### 4a. Condition and imperfection: the stores (read)

**What exists.** Current writer: the reviewed deep image verdict lands as `vehicle_observations` kind condition (source photo_pipeline, structured_data.analysis_kind image_deep_byok) holding state_observations (rust_severity, paint_state, completeness, damage_callouts[]), `damage_localized[]` (label, bbox on a 0-999 grid, severity surface | pitting | perforation), components_seen[]; three of its fields are also projected as registry properties. Text claims: kind condition with `descriptor_id` (C26). Agent API: `inspection` findings[] (system, finding, severity info | monitor | concern | critical, evidence_photo_ref). Older or idle stores: `surface_observations` (per image flag rust / paint_fade at the image's zone; last write 2026-05-01 per its comment), `image_condition_observations` and `vehicle_condition_scores` (YONO 'condition spectrometer'; no CREATE in repo), `vehicle_condition_assessments` + `component_conditions` + `paint_quality_assessments` (2025 appraisal tables), `image_tags` (a point on an image with tag text; idle), `component_identifications.condition_notes`, `vehicle_images.damage_flags` / condition_score / damage_type (unused), `projection_event` atoms for the checklist attribute `vehicle.condition_cues` (kind dent | crease | rust_perforation | torn_upholstery | recent_repair_evidence ..., severity, bbox, panel), digital-twin condition_grade / rust_grade columns, `shadow_image_condition_scores`, `vehicle_running_condition`, `vin_plate_conditions`.

**Writer.** photo-pipeline-orchestrator record_reviewed_analysis -> ingest-observation; api-v1-events; idle YONO writers

**Reader.** get_image_deep_analysis, get_field_provenance, listing_work_plan_read, nlq-sql

**Where.** supabase/functions/photo-pipeline-orchestrator/reviewedAnalysis.ts:14,31-34,49,108,120; scripts/daily-receipt/byok-vision-prompt.md:36; scripts/lib/image-property-projection.mjs:5-7; supabase/migrations/20261001140000_c26_condition_claims_notation.sql:59-71; docs/library/reference/dictionary/inspection.md:1-13; supabase/migrations/20261007232000_surface_observations_comment_after_door_fix.sql:28-29; supabase/functions/nlq-sql/index.ts:17-23,141-157; supabase/migrations/20251122_professional_appraisal_tables.sql:6-76; supabase/migrations/20261007180000_describe_image_tags.sql:39-40; supabase/migrations/20261006230000_describe_vehicle_images.sql:124-125,240-243; supabase/functions/_shared/cockpit/attribute-registry.ts:526-543; supabase/migrations/20261026210100_shadow_image_condition_scores.sql:1-18; supabase/migrations/20261028120200_running_condition.sql:1-19

**Gap.** More than ten tables compete for 'a defect seen on this car'. Severity is five different scales (0-1, three words, four words, 1-10, 0-100). The defect kind in the live path (`damage_localized.label`, damage_callouts) is free text. The surface_observations comment says every stored box is the whole frame and severity grades the whole image, 'not the flagged surface'.

### 4b. Condition vocabulary: two registries (read)

**What exists.** `condition_taxonomy` (canonical_key in dot notation such as exterior.metal.oxidation, domain, descriptor_type, severity_scale, taxonomy_version) is keyed by `vehicle_observations.descriptor_id`, `surface_observations.descriptor_id`, `image_condition_observations.descriptor_id` and `condition_knowledge.descriptor_id`; `ingest-observation` resolves a `descriptor_key` and refuses unknown keys. `observation_properties` (property_key, data_type, category, applies_to_kinds, cardinality, discriminator_key, verification_scope) holds three image-scoped condition properties (image_visible_rust_severity, image_visible_paint_stage, image_visible_assembly_state, discriminator image_id) and grows only through `schema_proposals`. A third list is the code constant in attribute-registry.ts; a fourth is the 21-entry `listing_plan_keyword_table` (dent, rust_body, paint_refinish, seat_upholstery ...).

**Writer.** migrations and fn_schema_proposal_apply (properties); migration and scripts/expand-condition-taxonomy.py (taxonomy)

**Reader.** ingest-observation validation; nlq-sql; get_field_provenance(vehicle, property_key)

**Where.** supabase/migrations/20261001140000_c26_condition_claims_notation.sql:1-71; supabase/functions/ingest-observation/index.ts:118-127,961-987; supabase/migrations/20261003001412_cached_image_property_keys.sql:1-24; supabase/migrations/20261011223810_schema_proposal_retry_and_progress.sql:173-190; supabase/migrations/20261019191500_listing_work_plan_read.sql:25-26,241-245; docs/ledger/theory/data-machine-cases.md:806

**Gap.** The taxonomy and the property registry are separate vocabularies for the same domain (the property migration says its rows are 'not whole-vehicle condition grades or taxonomy aliases'). The C26 header says about half the taxonomy rows are fragments parsed from service manuals. `condition_taxonomy` has no CREATE TABLE in the repo. The deep verdict's damage labels are keyed to neither.

### 4c. 'A specific imperfection': location and identity (read)

**What exists.** Where a defect is can be said five ways: a box in one photo (`damage_localized[].bbox`, `component_identifications.bounding_box`, `image_tags` x/y, judgment answer bbox, `image_observations.bbox`); the photo's zone; a descriptor key's area segment; a point on the body (`vehicle_observations.anchor_x/y/z_mm` + anchor_extent_mm + condition_rating_0_100 in a `vehicle_coordinate_frames` frame, indexed for 'time-lapse at a coordinate'); a digital-twin row (the left quarter panel of this car as one `body_panels` row with rust_grade, filler_detected_yn, is_original).

**Where.** supabase/migrations/20260702051500_xyz_spatial_anchors.sql:1-84; supabase/migrations/20261007003000_describe_vehicle_observations.sql:140-146; docs/library/reference/dictionary/tables.md:8263-8282; supabase/migrations/20261008020000_describe_component_identifications.sql:52-53

**Gap.** No row is 'this dent': each sighting is its own observation, and nothing links two sightings of the same flaw in two photos or two years. The only shapes that give a place on the car a stable identity are the xyz anchor (its column comment says it is filled on a handful of rows of one vehicle, written by code not in the repo) and a digital-twin row id (tables described as empty). Smallest existing thing an instance identity would extend: the anchor columns already on `vehicle_observations`, or `vehicle_observations.source_observation_id` (already used to tie a derived claim to its parent).

### 5a. Change over time: the change-claim store (read)

**What exists.** `vehicle_change_claims`: claim_domain physical | custody | money | record; kind includes part_installed, part_removed, paint, body, interior, repair, detail, inspection, work_performed; occurred_from / occurred_to; party_entity; asserted_value JSON; summary; confidence; supersession columns. `vehicle_change_claim_support`: claim_id, evidence_kind (image_candidate, evidence_link, capture_time_claim, vehicle_image, work_session, change_claim), evidence_id, stance supports | contradicts, about (date, amount, party, vehicle, identity, condition, other), weight. `evidence_decisions.target_kind` includes change_claim. Guards: insert only through a named writer called as a top-level API call; append-only; owner-only read policy.

**Writer.** propose_change_claim / propose_claim_support (not in repo)

**Reader.** none in repo

**Where.** supabase/migrations/20261021220000_image_evidence_tables.sql:78-88,350-421,455-486,634-650; docs/ledger/CAPABILITY_MAP.md:131; AGENTS.md:136; .claude/rules/db-safety.md:64

**Gap.** The writers `propose_change_claim` and `propose_claim_support` and every reader (`get_vehicle_day_records`) are named but defined nowhere in the repo: migration 20261021221000 is absent (the migration list goes from 20261021220000 to 20261021230000). The store has no public policy ('no vehicle-public policy'), so even filled it answers only the owner about his own rows. A support row can cite a photo or a work session but not a `vehicle_observations` row, so a repair claim cannot point at the condition observation it resolves. The claim has no component key (summary text and asserted_value JSON).

### 5b. Other before/after holders (read)

**What exists.** `visual_work_v1` roles before / during / after (3c). `set_vehicle_build_image(vehicle, image, role)`: the owner names one before_image and one after_image for the whole vehicle, stored as a `vehicle_observations` media row and superseded on change. Checklist attributes `cluster.work_transition` (state_before, state_after, change_type, zones_changed[], evidence_image_ids[] between two consecutive work sessions) and `vehicle.refinish_event` (from_color, to_color, citing a before/after pair or an invoice), stored as `projection_event` rows. `component_lifecycles.state_history`. `component_events` event_type repaired / replaced on a component row. `stage_transition_labor_map` (from_stage, to_stage, zone_pattern -> hours). `surface_observations.lifecycle_state` allows 'restored'. `vehicle_images.workflow_role` (before, after, issue, during).

**Writer.** set_vehicle_build_image (owner session); mcp-connector submit_attribute_value

**Reader.** query_subject_atoms (mcp-connector); vehicle profile

**Where.** supabase/migrations/20260618100000_set_vehicle_build_image_role.sql:1-30; supabase/functions/_shared/cockpit/attribute-registry.ts:590-603,870-905; supabase/migrations/20261006073000_table_purpose_live_tables.sql:157-158; supabase/migrations/20260227290000_labor_estimation_pipeline.sql:44-61; supabase/migrations/20261007222000_describe_surface_observations.sql (lifecycle_state comment: 'restored and palimpsest cannot be produced'); supabase/migrations/20261006230000_describe_vehicle_images.sql:118-119

**Gap.** Seven shapes hold a before/after pair and none of them is keyed to a defect or a component. `vehicle_images.workflow_role` is described as unused with no writer; 'restored' is a lifecycle value no writer can produce. Supersession (is_superseded / superseded_by on observations) exists but means a corrected reading, not a physical change.

### 6. Photographic proof: how a row cites its images (read)

**What exists.** `observation_witnesses` is the typed bridge: one row per observation x image x role (primary, context, supersession, derived), written atomically by a trigger whenever an inserted observation carries structured_data.image_id, refusing a missing image or a different vehicle. Its comment states the limit: 'provenance, not calibrated proof or independent-source count'. Other citations: `vehicle_change_claim_support` (evidence_kind vehicle_image), visual_work `visual_sources[]`, `garage_derivation_evidence.image_ids uuid[]`, judgment answer image_id + bbox, `component_identifications.image_id`, `part_observation_evidence.derived_from_image_id`, `scene_micro_atom_evidence.derived_from_image_id`, `surface_observations.vehicle_image_id`, `component_conditions.image_id`, `vehicle_condition_assessments.images_assessed uuid[]`, `vehicle_evidence_items.proof_kind / proof_ref` (a status other than open requires a proof), `work_order_evidence_images`, `component_installations.verification_photos text[]`, `timeline_event_proofs.document_url`.

**Writer.** project_observation_image_witness trigger on vehicle_observations insert

**Reader.** get_field_provenance; visual_work_build_log

**Where.** supabase/migrations/20261002213353_enforce_atomic_image_witnesses.sql:1-28; supabase/sql/fixtures/visual_work_owners_20261109.sql:15-62; supabase/migrations/20261021220000_image_evidence_tables.sql:405-419; supabase/migrations/20261111195000_garage_derivation_evidence.sql:30-45; supabase/migrations/20261105120000_contributor_intake_ladder.sql:50-68; supabase/migrations/20261003200000_declare_keys_scene_atoms_claims_coverage_tiers.sql:60-70

**Gap.** A reader can go from a fact to its photos only inside one vehicle: `get_field_provenance(vehicle, field)`, `visual_work_build_log`, `get_vehicle_receipt_work_context`. The witness role vocabulary has no 'before' / 'after' / 'shows the defect' / 'shows the repair'; the automatic projection writes only 'derived' and 'does not infer that an image supports or proves the claimed value'. Image citations in JSON arrays and uuid[] columns have no foreign key.

### 7a. Readers: search used by the site (read)

**What exists.** `universal-search` (edge function, the canonical search backend) runs vehicle filters, `search_vehicles_fts`, `search_vehicles_fuzzy`, an ilike over `image_tags.tag_name` for tag results, and `search_vehicles_deep`, a full-text match over `vehicle_search_index` (vehicle_text, description_text, comment_text, evidence_text) returning match_source and a highlighted snippet. `search_vehicles_browse` filters by make, model, year, price, status, source, era, body style, image and color. `search_timeline_events_fulltext` exists. mcp-connector exposes `search_vehicles_advanced` (text + make/model/year), `query_observations` (one vehicle, filter by kind), `query_subject_atoms`.

**Writer.** unknown for vehicle_search_index (not in repo)

**Reader.** universal-search, mcp-connector

**Where.** docs/ledger/CAPABILITY_MAP.md:54; supabase/functions/universal-search/index.ts:563,869,910,985; supabase/migrations/20261015003000_search_deep_text_for_page_only.sql:29-110; supabase/migrations/20261021002000_search_vehicles_browse_deleted_rows_and_sale_basis.sql:42-51,136-137; supabase/functions/mcp-connector/index.ts:315-334,442-459,789-803

**Gap.** No search function takes a component, a kind of work or a condition as a filter. The only way to reach 'felts replaced' across vehicles today is the full-text snippet, which returns a sentence, not a typed fact, and no photo. `vehicle_search_index` has no CREATE or refresh definition in the repo, so what feeds evidence_text is not knowable here.

### 7b. Readers: per-vehicle work, part and condition readers (read)

**What exists.** `vehicle_build_log_public(vehicle)` and `(vehicle, true)` (work records + reported work + visual work); `get_vehicle_build_ledger`; `get_vehicle_receipt_work_context`; `get_vehicle_day_documents`; `get_image_component_targets(image)` (every identified component of one image as a tappable target with box, status and receipt evidence); `get_vehicle_parts_ledger(vehicle)` (part numbers seen in deep verdicts joined to `catalog_parts`); `read_work_order_image_objects(work_order)`; `listing_work_plan_read` (listing claims and image-derived `damage_localized` as defect_or_condition -> candidate operations); `get_image_deep_analysis(image)`; `vehicle_surface_coverage` view; `nlq-sql` (admin natural-language-to-SQL over surface_observations, image_condition_observations, condition_taxonomy, vehicle_condition_scores); `scripts/discovery/buying-evidence.mjs` (lexical finder for 1 to 10 named vehicles).

**Reader.** vehicle profile pages (TablePage, LifecyclePage, VehicleDayDrawer, ReceiptWorkContext), admin NLQueryConsole

**Where.** supabase/migrations/20261109235000_visual_work_build_log_reader.sql:139-205; supabase/migrations/20260708130000_get_vehicle_build_ledger.sql:19-40; supabase/migrations/20260702061000_get_image_component_targets.sql:1-24; supabase/migrations/20260617100000_vehicle_parts_ledger.sql:8-41; supabase/migrations/20261019031934_work_order_image_objects.sql:22-37; supabase/migrations/20261019191500_listing_work_plan_read.sql:241-245; supabase/migrations/20261109213000_reviewed_image_analysis.sql:413-432; supabase/functions/nlq-sql/index.ts:141-189; docs/ledger/CAPABILITY_MAP.md:45

**Gap.** Every one takes a vehicle id, an image id or a work order id. The only cross-vehicle readers over condition are the admin `nlq-sql` console (over the idle YONO tables, by zone and flag) and hand-written SQL. `get_image_component_targets` has no caller in the repo per its table comment.

### 8. The 'mirror' as it is written in the repo (read)

**What exists.** The idea that the model is the form the agent fills is stated in the dictionary ('Schema ... The schema IS the prompt'; 'The LLM fills the mold -- it doesn't invent the mold') and built four times: (1) digital-twin DDL + column comments fed as the prompt by `fill-vehicle-form.mjs`, landing in per-component tables and `field_evidence`; (2) `attribute-registry.ts`, a checklist of attributes per subject (image, vehicle, cluster ...) with prompt, expected shape and admissible evidence classes, served by `get_attribute_checklist` and landing in `projection_event`; grows through `propose_attribute` -> `schema_proposals`; (3) `observation_properties`, the database registry that `ingest-observation` validates `property_key` against, landing in `vehicle_observations`; (4) the agent write API JSON schemas (service, modification, inspection, condition_assessment) with `get_event_checklist`, landing in `vehicle_observations.structured_data`. A fifth is the deep image verdict schema in the vision prompt file, validated by `reviewedAnalysis.ts`.

**Where.** docs/library/reference/dictionary/README.md:129,324; scripts/fill-vehicle-form.mjs:1-13; supabase/functions/_shared/cockpit/attribute-registry.ts:1-26,30-60; supabase/functions/mcp-connector/index.ts:644-650,856-861; supabase/migrations/20261003001412_cached_image_property_keys.sql:1-24; docs/api/schemas/v1/service.json; scripts/deep-image-analysis-byok.mjs:17-45

**Gap.** Five blueprints, five landing places, no shared key between them. The restoration theory card states the opposite rule for work: labels are 'query-time projections of stored evidence, never baked as schema categoricals', and the photos card calls an empty categorical table 'the scar from baking a categorical into schema'; the digital-twin tables and the registries do bake them. Which of these is the owner's blueprint is not decided anywhere in the repo.

### 9. Repo versus production limits of this map (inferred)

**What exists.** Several load-bearing tables have no CREATE TABLE in supabase/migrations and are known only from later COMMENT ON migrations or code: vehicle_observations, observation_witnesses, observation_properties, condition_taxonomy, surface_observations, image_condition_observations, vehicle_condition_scores, image_observations, component_events and the digital-twin tables, vehicle_search_index, projection_event, schema_proposals. Dated measurements inside column comments (2026-10-06 to 2026-10-19) describe liveness then, not now. Migration files dated 2026-11-11 to 2026-11-13 exist in the repo although today is 2026-11-10.

**Where.** supabase/migrations/20261007222000_describe_surface_observations.sql:1-30; supabase/migrations/20261002213353_enforce_atomic_image_witnesses.sql:1-8; supabase/migrations/20261014191500_service_role_catalog_policies.sql:1-10; supabase/migrations/20261113090000_receipt_work_context_reader.sql:1; .claude/rules/production-engineering.md (law 1)

**Gap.** Column lists for those tables in this map come from comments, readers and writers, not from a definition. Whether the evidence-store writers, the held reported-work migration and the future-dated receipt-work migrations are live cannot be settled from the repo.

## To read from production

- supabase_migrations.schema_migrations: is version 20261021221000 (evidence writers) applied, and which of 20261111090000 .. 20261113140000 are applied; to_regprocedure for propose_change_claim, propose_claim_support, get_vehicle_day_records, visual_work_build_log(uuid), receipt_work_lines(uuid,int,int), get_vehicle_receipt_work_context(uuid,date)
- vehicle_change_claims: count of current rows (superseded_by IS NULL) by kind and claim_domain; vehicle_change_claim_support: count by evidence_kind, stance, about
- vehicle_observations where kind = 'work_record' and extraction_method = 'visual_work_v1': count of current rows and distinct vehicles (is there any row at all)
- vehicle_observations where kind = 'activity' and extraction_method = 'retained_listing_reported_work_v1': count, distinct vehicles, and how many performed_clause values match 'felt|weatherstrip'
- vehicle_observations where kind = 'condition' and structured_data->>'analysis_kind' = 'image_deep_byok' (bounded by a vehicle set or index): count of current rows, distinct vehicles, share with a non-empty damage_localized array, distinct damage_localized labels, share with an observation_witnesses row
- vehicle_observations: count where descriptor_id IS NOT NULL grouped by condition_taxonomy.canonical_key; count where property_id is one of the image_visible_* properties; count where anchor_frame_id IS NOT NULL and distinct vehicles
- condition_taxonomy: count by taxonomy_version and deprecated state; observation_properties: every property_key with category, applies_to_kinds, ratified_at (to see which condition or work keys exist beyond the three image ones)
- receipt_items joined to active linked receipt_vehicle_links: count of lines whose description matches 'felt|sweep|weatherstrip', distinct vehicles, and the make/model of those vehicles
- garage_derivation_evidence where kind = 'receipt_work_correlation' and superseded_at IS NULL: count by conclusion; evidence_judgment_requests where question_kind = 'receipt_part_visible': count by status and by answer->>'installed'
- v_schema_atlas rows (activity, rows, last write, writers, readers) for: component_events, body_weatherstripping, body_panels, body_glass, door_panels, seats, paint_systems, component_definitions, component_identifications, component_lifecycles, component_installations, component_conditions, vehicle_condition_assessments, surface_observations, image_condition_observations, vehicle_condition_scores, image_tags, part_observation_evidence, scene_micro_atom_evidence, vehicle_builds, vfc_builds, work_orders, work_order_line_items, work_order_parts, work_sessions
- component_events: count by component_table and event_type; count with work_order_id set; count with non-empty evidence_ids
- component_identifications: count by status, distinct component_type values, share with bounding_box, newest created_at, share with component_definition_id set
- projection_event: count of non-retracted rows by attribute for vehicle.condition_cues, vehicle.refinish_event, cluster.work_transition, image.in_progress_work, vehicle.modifications
- image_observations: count of active rows by role and observed_by; image_vehicle_candidates and evidence_decisions: count of rows (is the store still empty)
- vehicle_search_index: column list, what populates evidence_text and comment_text, its refresh job in v_job_health and last refresh time
- vehicle_images restricted to rows with a user_id (owner photos): share with vehicle_zone, with non-empty damage_flags, with components, with ai_scan_metadata ? 'byok_deep_analysis'; distinct fabrication_stage values
- Denominators for the two example makes: count of public, undeleted vehicles where make is Ford and model matches Mustang, and where make is Porsche; of those, how many have at least one image with a deep verdict (image_coverage_by_vehicle.seen_t1 > 0) and how many have any linked receipt
- Live body of receipt_line_photo_zone(text) (confirm weatherstrip still returns NULL) and of get_image_component_targets(uuid); pg_stat_user_functions call counts for search_vehicles_deep, vehicle_build_log_public, get_vehicle_receipt_work_context, get_image_component_targets

## Open questions

- Which key names a part of a car? The repo offers three unfinished candidates (digital-twin table + position as used by component_events; component_definitions; the area segment of condition_taxonomy keys) and a dozen free-text holders; only the owner can pick, and four parts catalogs are still unconsolidated.
- Is a restoration an entity (an episode that work rows belong to) or a window read off dated work? The case ledger says restoration is 'a spectrum of interventions' and that 'repair' names a cohort; no table makes either one a parent of work.
- Does an imperfection need its own identity across photos and years (one row that many sightings cite), or is it a reading at a point on the body (the 2026-05-24 xyz anchor design: condition as a field over the body envelope)? Both shapes are started; neither is in use beyond a few rows per the dated comments.
- The restoration theory card says work labels are query-time projections 'never baked as schema categoricals'; the digital-twin tables, the registries and the owner's 2026-11-10 words (the model as blueprint) point the other way. Which rule is current?
- Where are the evidence-store writers and readers (M1w 20261021221000, M1p)? They are cited in AGENTS.md, db-safety.md and the capability map as the sanctioned path and exist in no migration in this checkout.
- The evidence store and the receipt-work evidence are owner-private by policy. Q1-Q3 read like public, cross-vehicle search ('Mustangs', 'a Porsche'). Is the intended population the public listing fleet (where proof is listing photos and listing text) or owners' own libraries (where receipts and dated work photos exist)? The stores for the two populations are different today.
- Five blueprints exist for 'the form the agent fills' (digital-twin DDL, attribute-registry.ts, observation_properties, agent API schemas, the deep-verdict prompt). Is one of them the mirror, with the others retired or folded in? Deleting or retiring any of them is the owner's call.
- The digital-twin tables are mutable current-state rows with no source or clock, while the invariants require append-only sourced testimony. Are they meant to be the mirror's visible shape (a fold computed from observations) or a place agents write directly?
- Migration files dated 2026-11-11 to 2026-11-13 are in the repo on 2026-11-10. Are those dates sequencing only, and are they applied?
- retained_reported_work is marked HELD with no production authorization in its own header while later migrations (visual work reader) pin its functions by hash as if present. Did it deploy?
