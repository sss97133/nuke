-- Visual evidence floor for clear capture landing sets (20261123234500).
--
-- Why. capture_landing_plan_step treated any visual > 0 as photo evidence. Session, cell, recent,
-- work_session and prev_day priors could then push the score over 2.5 / margin 1.0 and the set
-- went clear. On 2026-11-23 a 12-photo Nassau-blue C2 Corvette day cleared to a 1966 Mustang at
-- score 3.056: identity legs were 0 and visual was only 0.278 (visual_margin 0.009). A 2-photo
-- car-hauler day cleared to a 1989 R3500 on visual 2.5 with visual_margin 0.11. Neither was
-- filed (the visual gate was unattended). Wrong landings are worse than none.
--
-- Changes:
--   1. capture_landing_has_photo_evidence(signals) / capture_landing_photo_evidence_gap(signals):
--      evidence is vin, plate, badge or model > 0, or visual >= 1.0 with visual_margin >= 0.25
--      (the margin is required when visual is the only photo leg). Gap is null when that holds,
--      weak_visual when a visual crumb or thin visual margin is the only photo leg, priors_only
--      when there is no photo leg. The 2.5 / 1.0 bar is unchanged.
--   2. capture_landing_plan_step uses those helpers. A set that met score and margin on priors
--      plus a crumb / tied visual is review (weak_visual or priors_only), not clear.
--   3. capture_landing_visual_evidence_redecide_v1 (+ _revert_v1): signed, dry-default, cap 50.
--      Re-decides still-unapplied awaiting_gate clear sets under the new rule, writes
--      capture_set_review, and if no clear set remains, marks the chunk applied. Does not file,
--      does not call capture_landing_gate_check, does not touch chunk 9cf5b7a4, does not lower
--      the bar, does not move typ / taken_at / vehicle_images.
--
-- Guard: plan_step is replaced only when md5(prosrc) is the 2026-11-23 live body
-- (6f8a5cef85f325e4fced48023908b4a9) or the body this file installs (6ef112d20600756350a78e4deb0ef93b).
-- Revert: supabase/sql/revert_20261123234500_capture_landing_visual_evidence_floor.sql
-- Contract: supabase/sql/test_capture_landing_visual_evidence_floor.sql

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.capture_landing_has_photo_evidence(p_signals jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    COALESCE((p_signals->>'vin')::numeric, 0) > 0
    OR COALESCE((p_signals->>'plate')::numeric, 0) > 0
    OR COALESCE((p_signals->>'badge')::numeric, 0) > 0
    OR COALESCE((p_signals->>'model')::numeric, 0) > 0
    OR (
      COALESCE((p_signals->>'visual')::numeric, 0) >= 1.0
      AND COALESCE((p_signals->>'visual_margin')::numeric, 0) >= 0.25
    );
$function$;

CREATE OR REPLACE FUNCTION public.capture_landing_photo_evidence_gap(p_signals jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN public.capture_landing_has_photo_evidence(p_signals) THEN NULL
    WHEN COALESCE((p_signals->>'visual')::numeric, 0) > 0 THEN 'weak_visual'
    ELSE 'priors_only'
  END;
$function$;

COMMENT ON FUNCTION public.capture_landing_has_photo_evidence(jsonb) IS
  'True when a landing winner has a photo evidence leg: vin/plate/badge/model > 0, or visual >= 1.0 and visual_margin >= 0.25 (20261123234500).';
COMMENT ON FUNCTION public.capture_landing_photo_evidence_gap(jsonb) IS
  'Null when capture_landing_has_photo_evidence holds; otherwise weak_visual (a visual crumb or thin visual margin) or priors_only (20261123234500).';

do $do$
declare
  v_md5 text;
  v_attrs text;
  v_now text;
begin
  select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.capture_landing_plan_step(uuid,integer)');
  if v_md5 is null then
    raise exception 'public.capture_landing_plan_step(uuid,integer) is not live';
  end if;
  if v_md5 = '6ef112d20600756350a78e4deb0ef93b' then
    raise notice 'capture_landing_plan_step already carries the 20261123234500 visual evidence floor';
  elsif v_md5 <> '6f8a5cef85f325e4fced48023908b4a9' then
    raise exception 'capture_landing_plan_step is not the body this migration was written against (md5 %); refusing to replace it', v_md5;
  else
    perform set_config('capture_visual_evidence.attrs', (
      select concat_ws(' | ', pg_get_userbyid(p.proowner), p.proacl::text, p.prosecdef, p.provolatile, l.lanname,
                       p.proconfig::text, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
        from pg_proc p join pg_language l on l.oid = p.prolang
       where p.oid = to_regprocedure('public.capture_landing_plan_step(uuid,integer)')
    ), true);
  end if;
end $do$;


CREATE OR REPLACE FUNCTION public.capture_landing_plan_step(p_chunk uuid, p_budget_s integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '120s'
AS $function$
declare c capture_landing_chunks; cfg capture_landing_config; d timestamptz; d_end timestamptz; prov jsonb; n_sets int := 0; started timestamptz := clock_timestamp();
begin
  select * into c from capture_landing_chunks where id = p_chunk for update;
  if not found or c.state <> 'planning' then return jsonb_build_object('chunk', p_chunk, 'state', c.state, 'skipped', true); end if;
  select * into cfg from capture_landing_config where id = 1;
  d := coalesce(c.plan_cursor, c.t_from);
  while d < c.t_to loop
    d_end := least(d + interval '1 day', c.t_to);
    -- chronological context: clear proposals made earlier in this same chunk feed later days (not yet filed)
    select coalesce(jsonb_agg(jsonb_build_object('vid', s.vehicle_id, 't1', s.t1, 'cells', to_jsonb(s.cells))), '[]'::jsonb) into prov
      from capture_landing_sets s where s.chunk_id = c.id and s.decision = 'clear' and s.t1 >= d - interval '3 days';
    with sc as materialized (
      select * from capture_sets_score(c.user_id, d, d_end, 'live', null, prov) x where cardinality(x.image_ids) > 0
    ), w as (
      -- priors_only (20261111200000): a set clears only when the winner's frames carry an evidence leg. session, cell,
      -- recent, work_session and prev_day are priors from the day's pattern; visual, vin, plate, badge and model are read
      -- from the photos themselves.
      select t.*,
             -- 20261123234500: crumb visual is not evidence. vin/plate/badge/model count, or visual >= 1.0
             -- with visual_margin >= 0.25 (required when visual is the only photo leg).
             public.capture_landing_has_photo_evidence(t.signals) as has_evidence,
             coalesce((select array_agg(vi.id order by vi.taken_at)
                         from vehicle_images vi
                        where vi.id = any (t.image_ids)
                          and coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','')
                                not in ('other','receipt_document')
                          and not (coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','') = ''
                                   and coalesce(vi.ai_processing_status,'') in ('pending','processing','failed'))  -- (20261120184500) not read
                          and not exists (
                                select 1 from capture_set_review r
                                 where r.status = 'open' and vi.id = any (r.image_ids)
                              )
                          and not exists (
                                select 1 from auto_filing_audit_queue q
                                 where q.image_id = vi.id
                                   and q.vehicle_id is not distinct from t.vehicle_id
                                   and q.source = 'pre_gate'
                                   and q.status = 'wrong'
                                   and q.verified_at is not null
                              )
                       ), '{}'::uuid[]) as clearable_ids,  -- (20261115123000, 20261116243000)
             public.capture_landing_set_identity_conflict(t.vehicle_id, t.image_ids) as identity_conflict  -- (20261115135000)
      from sc t where t.rank = 1
    )
    insert into capture_landing_sets (chunk_id, set_key, t0, t1, vehicle_id, image_ids, filed_ids, cells, score, margin, decision, reason, top3)
    select c.id, t.set_key, t.t0, t.t1, t.vehicle_id,
           case when t.vehicle_id is not null and t.vehicle_id <> all (cfg.protected_vehicle_ids)
                 and (t.signals->>'score')::numeric >= greatest(2.5, cfg.min_score)
                 and (t.signals->>'margin_raw')::numeric >= greatest(1, cfg.min_margin)
                 and t.has_evidence
                 and cardinality(t.clearable_ids) > 0
                then t.clearable_ids else t.image_ids end,  -- (20261115123000) typ=other/receipt never stored on a clear set
           t.filed_ids,
           coalesce((select array_agg(distinct round(vi.latitude::numeric,3)::text || ',' || round(vi.longitude::numeric,3)::text)
                      from vehicle_images vi where vi.id = any(t.image_ids) and vi.latitude is not null), '{}'),
           (t.signals->>'score')::numeric, (t.signals->>'margin_raw')::numeric,
           case when t.vehicle_id is not null and t.vehicle_id <> all (cfg.protected_vehicle_ids)
                 and (t.signals->>'score')::numeric >= greatest(2.5, cfg.min_score)
                 and (t.signals->>'margin_raw')::numeric >= greatest(1, cfg.min_margin)
                 and t.has_evidence
                 and cardinality(t.clearable_ids) > 0
                 and not t.identity_conflict then 'clear' else 'review' end,
           case when t.vehicle_id is null then 'no_candidate'
                when t.vehicle_id = any (cfg.protected_vehicle_ids) then 'protected_vehicle'
                when (t.signals->>'margin_raw')::numeric < greatest(1, cfg.min_margin) then 'no_clear_lead'
                when (t.signals->>'score')::numeric < greatest(2.5, cfg.min_score) then 'score_below_threshold'
                when not t.has_evidence and coalesce((t.signals->>'visual')::numeric, 0) > 0 then 'weak_visual'
                when not t.has_evidence then 'priors_only'
                when cardinality(t.clearable_ids) = 0
                     and exists (
                       select 1 from vehicle_images vi
                        where vi.id = any (t.image_ids)
                          and coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','')
                                not in ('other','receipt_document')
                     ) then 'already_held_or_prior_wrong'
                when cardinality(t.clearable_ids) = 0 then 'non_vehicle_type'
                when t.identity_conflict then 'identity_conflict' end,  -- (20261115123000, 20261115135000, 20261116243000)
           (select jsonb_agg(jsonb_build_object('vehicle_id', y.vehicle_id, 'rank', y.rank, 'signals', y.signals) order by y.rank) from sc y where y.set_key = t.set_key)
    from w t
    on conflict (chunk_id, set_key) do nothing;
    get diagnostics n_sets = row_count;
    d := d_end;
    update capture_landing_chunks set plan_cursor = d, updated_at = now() where id = c.id;
    exit when extract(epoch from clock_timestamp() - started) > p_budget_s;
  end loop;
  if d >= c.t_to then
    update capture_landing_chunks set state = 'planned', updated_at = now(),
      stats = jsonb_build_object('sets', (select count(*) from capture_landing_sets where chunk_id = c.id),
        'clear_sets', (select count(*) from capture_landing_sets where chunk_id = c.id and decision = 'clear'),
        'clear_photos', (select coalesce(sum(cardinality(image_ids)),0) from capture_landing_sets where chunk_id = c.id and decision = 'clear'),
        'review_sets', (select count(*) from capture_landing_sets where chunk_id = c.id and decision = 'review'),
        'review_photos', (select coalesce(sum(cardinality(image_ids)),0) from capture_landing_sets where chunk_id = c.id and decision = 'review'),
        'review_reasons', (select coalesce(jsonb_object_agg(reason, n), '{}') from (select reason, count(*) n from capture_landing_sets where chunk_id = c.id and decision = 'review' group by 1) q))
    where id = c.id;
  end if;
  return jsonb_build_object('chunk', c.id, 'cursor', d, 'done', d >= c.t_to);
end $function$;


do $do$
declare
  v_md5 text;
  v_was text := current_setting('capture_visual_evidence.attrs', true);
  v_now text;
begin
  select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.capture_landing_plan_step(uuid,integer)');
  if v_md5 is distinct from '6ef112d20600756350a78e4deb0ef93b' then
    raise exception 'capture_landing_plan_step did not become the 20261123234500 body (md5 %)', coalesce(v_md5, 'null');
  end if;
  select concat_ws(' | ', pg_get_userbyid(p.proowner), p.proacl::text, p.prosecdef, p.provolatile, l.lanname,
                   p.proconfig::text, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
    into v_now
    from pg_proc p join pg_language l on l.oid = p.prolang
   where p.oid = to_regprocedure('public.capture_landing_plan_step(uuid,integer)');
  if v_was is not null and v_was <> '' and v_now is distinct from v_was then
    raise exception 'capture_landing_plan_step attributes moved: % became %', v_was, v_now;
  end if;
end $do$;

CREATE TABLE IF NOT EXISTS public.capture_landing_visual_evidence_redecide_log (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  user_id uuid NOT NULL,
  set_key text NOT NULL,
  prior_decision text NOT NULL,
  prior_reason text,
  new_reason text NOT NULL,
  prior_chunk_state text,
  prior_chunk_note text,
  chunk_closed boolean NOT NULL DEFAULT false,
  signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz
);
CREATE INDEX IF NOT EXISTS capture_landing_visual_evidence_redecide_log_run
  ON public.capture_landing_visual_evidence_redecide_log (run_id);

CREATE OR REPLACE FUNCTION public.capture_landing_visual_evidence_redecide_v1(p_user uuid, p_run uuid, p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record; n int := 0; v_items jsonb := '[]'; v_sig text; v_closed int := 0; v_would jsonb := '[]';
BEGIN
  -- (20261123234500) unapplied awaiting_gate clears that fail the visual evidence floor -> review, not file
  IF p_user IS NULL OR p_run IS NULL THEN RAISE EXCEPTION 'capture_landing_visual_evidence_redecide_v1: user and run required'; END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN RAISE EXCEPTION 'capture_landing_visual_evidence_redecide_v1: cap must be 1..50'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_landing_visual_evidence_redecide'));
  CREATE TEMP TABLE IF NOT EXISTS _ved (
    chunk_id uuid, run_uuid uuid, set_key text, t_from timestamptz, image_ids uuid[],
    vehicle_id uuid, score numeric, top3 jsonb, prior_reason text, gap text,
    prior_state text, prior_note text
  ) ON COMMIT DROP;
  TRUNCATE _ved;
  INSERT INTO _ved
  SELECT c.id, c.run_id, s.set_key, c.t_from, s.image_ids, s.vehicle_id, s.score, s.top3, s.reason,
         public.capture_landing_photo_evidence_gap(coalesce(
           (SELECT t->'signals' FROM jsonb_array_elements(coalesce(s.top3, '[]'::jsonb)) t
             WHERE coalesce((t->>'rank')::int, 1) = 1 LIMIT 1),
           '{}'::jsonb)),
         c.state, c.note
  FROM capture_landing_chunks c
  JOIN capture_landing_sets s ON s.chunk_id = c.id
  WHERE c.user_id = p_user AND NOT c.dry AND c.state = 'awaiting_gate'
    AND c.id <> '9cf5b7a4-57db-4460-a8ee-434c77428a33'::uuid
    AND s.decision = 'clear' AND s.applied_at IS NULL
    AND public.capture_landing_photo_evidence_gap(coalesce(
          (SELECT t->'signals' FROM jsonb_array_elements(coalesce(s.top3, '[]'::jsonb)) t
            WHERE coalesce((t->>'rank')::int, 1) = 1 LIMIT 1),
          '{}'::jsonb)) IS NOT NULL;
  SELECT count(*) INTO n FROM _ved;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'chunk', chunk_id, 'run', run_uuid, 'set_key', set_key, 'day', t_from,
           'reason', gap, 'photos', cardinality(image_ids)) ORDER BY t_from, set_key), '[]')
    INTO v_would FROM _ved;
  IF p_dry THEN
    RETURN jsonb_build_object('run', p_run, 'dry_run', true, 'would_redecide', n, 'cap', p_cap,
                              'over_cap', n > p_cap, 'items', v_would);
  END IF;
  IF n > p_cap THEN
    RETURN jsonb_build_object('run', p_run, 'dry_run', false, 'halted_over_cap', true,
                              'candidates', n, 'cap', p_cap, 'written', 0, 'items', v_would);
  END IF;
  FOR r IN SELECT * FROM _ved ORDER BY t_from, set_key LOOP
    UPDATE capture_landing_sets
       SET decision = 'review', reason = r.gap
     WHERE chunk_id = r.chunk_id AND set_key = r.set_key AND decision = 'clear' AND applied_at IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    INSERT INTO capture_set_review (run_id, user_id, set_key, image_ids, to_vehicle_id, confidence, basis, evidence, reason, status)
    VALUES (r.run_uuid, p_user, r.set_key, r.image_ids, r.vehicle_id,
            round(1/(1+exp(-coalesce(r.score,0)+2)),3), 'scored_session',
            jsonb_build_object('redecide_run', p_run, 'prior_decision', 'clear', 'prior_reason', r.prior_reason,
                               'scorer', 'v3', 'top3', r.top3, 'rule', '20261123234500'),
            r.gap, 'open')
    ON CONFLICT (run_id, set_key) DO NOTHING;
    v_sig := encode(sha256(convert_to(concat_ws('|', 'capture_landing_visual_evidence_redecide_v1', p_run, r.chunk_id, r.set_key, r.gap), 'UTF8')), 'hex');
    INSERT INTO capture_landing_visual_evidence_redecide_log
      (run_id, chunk_id, user_id, set_key, prior_decision, prior_reason, new_reason,
       prior_chunk_state, prior_chunk_note, chunk_closed, signature)
    VALUES (p_run, r.chunk_id, p_user, r.set_key, 'clear', r.prior_reason, r.gap,
            r.prior_state, r.prior_note, false, v_sig);
  END LOOP;
  FOR r IN
    SELECT DISTINCT v.chunk_id, v.run_uuid, v.prior_state, v.prior_note
      FROM _ved v
     WHERE NOT EXISTS (
       SELECT 1 FROM capture_landing_sets s
        WHERE s.chunk_id = v.chunk_id AND s.decision = 'clear' AND s.applied_at IS NULL)
  LOOP
    UPDATE capture_landing_chunks
       SET state = 'applied',
           note = 'clears re-decided under the visual evidence floor; held as proposals (capture_set_review)',
           updated_at = now(),
           stats = coalesce(stats, '{}') || jsonb_build_object('visual_evidence_redecide',
                    jsonb_build_object('run', p_run, 'at', now()))
     WHERE id = r.chunk_id AND state = 'awaiting_gate';
    IF FOUND THEN
      UPDATE capture_landing_visual_evidence_redecide_log
         SET chunk_closed = true
       WHERE run_id = p_run AND chunk_id = r.chunk_id AND reverted_at IS NULL;
      v_closed := v_closed + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('run', p_run, 'dry_run', false,
    'redecided', (SELECT count(*) FROM capture_landing_visual_evidence_redecide_log WHERE run_id = p_run AND reverted_at IS NULL),
    'chunks_closed', v_closed,
    'items', v_would,
    'revert', 'select capture_landing_visual_evidence_redecide_revert_v1(' || quote_literal(p_run) || ')');
END $function$;

CREATE OR REPLACE FUNCTION public.capture_landing_visual_evidence_redecide_revert_v1(p_run uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l record; n int := 0; c_run uuid;
BEGIN
  -- (20261123234500)
  IF p_run IS NULL THEN RAISE EXCEPTION 'capture_landing_visual_evidence_redecide_revert_v1: run required'; END IF;
  FOR l IN
    SELECT * FROM capture_landing_visual_evidence_redecide_log
     WHERE run_id = p_run AND reverted_at IS NULL
     ORDER BY id DESC
  LOOP
    SELECT run_id INTO c_run FROM capture_landing_chunks WHERE id = l.chunk_id;
    DELETE FROM capture_set_review r
     WHERE r.run_id = c_run AND r.set_key = l.set_key
       AND r.reason = l.new_reason
       AND r.evidence->>'redecide_run' = p_run::text;
    UPDATE capture_landing_sets
       SET decision = l.prior_decision, reason = l.prior_reason
     WHERE chunk_id = l.chunk_id AND set_key = l.set_key
       AND decision = 'review' AND reason = l.new_reason AND applied_at IS NULL;
    IF l.chunk_closed THEN
      UPDATE capture_landing_chunks
         SET state = l.prior_chunk_state, note = l.prior_chunk_note, updated_at = now(),
             stats = stats - 'visual_evidence_redecide'
       WHERE id = l.chunk_id AND state = 'applied'
         AND stats->'visual_evidence_redecide'->>'run' = p_run::text;
    END IF;
    UPDATE capture_landing_visual_evidence_redecide_log SET reverted_at = now() WHERE id = l.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;

REVOKE ALL ON FUNCTION public.capture_landing_has_photo_evidence(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_landing_photo_evidence_gap(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_landing_visual_evidence_redecide_v1(uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_landing_visual_evidence_redecide_revert_v1(uuid) FROM PUBLIC, anon, authenticated;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.capture_landing_has_photo_evidence(jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.capture_landing_photo_evidence_gap(jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.capture_landing_visual_evidence_redecide_v1(uuid, uuid, boolean, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.capture_landing_visual_evidence_redecide_revert_v1(uuid) TO service_role;
  END IF;
END $g$;

COMMENT ON FUNCTION public.capture_landing_visual_evidence_redecide_v1(uuid, uuid, boolean, integer) IS
  'Re-decide still-unapplied awaiting_gate clear sets under the visual evidence floor; writes review, does not file, does not call the gate (signed, dry default, cap 50; 20261123234500).';

commit;
