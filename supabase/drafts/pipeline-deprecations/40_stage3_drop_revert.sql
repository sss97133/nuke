-- DRAFT. Revert of 40_stage3_drop.sql. Types and defaults captured 2026-11-23 from pg_attribute/pg_attrdef.
-- Columns come back with their ORIGINAL names (this also reverts stage 2), then values are restored.
begin;
set local lock_timeout = '3s';
alter table public.vehicle_images
  add column angle_confidence numeric, add column doc_flag boolean, add column doc_confidence numeric,
  add column document_classification text, add column yaw_deg numeric, add column yaw_confidence numeric,
  add column perspective text, add column surface_coord_u numeric(8,2), add column surface_coord_v numeric(8,2),
  add column vehicle_make text, add column vehicle_model text, add column vehicle_year integer,
  add column vehicle_confidence numeric, add column vehicle_source text,
  add column uploaded_at timestamptz,                       -- default re-set below, after the fill
  add column filename text, add column perceptual_hash text, add column labels text[],
  add column ai_last_scanned timestamptz, add column verification_status text, add column process_stage text,
  add column image_context text, add column location_confidence numeric(3,2),
  add column user_tags text[], add column spatial_tags jsonb[], add column analysis_history jsonb,
  add column context_score integer, add column processing_models_used text[], add column total_processing_cost numeric(10,6),
  add column ai_suggestions jsonb, add column temp_session_id text, add column pending_submission_id uuid,
  add column task_id uuid, add column workflow_role text, add column safe_preview_url text,
  add column optimized_at timestamptz, add column yono_queued_at timestamptz;
alter table public.vehicle_images add constraint vehicle_images_verification_status_check
  check (verification_status = any (array['pending','approved','rejected'])) not valid;
-- Recreate the two triggers and five views from public.bak_pipeline_deprecations_defs_20261123 (def column, verbatim).
-- Re-grant anon column SELECT as in 30_stage2_rename_deprecated_revert.sql (original names).
commit;

-- Value restore, in batches outside the transaction (66M rows; run in id ranges):
-- update public.vehicle_images v set
--   uploaded_at = v.created_at,
--   verification_status = coalesce(b.verification_status_deprecated, 'approved'),
--   user_tags = coalesce(b.user_tags_deprecated, '{}'), spatial_tags = coalesce(b.spatial_tags_deprecated, array[]::jsonb[]),
--   analysis_history = coalesce(b.analysis_history_deprecated, '{}'), context_score = coalesce(b.context_score_deprecated, 0),
--   processing_models_used = coalesce(b.processing_models_used_deprecated, array[]::text[]),
--   total_processing_cost = coalesce(b.total_processing_cost_deprecated, 0), ai_suggestions = coalesce(b.ai_suggestions_deprecated, '{}'),
--   angle_confidence = b.angle_confidence_deprecated, doc_flag = b.doc_flag_deprecated, ... (every sparse column)
-- from public.vehicle_images v2 left join public.bak_vehicle_images_deprecated_20261123 b on b.id = v2.id
-- where v.id = v2.id and v.id between $lo and $hi;
-- Then: alter column ... set default as listed in 21_stage1_guard_revert.sql, and validate the check constraint.
