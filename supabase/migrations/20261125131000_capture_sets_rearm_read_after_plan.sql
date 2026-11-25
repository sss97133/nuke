-- Re-arm the capture days whose photos were classified after the day's last plan (data, one time, idempotent).
--
-- Why. 20261122030000 made capture_sets_arm_new_photos re-arm a day when one of its photos finishes classification.
-- Photos classified before that rule shipped, and after their day's chunk was planned, were never scored on the
-- classifier's answer: at plan time capture_sets_score blocked them as unread, and nothing re-armed the day. Measured
-- 2026-11-25 (board, 22:0x PT): 41 such photos on 10 local days (taken 2017-2018, landed by the relay 11-21, classified
-- 11-21 01:51-03:40Z), all in no capture_landing_sets row; with the 2 below, 43 photos on 12 days.
--
-- What. For the landing config's owner, a photo qualifies when it:
--   was created in the last 30 days (idx_vehicle_images_user_created bounds the scan; 1.3 s live),
--   is admitted, has pixels and taken_at, and is unfiled or on the holding car (the scorer's own population),
--   is classified (ai_processing_status completed) and passes the scorer's blocks (not a document, duplicate,
--     superseded, sensitive, gate-rejected, or image_type other / receipt_document),
--   lies inside a non-dry chunk, and either no covering chunk was created after its ai_processing_completed_at, or
--     it is in no non-dry capture_landing_sets row (2 photos live whose read landed within minutes of the plan: today's
--     scorer gives each a candidate set, the plan of 11-21 did not).
-- Each qualifying local day (America/Los_Angeles, the arm function's day) is enqueued once through the sanctioned
-- writer capture_sets_enqueue with reason read_after_scoring, which capture_sets_drain re-plans even on a day the gate
-- refused (20261122030000). The drain does the planning; this migration writes queue rows only.
-- Not the no_clear_lead days: a day qualifies only by a photo read after its last plan.
-- Idempotent: once the drain plans a day, its new chunk postdates the read and the photo is in a set, so a replay
-- enqueues 0 (a photo the scorer gives no candidate at all would be enqueued again on a replay; there is none live).
-- Contract: supabase/sql/test_capture_sets_rearm_read_after_plan.sql. No revert: queue rows are requests the drain
-- consumes; a re-plan supersedes nothing.

begin;
set local statement_timeout = '45s';
set local lock_timeout = '3s';

do $guard$
declare r record;
begin
  for r in select * from (values
      ('public.capture_sets_enqueue(uuid,date,jsonb)', 'd45a3d1b58a48eb4df3f8e579592e4fc'),
      ('public.capture_sets_drain(integer)', 'e7780a1c38b3373e83a5f42c011ea3a7')) as t(fn, md5_expected) loop
    if coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing') <> r.md5_expected then
      raise exception '% is not the body this re-arm was written against (md5 %); review before applying', r.fn,
        coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing');
    end if;
  end loop;
end $guard$;

do $rearm$
declare r record; n_days int := 0; n_photos int := 0;
begin
  for r in
    select cfg.user_id, (vi.taken_at at time zone 'America/Los_Angeles')::date d, count(*)::int n
      from capture_landing_config cfg
      join vehicle_images vi on vi.user_id = cfg.user_id
     where cfg.id = 1 and vi.created_at >= now() - interval '30 days'
       and public.capture_set_photo_admits(vi.source, vi.vehicle_id, vi.exif_data)
       and nullif(vi.image_url, '') is not null and vi.taken_at is not null
       and (vi.vehicle_id is null or vi.vehicle_id = '14447ecd-293e-4203-9045-90102559c904'::uuid)
       and vi.ai_processing_status = 'completed' and vi.ai_processing_completed_at is not null
       and not coalesce(vi.is_document, false) and not coalesce(vi.doc_flag, false)
       and not coalesce(vi.is_duplicate, false) and not coalesce(vi.is_superseded, false) and not coalesce(vi.is_sensitive, false)
       and coalesce(vi.vision_gate_status::text, '') not in ('rejected_personal', 'rejected_misattributed')
       and coalesce(vi.ai_scan_metadata #>> '{classification,image_type}', '') not in ('', 'other', 'receipt_document')
       and exists (select 1 from capture_landing_chunks c where not c.dry and c.state <> 'superseded'
                    and vi.taken_at >= c.t_from and vi.taken_at < c.t_to)
       and (not exists (select 1 from capture_landing_chunks c where not c.dry and c.state <> 'superseded'
                         and vi.taken_at >= c.t_from and vi.taken_at < c.t_to and c.created_at > vi.ai_processing_completed_at)
            or not exists (select 1 from capture_landing_sets s join capture_landing_chunks c on c.id = s.chunk_id
                            where not c.dry and vi.id = any (s.image_ids)))
     group by 1, 2
     order by 2
  loop
    perform public.capture_sets_enqueue(r.user_id, r.d,
      jsonb_build_object('read_after_scoring', r.n, 'by', '20261125131000_capture_sets_rearm_read_after_plan'));
    n_days := n_days + 1; n_photos := n_photos + r.n;
  end loop;
  raise notice 'capture_sets re-arm: % days, % photos read after their last plan', n_days, n_photos;
end $rearm$;

commit;
