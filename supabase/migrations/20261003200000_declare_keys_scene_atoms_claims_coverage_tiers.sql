-- Declare six keys the data already honors, and describe the four tables they sit on.
-- Discovery pass 2026-10-03 (inclusion test on samples, then exact anti-join on the full table):
--   scene_micro_atom_evidence.vehicle_id            94,709 rows, 0 orphans
--   scene_micro_atom_evidence.derived_from_image_id 94,709 rows, 0 orphans
--   comment_claims_progress.vehicle_id              22,285 rows, 0 orphans
--   comment_claims_progress.comment_id              first 5,000 rows, 0 orphans (validated in a later migration)
--   image_coverage_by_vehicle.vehicle_id            40,709 rows, 0 orphans (already the primary key)
--   existence_tier_staging.vehicle_id               2% block sample 17,405 rows, 0 orphans (exact check at validation)
-- NOT VALID: new rows are checked now; existing rows are validated in separate migrations.
-- Not declared: enrichment_log.vehicle_id has 561 of 34,906 rows pointing at no vehicle.
-- Recomputable tables (staging, coverage cache) cascade on parent delete; testimony-side atoms and the
-- claims log do not (NO ACTION), so deleting a parent can never silently delete its history.
set lock_timeout = '5s';

alter table public.existence_tier_staging
  add constraint existence_tier_staging_vehicle_id_fkey
  foreign key (vehicle_id) references public.vehicles(id) on delete cascade not valid;
alter table public.image_coverage_by_vehicle
  add constraint image_coverage_by_vehicle_vehicle_id_fkey
  foreign key (vehicle_id) references public.vehicles(id) on delete cascade not valid;
alter table public.scene_micro_atom_evidence
  add constraint scene_micro_atom_evidence_vehicle_id_fkey
  foreign key (vehicle_id) references public.vehicles(id) not valid;
alter table public.scene_micro_atom_evidence
  add constraint scene_micro_atom_evidence_derived_from_image_id_fkey
  foreign key (derived_from_image_id) references public.vehicle_images(id) not valid;
alter table public.comment_claims_progress
  add constraint comment_claims_progress_vehicle_id_fkey
  foreign key (vehicle_id) references public.vehicles(id) not valid;
alter table public.comment_claims_progress
  add constraint comment_claims_progress_comment_id_fkey
  foreign key (comment_id) references public.auction_comments(id) not valid;

-- existence_tier_staging: grain one row per vehicle; recomputable operational classification.
comment on column public.existence_tier_staging.vehicle_id is 'The vehicle classified. One row per vehicle. FK to vehicles.id.';
comment on column public.existence_tier_staging.tier is 'Render-worthiness tier computed by scripts/backfill-existence-tier.sh: dead = deleted or merged vehicle; a = human-linked or dense substrate (4+ images plus events or observations plus year/make/model); b = live with a sale price and year/make (comp stub); c = remaining live archive rows. Definitions: migration 20260611040200.';
comment on column public.existence_tier_staging.computed_at is 'When the tier was computed (UTC). Event time and ingest time are the same: it is a computation, not a source event.';

