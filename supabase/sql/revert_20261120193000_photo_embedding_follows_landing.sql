-- Revert of 20261120193000_photo_embedding_follows_landing.sql: the watch cron and the assay go, and
-- get_clip_embed_batch returns to the body production held on 2026-11-20 (newest taken_at first).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- The batch function must hold this migration's body, or already the one this file puts back (a second run changes
-- nothing). Anything else is a later change, and putting the 2026-11-20 body over it would discard that change.
do $guard$
declare v_md5 text;
begin
  v_md5 := coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure('public.get_clip_embed_batch(integer)')), 'missing');
  if v_md5 not in ('2f0eeae60b591a20049e9153748bf6cd', '773d4bcfc3b94a6729ced0e9cb89ec6b') then
    raise exception 'public.get_clip_embed_batch(integer) was changed after 20261120193000 (md5 %); this revert would discard that change', v_md5;
  end if;
end $guard$;

do $cron$
declare j bigint;
begin
  if to_regnamespace('cron') is null then return; end if;
  for j in select jobid from cron.job where jobname = 'photo-embedding-watch' loop
    perform cron.unschedule(j);
  end loop;
end $cron$;

drop function if exists public.assay_photo_embedding_flow(boolean);

CREATE OR REPLACE FUNCTION public.get_clip_embed_batch(p_limit integer DEFAULT 100)
 RETURNS TABLE(obs_id uuid, image_url text, storage_path text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select io.id, vi.image_url, vi.storage_path
  from image_observations io
  join vehicle_images vi on vi.id = io.image_id
  where io.embedding_clip_vitb32 is null and io.is_active
    and (nullif(vi.image_url,'') is not null or vi.storage_path like '/Users/%')
  order by vi.taken_at desc nulls last
  limit greatest(1, least(p_limit, 500));
$function$;

commit;
