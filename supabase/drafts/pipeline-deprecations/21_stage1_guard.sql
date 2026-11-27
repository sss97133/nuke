-- DRAFT. NOT APPLIED. Stage 1 of the image-pipeline retirement (see README.md section 3).
-- Stop the writers that are database-side, mark every candidate, and warn on any remaining write
-- for one release. Application repoints are listed in 20_stage1_stop_writers_repoint.md and must
-- ship in the same release. Revert: 21_stage1_guard_revert.sql.
begin;
set local lock_timeout = '3s';

-- 1) The only writer of the default-only columns is their column DEFAULT. Removing it stops new
--    rows from storing them (66M rows already do; that is reclaimed in stage 3).
alter table public.vehicle_images
  alter column analysis_history       drop default,
  alter column context_score          drop default,
  alter column processing_models_used drop default,
  alter column total_processing_cost  drop default,
  alter column user_tags              drop default,
  alter column spatial_tags           drop default,
  alter column ai_suggestions         drop default,
  alter column verification_status    drop default,
  alter column uploaded_at            drop default;

-- 2) Mark each candidate so v_schema_atlas and the generated types show the replacement.
--    34 of the 37 already carry a comment; keep it (prefixed) and save the original for the revert.
create table if not exists public.bak_pipeline_deprecations_col_comments_20261123 as
  select a.attname::text as col, col_description(a.attrelid, a.attnum) as original_comment
  from pg_attribute a where a.attrelid = 'public.vehicle_images'::regclass and a.attnum > 0 and not a.attisdropped;
do $$
declare r record;
begin
  for r in select * from (values
    ('angle_confidence','ai_detected_angle_confidence'), ('doc_flag','is_document'),
    ('doc_confidence','is_document'), ('document_classification','document_category'),
    ('yaw_deg','image_camera_position'), ('yaw_confidence','image_camera_position'),
    ('perspective','image_camera_position'), ('surface_coord_u','image_coordinate_observations'),
    ('surface_coord_v','image_coordinate_observations'), ('vehicle_make','photo_extracted_fields / ai_detected_vehicle'),
    ('vehicle_model','photo_extracted_fields / ai_detected_vehicle'), ('vehicle_year','photo_extracted_fields / ai_detected_vehicle'),
    ('vehicle_confidence','photo_extracted_fields.confidence'), ('vehicle_source','photo_extracted_fields.extractor'),
    ('uploaded_at','created_at'), ('filename','file_name'), ('perceptual_hash','phash'),
    ('labels','apple_ml_labels / image_tags'), ('ai_last_scanned','vision_analyzed_at'),
    ('verification_status','approval_status / vision_gate_status'), ('process_stage','fabrication_stage'),
    ('image_context','source'), ('location_confidence','admit_photo_gps_locations'),
    ('user_tags','image_tags'), ('spatial_tags','image_coordinate_observations'),
    ('analysis_history','image_stage_receipts'), ('context_score','none'),
    ('processing_models_used','classifier_receipt'), ('total_processing_cost','spend ledger'),
    ('ai_suggestions','auto_suggested_vehicle_id'), ('temp_session_id','none'),
    ('pending_submission_id','none'), ('task_id','none'), ('workflow_role','none'),
    ('safe_preview_url','thumbnail_url / variants'), ('optimized_at','none'), ('yono_queued_at','none')
  ) v(col, repl) loop
    execute format('comment on column public.vehicle_images.%I is %L', r.col,
      'DEPRECATED 2026-11 (pipeline-deprecations stage 1). Use: ' || r.repl || '. Renamed to _deprecated in stage 2. '
      || coalesce(col_description('public.vehicle_images'::regclass,
           (select attnum from pg_attribute where attrelid='public.vehicle_images'::regclass and attname=r.col)), ''));
  end loop;
end $$;

-- 3) Warn on any write that still reaches a candidate. Cheap: only non-null NEW values are checked.
create or replace function public.warn_deprecated_vehicle_image_write() returns trigger
language plpgsql as $$
declare hit text[] := '{}';
begin
  if new.angle_confidence is not null then hit := hit || 'angle_confidence'; end if;
  if new.doc_flag is not null then hit := hit || 'doc_flag'; end if;
  if new.doc_confidence is not null then hit := hit || 'doc_confidence'; end if;
  if new.document_classification is not null then hit := hit || 'document_classification'; end if;
  if new.yaw_deg is not null or new.yaw_confidence is not null or new.perspective is not null
     or new.surface_coord_u is not null or new.surface_coord_v is not null then hit := hit || 'pose'; end if;
  if new.vehicle_make is not null or new.vehicle_model is not null or new.vehicle_year is not null
     or new.vehicle_confidence is not null or new.vehicle_source is not null then hit := hit || 'vehicle_*'; end if;
  if new.perceptual_hash is not null and (tg_op = 'INSERT' or new.perceptual_hash is distinct from old.perceptual_hash) then hit := hit || 'perceptual_hash'; end if;
  if new.filename is not null and (tg_op = 'INSERT' or new.filename is distinct from old.filename) then hit := hit || 'filename'; end if;
  if new.labels is not null and (tg_op = 'INSERT' or new.labels is distinct from old.labels) then hit := hit || 'labels'; end if;
  if new.ai_last_scanned is not null and (tg_op = 'INSERT' or new.ai_last_scanned is distinct from old.ai_last_scanned) then hit := hit || 'ai_last_scanned'; end if;
  if new.process_stage is not null or new.workflow_role is not null or new.task_id is not null
     or new.temp_session_id is not null or new.pending_submission_id is not null or new.safe_preview_url is not null
     or new.optimized_at is not null or new.yono_queued_at is not null or new.location_confidence is not null then hit := hit || 'dead'; end if;
  if tg_op = 'INSERT' and new.image_context is not null then hit := hit || 'image_context'; end if;
  if cardinality(hit) > 0 then
    raise warning 'deprecated vehicle_images column write: % (id %)', hit, new.id;
  end if;
  return new;
end $$;

create trigger zz_warn_deprecated_vehicle_image_write
  before insert or update on public.vehicle_images
  for each row execute function public.warn_deprecated_vehicle_image_write();

-- 4) Orphans: functions with no trigger, cron, SQL caller or repo caller (README section 4).
--    Revoke execute for one release instead of dropping.
--    ACLs captured 2026-11-23: two of them are executable by anon and authenticated today.
revoke execute on function public.find_duplicate_images(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.update_image_ai_metadata() from public, anon, authenticated;
revoke execute on function public.migrate_existing_ai_data() from service_role;
revoke execute on function public.extract_ai_analysis_to_fields() from service_role;
revoke execute on function public.backfill_photo_analysis(integer) from service_role;
revoke execute on function public.claim_yono_vision_batch(integer,integer) from service_role;
revoke execute on function public.backfill_organization_status(integer) from service_role;

commit;