-- image_coverage_by_vehicle: grain one row per vehicle; refreshed by refresh_image_coverage(), computed by get_vehicle_analysis_coverage().
comment on column public.image_coverage_by_vehicle.vehicle_id is 'The vehicle covered. Primary key and FK to vehicles.id.';
comment on column public.image_coverage_by_vehicle.photos is 'Count of the vehicle''s own (is_external = false) images that are not duplicates and not superseded.';
comment on column public.image_coverage_by_vehicle.gated_t0 is 'Tier 0: images with vision_gate_status = approved.';
comment on column public.image_coverage_by_vehicle.seen_t1 is 'Tier 1: images whose ai_scan_metadata has a byok_deep_analysis verdict.';
comment on column public.image_coverage_by_vehicle.placed_t2 is 'Tier 2: images with an active image_observations row.';
comment on column public.image_coverage_by_vehicle.with_clip is 'Images whose active image_observations row carries a CLIP embedding (embedding_clip_vitb32).';
comment on column public.image_coverage_by_vehicle.connected_t3 is 'Tier 3: reserved; always 0 until Phase 5 is wired.';
comment on column public.image_coverage_by_vehicle.confirmed_t4 is 'Tier 4: images taken on a day with an owner-confirmed work session (work_sessions.owner_confirmed_at).';
comment on column public.image_coverage_by_vehicle.cascade_atoms is 'Reserved; always 0 until Phase 5 is wired.';
comment on column public.image_coverage_by_vehicle.stale_rehash is 'Images that have a verdict (tier 1) and are flagged stale, i.e. due for re-analysis.';
comment on column public.image_coverage_by_vehicle.inflow_7d is 'Images taken or created in the 7 days before refreshed_at.';
comment on column public.image_coverage_by_vehicle.seen_7d is 'Of inflow_7d, images that already have a verdict.';
comment on column public.image_coverage_by_vehicle.depth_score_avg is 'Mean nuke_image_depth_score across the vehicle''s counted images.';
comment on column public.image_coverage_by_vehicle.pct_deep is 'Share of tier-0 images that also have a verdict (tier 1). Null when there are no tier-0 images.';
comment on column public.image_coverage_by_vehicle.pct_engine is 'Share of tier-0 images that also have an active observation (tier 2). Null when there are no tier-0 images.';
comment on column public.image_coverage_by_vehicle.refreshed_at is 'When refresh_image_coverage last computed this row (UTC). Ingest time; the counts describe the vehicle as of then.';
comment on column public.image_coverage_by_vehicle.documented_floor_usd is 'Documented cost floor for the vehicle in USD (labor plus parts), when computed.';
comment on column public.image_coverage_by_vehicle.floor_labor_usd is 'Labor part of documented_floor_usd, USD.';
comment on column public.image_coverage_by_vehicle.floor_parts_usd is 'Parts part of documented_floor_usd, USD.';
comment on column public.image_coverage_by_vehicle.floor_computed_at is 'When the documented floor was computed (UTC).';

-- scene_micro_atom_evidence: grain one atom per image per atom_type; presence testimony promoted from byok_deep_analysis.
comment on column public.scene_micro_atom_evidence.id is 'Row id.';
comment on column public.scene_micro_atom_evidence.vehicle_id is 'The vehicle the image was attributed to. FK to vehicles.id.';
comment on column public.scene_micro_atom_evidence.derived_from_image_id is 'The image the atom was read from. FK to vehicle_images.id.';
comment on column public.scene_micro_atom_evidence.observed_at is 'Event time: when the image was taken (the moment the atom describes), not when we read it.';
comment on column public.scene_micro_atom_evidence.atom_type is 'What kind of atom: e.g. lighting, scene_type, build_phase, workshop signals, presence.';
comment on column public.scene_micro_atom_evidence.atom_value is 'The atom''s value as text, e.g. fluorescent_shop for lighting. Presence atoms are THAT someone is present, not WHO.';
comment on column public.scene_micro_atom_evidence.confidence is 'Reader confidence in the atom, 0 to 1.';
comment on column public.scene_micro_atom_evidence.source_method is 'The run that produced the atom, e.g. photo_micro_cascade_2026-06-18.';
comment on column public.scene_micro_atom_evidence.created_at is 'Ingest time: when the atom row was written (UTC).';

-- comment_claims_progress: grain one row per auction comment processed by the claim refinery.
comment on column public.comment_claims_progress.id is 'Row id.';
comment on column public.comment_claims_progress.comment_id is 'The auction comment processed. FK to auction_comments.id.';
comment on column public.comment_claims_progress.vehicle_id is 'The vehicle the comment belongs to. FK to vehicles.id.';
comment on column public.comment_claims_progress.claim_density_score is 'Heuristic score of how claim-dense the comment is, 0 when no claims were found.';
comment on column public.comment_claims_progress.llm_processed is 'True once a language model has extracted claims from the comment.';
comment on column public.comment_claims_progress.llm_model is 'Model that extracted the claims, when llm_processed.';
comment on column public.comment_claims_progress.llm_cost_cents is 'Cost of the extraction in US cents, when llm_processed.';
comment on column public.comment_claims_progress.claims_extracted is 'Number of claims extracted from the comment.';
comment on column public.comment_claims_progress.field_evidence_ids is 'Ids of field_evidence rows the claims produced (specs and condition).';
comment on column public.comment_claims_progress.observation_ids is 'Ids of vehicle_observations rows the claims produced (provenance and sightings).';
comment on column public.comment_claims_progress.processed_at is 'When claims were extracted (UTC). Ingest time.';
comment on column public.comment_claims_progress.created_at is 'When the row was queued (UTC).';
comment on column public.comment_claims_progress.extraction_version is 'Version of the extraction run, for replay and comparison.';
comment on column public.comment_claims_progress.extraction_result is 'Raw extraction output as JSON.';
