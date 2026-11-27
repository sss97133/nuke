-- DRAFT. NOT APPLIED. Stage 3: drop the *_deprecated columns, one release after stage 2.
-- Run 40a in a quiet window: it scans the 59 GB heap once. Then 40b/40c/40d in one transaction.
-- DROP COLUMN only marks the columns dropped. The ~5.0 GB comes back after a table rewrite
-- (pg_repack, or VACUUM FULL during a maintenance window), and that is a separate decision.
-- Revert: 40_stage3_drop_revert.sql.

-- 40a) Back up every value the revert cannot recompute. Sparse columns: all non-null values.
--      Default-only columns: only rows that differ from the old default.
--      uploaded_at is not kept: the revert sets it to created_at (they differ by <= 5 s on every row).
create table public.bak_vehicle_images_deprecated_20261123 as
select id,
  angle_confidence_deprecated, doc_flag_deprecated, doc_confidence_deprecated, document_classification_deprecated,
  yaw_deg_deprecated, yaw_confidence_deprecated, perspective_deprecated, surface_coord_u_deprecated, surface_coord_v_deprecated,
  vehicle_make_deprecated, vehicle_model_deprecated, vehicle_year_deprecated, vehicle_confidence_deprecated, vehicle_source_deprecated,
  filename_deprecated, perceptual_hash_deprecated, labels_deprecated, ai_last_scanned_deprecated, verification_status_deprecated,
  process_stage_deprecated, image_context_deprecated, location_confidence_deprecated,
  nullif(user_tags_deprecated, '{}'::text[]) as user_tags_deprecated,
  nullif(spatial_tags_deprecated, array[]::jsonb[]) as spatial_tags_deprecated,
  nullif(analysis_history_deprecated, '{}'::jsonb) as analysis_history_deprecated,
  nullif(context_score_deprecated, 0) as context_score_deprecated,
  nullif(processing_models_used_deprecated, array[]::text[]) as processing_models_used_deprecated,
  nullif(total_processing_cost_deprecated, 0) as total_processing_cost_deprecated,
  nullif(ai_suggestions_deprecated, '{}'::jsonb) as ai_suggestions_deprecated,
  temp_session_id_deprecated, pending_submission_id_deprecated, task_id_deprecated, workflow_role_deprecated,
  safe_preview_url_deprecated, optimized_at_deprecated, yono_queued_at_deprecated
from public.vehicle_images
where num_nonnulls(angle_confidence_deprecated, doc_flag_deprecated, doc_confidence_deprecated, document_classification_deprecated,
  yaw_deg_deprecated, yaw_confidence_deprecated, perspective_deprecated, surface_coord_u_deprecated, surface_coord_v_deprecated,
  vehicle_make_deprecated, vehicle_model_deprecated, vehicle_year_deprecated, vehicle_confidence_deprecated, vehicle_source_deprecated,
  filename_deprecated, perceptual_hash_deprecated, labels_deprecated, ai_last_scanned_deprecated,
  nullif(verification_status_deprecated, 'approved'), process_stage_deprecated, image_context_deprecated, location_confidence_deprecated,
  nullif(user_tags_deprecated, '{}'::text[]), nullif(spatial_tags_deprecated, array[]::jsonb[]),
  nullif(analysis_history_deprecated, '{}'::jsonb), nullif(context_score_deprecated, 0),
  nullif(processing_models_used_deprecated, array[]::text[]), nullif(total_processing_cost_deprecated, 0),
  nullif(ai_suggestions_deprecated, '{}'::jsonb), temp_session_id_deprecated, pending_submission_id_deprecated,
  task_id_deprecated, workflow_role_deprecated, safe_preview_url_deprecated, optimized_at_deprecated, yono_queued_at_deprecated) > 0;
alter table public.bak_vehicle_images_deprecated_20261123 add primary key (id);
-- verification_status is restored as 'approved' unless the backup holds another value.

-- 40b) Save the dependent view and trigger definitions for the revert.
create table public.bak_pipeline_deprecations_defs_20261123 as
select 'view'::text as kind, c.relname::text as name, pg_get_viewdef(c.oid) as def, c.reloptions as opts
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in
  ('vehicle_images_public','user_organized_photos','user_photo_inbox','organized_ai_analysis','v_books_audit_tiers')
