-- v2 (20261104001000): + plate-exact per-photo claims at 0.97 (OCR line == roster plate), Viva excluded.
-- Driver: scorer -> record_capture_set_candidates (top 3) -> capture_sets_apply ('scored_session') for clear sets,
-- capture_set_review (top 3 in evidence) for the rest, and per-photo claims via ingest_image_observation.
-- p_dry = true: computes everything, writes NOTHING (returns the plan). Revert a live run:
--   select capture_sets_revert(run); update image_observations set is_active=false where observed_by='capture_sets_landing_v1' and confidence_basis->>'run_id'=run::text;
--   update capture_set_candidates set revoked_at=now(), revoked_reason='revert' where run_id=run; update capture_set_review set status='dismissed' where run_id=run;
create or replace function public.capture_sets_landing_run(p_user uuid, p_from timestamptz, p_to timestamptz, p_run uuid, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' set statement_timeout to '600s' as $f$
declare r record; items jsonb := '[]'; cands jsonb := '[]'; nrev int := 0; nclaim_vin int := 0; nclaim_sugg int := 0; nclaim_plate int := 0; v_basis text;
  would_file int := 0; held int := 0; res jsonb := null; rc jsonb := null; img uuid; seg_ids uuid[]; vin_veh uuid; c numeric;
begin
  if p_run is null then raise exception 'run id required'; end if;
  create temp table if not exists _cs on commit drop as select * from capture_sets_score(p_user, p_from, p_to, 'live') limit 0;
  truncate _cs; insert into _cs select * from capture_sets_score(p_user, p_from, p_to, 'live');
  for r in select s1.*, (s1.signals->>'score')::numeric sc, (s1.signals->>'margin_raw')::numeric mg,
                  (select jsonb_agg(jsonb_build_object('vehicle_id', s2.vehicle_id, 'rank', s2.rank, 'signals', s2.signals) order by s2.rank)
                     from _cs s2 where s2.set_key = s1.set_key) top3
           from _cs s1 where s1.rank = 1 and cardinality(s1.image_ids) > 0 order by s1.t0 desc loop   -- newest first
    cands := cands || (select jsonb_agg(jsonb_build_object('set_key', s2.set_key, 'image_ids', to_jsonb(s2.image_ids), 'vehicle_id', s2.vehicle_id,
        'rank', s2.rank, 'combined', round(1/(1+exp(-((s2.signals->>'score')::numeric - 2))),4),
        'margin', greatest(-1, least(1, round(case when s2.rank = 1 then 1/(1+exp(-(r.sc-2))) - 1/(1+exp(-((r.sc - r.mg) - 2)))
                  else 1/(1+exp(-((s2.signals->>'score')::numeric - 2))) - 1/(1+exp(-(r.sc-2))) end, 4))),
        'band', case when s2.rank = 1 and r.sc >= 2.5 and r.mg >= 1 then 'clear' when s2.rank = 1 and r.mg < 0.25 then 'tie'
                     when (s2.signals->>'score')::numeric >= 1.5 then 'likely' else 'weak' end,
        'signals', s2.signals)) from _cs s2 where s2.set_key = r.set_key);
    if r.sc >= 2.5 and r.mg >= 1 then
      would_file := would_file + cardinality(r.image_ids);
      select array_agg(g.id) into seg_ids from vehicle_images g where g.id = any(r.image_ids || r.filed_ids);
      items := items || jsonb_build_array(jsonb_build_object('set_key', r.set_key, 'vehicle_id', r.vehicle_id, 'image_ids', to_jsonb(r.image_ids),
               'segment_ids', to_jsonb(seg_ids), 'confidence', round(1/(1+exp(-(r.sc - 2))),3), 'basis', 'scored_session', 'evidence', r.signals));
    else
      held := held + cardinality(r.image_ids); nrev := nrev + 1;
      if not p_dry then
        insert into capture_set_review(run_id, user_id, set_key, image_ids, to_vehicle_id, confidence, basis, evidence, reason)
        values (p_run, p_user, r.set_key, r.image_ids, r.vehicle_id, round(1/(1+exp(-(r.sc - 2))),3), 'scored_session',
                jsonb_build_object('top3', r.top3), case when r.mg < 1 then 'no_clear_lead' else 'score_below_2.5' end)
        on conflict (run_id, set_key) do nothing;
      end if;
    end if;
    -- per-photo claims: VIN exact on the owner's roster -> 0.97 (files via derive cron); else suggestion capped at 0.84
    foreach img in array r.image_ids loop
      select v.id into vin_veh from vehicle_images g join vehicles v on (v.owner_id = p_user or v.user_id = p_user) and v.deleted_at is null
         and v.merged_into_vehicle_id is null and length(coalesce(vin_match_key(v.vin),'')) >= 11 and v.id not in ('7b0e02b9-42af-4998-b27d-69e3459b452b'::uuid,'1e9fdf16-b453-44a9-8b74-46bbe886625a'::uuid)
       where g.id = img and not coalesce(g.is_document,false) and (vin_match_key(g.vehicle_vin) = vin_match_key(v.vin)
         or exists (select 1 from image_text_reads tr cross join lateral jsonb_array_elements(tr.vin_candidates) x
                    where tr.image_id = img and tr.revoked_at is null and vin_match_key(x->>'vin') = vin_match_key(v.vin))) limit 1;
      v_basis := case when vin_veh is not null then 'vin_exact' end;
      if vin_veh is null then
        select v.id into vin_veh from vehicles v
         where (v.owner_id = p_user or v.user_id = p_user) and v.deleted_at is null and v.merged_into_vehicle_id is null
           and length(regexp_replace(upper(coalesce(v.license_plate,'')),'[^A-Z0-9]','','g')) >= 5
           and v.id not in ('7b0e02b9-42af-4998-b27d-69e3459b452b'::uuid,'1e9fdf16-b453-44a9-8b74-46bbe886625a'::uuid)
           and exists (select 1 from image_text_reads tr cross join lateral jsonb_array_elements(tr.lines) ln
                        where tr.image_id = img and tr.revoked_at is null
                          and regexp_replace(upper(ln->>0),'[^A-Z0-9]','','g') = regexp_replace(upper(v.license_plate),'[^A-Z0-9]','','g'))
         limit 1;
        if vin_veh is not null then v_basis := 'plate_exact'; nclaim_plate := nclaim_plate + 1; nclaim_vin := nclaim_vin - 1; end if;
      end if;
      if vin_veh is not null then nclaim_vin := nclaim_vin + 1; c := 0.97; else nclaim_sugg := nclaim_sugg + 1; c := least(0.84, round(1/(1+exp(-(r.sc - 2))),3)); end if;
      if not p_dry then
        perform ingest_image_observation(img, coalesce(vin_veh, r.vehicle_id), 'subject', c, 'capture_sets_landing_v1', 'scored_session_v1',
          jsonb_build_object('run_id', p_run, 'set_key', r.set_key, 'basis', coalesce(v_basis, 'scored_session_suggestion'), 'signals', r.signals));
      end if;
      vin_veh := null;
    end loop;
  end loop;
  if not p_dry then
    rc := record_capture_set_candidates(p_run, p_user, 'scored_session_v1', coalesce(cands,'[]'));
    if jsonb_array_length(items) > 0 then res := capture_sets_apply(p_run, p_user, items, 0.6); end if;
  end if;
  return jsonb_build_object('run_id', p_run, 'dry', p_dry, 'sets_scored', (select count(distinct set_key) from _cs),
    'would_file_photos', would_file, 'clear_sets', jsonb_array_length(items), 'review_sets', nrev, 'held_photos', held,
    'claims_vin_0_97', nclaim_vin, 'claims_plate_0_97', nclaim_plate, 'claims_suggestion_le_0_84', nclaim_sugg, 'candidates', rc, 'apply', res, 'items', items);
end $f$;

