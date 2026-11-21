-- Embedding follows landing: the embedder's batch is ordered by when a photo landed, and a watch goes red when fresh
-- photos wait for an embedding.
--
-- Why. image_observations.embedding_clip_vitb32 is the visual leg of capture_sets_score, and in practice the leg that
-- files a phone photo to a vehicle: measured 2026-11-20, all of the last 12 capture sets that filed carried it and
-- every photo in them was embedded. The last embedding before that day was written 2026-11-09 13:38 PT and no capture
-- set has filed since. The job that writes embeddings (the Mac's com.nuke.clip-embed: local CLIP, no API cost) was
-- paused with fifteen other launchd jobs during the database outage of 2026-09-26 and never resumed, and by November
-- its wrapper named a python that no longer had the model's libraries. Nothing noticed: a paused embedder looks like
-- nothing at all.
--
--   1. get_clip_embed_batch: newest LANDING first (vehicle_images.created_at), where it was newest taken_at first. A
--      photo back-filled from an old roll was taken years ago and landed today: 82 such photos of 2026-11-20
--      (taken 2017 and 2018) waited behind every newer-dated row of a 2,316-row backlog. Rows whose bytes are gone
--      or unreadable (185 of that backlog, all landed February to September 2026) are old landings, so they sink to
--      the end instead of sitting in the head of each batch.
--   2. assay_photo_embedding_flow: photos that landed in the last 7 days, more than 90 minutes ago, and still have no
--      embedding on an active row with a usable source (the batch's own rule). More than 10 raises, so the hourly
--      cron photo-embedding-watch shows red in v_job_health with the count and since when. Measured on production
--      2026-11-20: the count query reads 8,451 buffers and runs in 30 ms; after that day's drain it counts 0.
-- Not here: embedding as a stage of the image stage ledger (the durable home for "every photo is embedded"), and
-- re-planning a photo's day when its embedding lands.
-- Contract: supabase/sql/test_photo_embedding_follows_landing.sql
-- Revert: supabase/sql/revert_20261120193000_photo_embedding_follows_landing.sql
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- The replaced body is the one read from production on 2026-11-20; refuse to replace a body someone changed since.
-- A replay finds this migration's own body and passes.
do $guard$
declare v_md5 text;
begin
  v_md5 := coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure('public.get_clip_embed_batch(integer)')), 'missing');
  if v_md5 not in ('2f0eeae60b591a20049e9153748bf6cd', '773d4bcfc3b94a6729ced0e9cb89ec6b') then
    raise exception 'public.get_clip_embed_batch(integer) is not the body this migration replaces (md5 %); review before applying', v_md5;
  end if;
end $guard$;

-- ===== 1. the embedder's batch: newest landing first
create or replace function public.get_clip_embed_batch(p_limit integer default 100)
 returns table(obs_id uuid, image_url text, storage_path text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select io.id, vi.image_url, vi.storage_path
  from image_observations io
  join vehicle_images vi on vi.id = io.image_id
  where io.embedding_clip_vitb32 is null and io.is_active
    and (nullif(vi.image_url,'') is not null or vi.storage_path like '/Users/%')
  -- newest landing first (20261120193000); it was newest taken_at first, which left a photo back-filled from an old
  -- roll behind every newer-dated row
  order by vi.created_at desc nulls last, io.id
  limit greatest(1, least(p_limit, 500));
$function$;

-- ===== 2. the watch: fresh photos that have waited too long for an embedding
create or replace function public.assay_photo_embedding_flow(p_raise boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  c_fresh constant interval := interval '7 days';      -- recent landings only: an old row whose bytes are gone never embeds
  c_wait  constant interval := interval '90 minutes';  -- the embedder fires every 5 minutes; this long is a stall, not a queue
  c_allow constant int := 10;                          -- a few fresh photos whose bytes are gone must not hold the watch red
  v_waiting bigint; v_oldest timestamptz;
begin
  select count(*), min(vi.created_at) into v_waiting, v_oldest
    from public.image_observations io
    join public.vehicle_images vi on vi.id = io.image_id
   where io.embedding_clip_vitb32 is null and io.is_active
     and (nullif(vi.image_url, '') is not null or vi.storage_path like '/Users/%')   -- get_clip_embed_batch's own rule
     and vi.created_at >= now() - c_fresh and vi.created_at < now() - c_wait;
  if p_raise and v_waiting > c_allow then
    raise exception 'photo embedding stalled: % photos that landed in the last 7 days have waited over 90 minutes for an embedding (oldest landed % PT); is com.nuke.clip-embed loaded and the Mac awake?',
      v_waiting, to_char(v_oldest at time zone 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI');
  end if;
  return jsonb_build_object('status', case when v_waiting > c_allow then 'stalled' else 'passed' end,
                            'waiting', v_waiting, 'oldest_landing', v_oldest, 'allowed', c_allow,
                            'landed_within', c_fresh::text, 'waited_over', c_wait::text, 'checked_at', now());
end $function$;

revoke all on function public.assay_photo_embedding_flow(boolean) from public, anon, authenticated;
grant execute on function public.assay_photo_embedding_flow(boolean) to service_role;
comment on function public.assay_photo_embedding_flow(boolean) is
  'Whether fresh photos are getting their CLIP embedding (the visual leg of capture_sets_score): photos landed in the last 7 days, over 90 minutes ago, still without an embedding on an active row with a usable source. More than 10 raises; cron photo-embedding-watch runs it hourly.';

-- ===== 3. the hourly cron (rescheduled once; a replay leaves one job)
do $cron$
declare j bigint;
begin
  if to_regnamespace('cron') is null then return; end if;
  for j in select jobid from cron.job where jobname = 'photo-embedding-watch' loop
    perform cron.unschedule(j);
  end loop;
  perform cron.schedule('photo-embedding-watch', '25 * * * *',
    $cmd$SET statement_timeout = '20s'; SELECT public.assay_photo_embedding_flow();$cmd$);
end $cron$;

commit;
