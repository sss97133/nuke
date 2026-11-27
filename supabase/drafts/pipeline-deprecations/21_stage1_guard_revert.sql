-- DRAFT. Revert of 21_stage1_guard.sql (original defaults captured 2026-11-23 from pg_attrdef).
begin;
drop trigger if exists zz_warn_deprecated_vehicle_image_write on public.vehicle_images;
drop function if exists public.warn_deprecated_vehicle_image_write();
alter table public.vehicle_images
  alter column analysis_history       set default '{}'::jsonb,
  alter column context_score          set default 0,
  alter column processing_models_used set default array[]::text[],
  alter column total_processing_cost  set default 0,
  alter column user_tags              set default '{}'::text[],
  alter column spatial_tags           set default array[]::jsonb[],
  alter column ai_suggestions         set default '{}'::jsonb,
  alter column verification_status    set default 'approved'::text,
  alter column uploaded_at            set default now();
-- Comments: restore the originals saved by stage 1.
do $$ declare r record; begin
  for r in select col, original_comment from public.bak_pipeline_deprecations_col_comments_20261123 loop
    if exists (select 1 from pg_attribute where attrelid='public.vehicle_images'::regclass and attname=r.col and not attisdropped) then
      execute format('comment on column public.vehicle_images.%I is %L', r.col, r.original_comment);
    end if;
  end loop; end $$;
-- Grants, exactly as captured 2026-11-23.
grant execute on function public.find_duplicate_images(uuid,text,text) to public, anon, authenticated;
grant execute on function public.update_image_ai_metadata() to public, anon, authenticated;
grant execute on function public.migrate_existing_ai_data() to service_role;
grant execute on function public.extract_ai_analysis_to_fields() to service_role;
grant execute on function public.backfill_photo_analysis(integer) to service_role;
grant execute on function public.claim_yono_vision_batch(integer,integer) to service_role;
grant execute on function public.backfill_organization_status(integer) to service_role;
drop table if exists public.bak_pipeline_deprecations_col_comments_20261123;
commit;