union all
select 'trigger', t.tgname::text, pg_get_triggerdef(t.oid), null
from pg_trigger t where t.tgrelid = 'public.vehicle_images'::regclass
  and t.tgname in ('trg_withdraw_reviewed_image_analysis','image_retained_analysis_change');

-- 40c) GENERATOR, read-only: prints one CREATE OR REPLACE VIEW per dependent view. In each, a retired
--      column becomes NULL::<type> AS <original output name>, so the view keeps its column list and
--      types (CREATE OR REPLACE cannot remove a column). Review the output and paste it into 40d.
select format('create or replace view public.%I %s as %s', c.relname,
         coalesce('with (' || array_to_string(c.reloptions, ',') || ')', ''),
         (select string_agg_result from (
            select regexp_replace(pg_get_viewdef(c.oid),
              '(\m(?:vi|i|v|vehicle_images)\.)?\m(' || string_agg(a.attname, '|') || ')\M',
              'NULL::text /*\2*/', 'g') as string_agg_result
            from pg_attribute a where a.attrelid = 'public.vehicle_images'::regclass and a.attname like '%\_deprecated') z))
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in
  ('vehicle_images_public','user_organized_photos','user_photo_inbox','organized_ai_analysis','v_books_audit_tiers');
-- After the rename, each view prints the retired column as "<col>_deprecated AS <col>". Fix the cast per
-- column by hand: types are listed in 40_stage3_drop_revert.sql. Then check with
--   select * from public.<view> limit 0;  before and after, so the column set is identical.

-- 40d) In one transaction, after pasting the reviewed views:
-- begin;
-- set local lock_timeout = '3s';
-- <pasted CREATE OR REPLACE VIEW statements>
-- drop trigger trg_withdraw_reviewed_image_analysis on public.vehicle_images;
-- create trigger trg_withdraw_reviewed_image_analysis before update of vehicle_id, image_url, is_sensitive, is_superseded,
--   is_duplicate, is_document, vision_gate_status, image_vehicle_match_status, ai_scan_metadata
--   on public.vehicle_images for each row execute function withdraw_reviewed_image_analysis();
-- drop trigger image_retained_analysis_change on public.vehicle_images;
-- create trigger image_retained_analysis_change after insert or delete or update of vehicle_id, is_sensitive, is_document,
--   is_duplicate, is_superseded, image_vehicle_match_status, vision_gate_status, image_url, source, is_external, is_approved,
--   approval_status, redaction_level, user_id, exif_data
--   on public.vehicle_images for each row execute function invalidate_retained_analysis_sources();
-- alter table public.vehicle_images drop constraint vehicle_images_verification_status_check;
-- alter table public.vehicle_images
--   drop column angle_confidence_deprecated, drop column doc_flag_deprecated, drop column doc_confidence_deprecated,
--   drop column document_classification_deprecated, drop column yaw_deg_deprecated, drop column yaw_confidence_deprecated,
--   drop column perspective_deprecated, drop column surface_coord_u_deprecated, drop column surface_coord_v_deprecated,
--   drop column vehicle_make_deprecated, drop column vehicle_model_deprecated, drop column vehicle_year_deprecated,
--   drop column vehicle_confidence_deprecated, drop column vehicle_source_deprecated, drop column uploaded_at_deprecated,
--   drop column filename_deprecated, drop column perceptual_hash_deprecated, drop column labels_deprecated,
--   drop column ai_last_scanned_deprecated, drop column verification_status_deprecated, drop column process_stage_deprecated,
--   drop column image_context_deprecated, drop column location_confidence_deprecated, drop column user_tags_deprecated,
--   drop column spatial_tags_deprecated, drop column analysis_history_deprecated, drop column context_score_deprecated,
--   drop column processing_models_used_deprecated, drop column total_processing_cost_deprecated,
--   drop column ai_suggestions_deprecated, drop column temp_session_id_deprecated, drop column pending_submission_id_deprecated,
--   drop column task_id_deprecated, drop column workflow_role_deprecated, drop column safe_preview_url_deprecated,
--   drop column optimized_at_deprecated, drop column yono_queued_at_deprecated;   -- RESTRICT (the default): fails if anything still depends
-- drop function if exists public.migrate_existing_ai_data(), public.extract_ai_analysis_to_fields(),
--   public.update_image_ai_metadata(), public.backfill_photo_analysis(integer), public.claim_yono_vision_batch(integer,integer),
--   public.backfill_organization_status(integer), public.find_duplicate_images(uuid,text,text);
-- commit;
