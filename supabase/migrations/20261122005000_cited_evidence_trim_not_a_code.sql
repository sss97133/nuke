-- trim_not_a_code_v1: the cited-evidence rule refuses a bare plate, cowl-tag or gearbox code as a trim.
--
-- Why. accept_cited_field_evidence (cited_evidence_auto_accept_v1, 20261023130000) writes a pending, photo- or
-- document-cited field_evidence row into an empty vehicles column, or accepts it when it agrees with the column. A photo
-- reader's readings of a door data plate or cowl tag reached `trim` that way: on a 1966 Ford Mustang the plate's date
-- code "10A" filled `trim` on 2026-11-04 (after "67", the plate's trim code, filled it on 2026-11-03), and the garage card
-- headline reads "1966 Ford Mustang 10A". Of the rule's 49 trim decisions (cited_evidence_accept_log, 2026-11-21), the
-- code-shaped values were 10A and 67 (filled), and 10, 289, 400, 8400, 2500 (twice), U 67, 6 SPEED, A51 and SD-455
-- (conflicts). Every one of those decisions came from source_type ai_visual, which the live body has skipped since
-- about 2026-11-12 (see 2 below), so this closes the path for every other cited source and for a re-enabled ai_visual.
-- On the owner's garage (vehicle_class_price, 138 cars) the test refuses 12 trim evidence rows on 6 cars, and 1 car
-- shows one live ("10A").
--
-- The test, public.trim_value_is_code(value, make), and why it is this narrow. Measured read-only on 2026-11-21 over
-- every field_evidence trim row (236,783 rows, 11,160 distinct values) and every live vehicles.trim (164,097
-- vehicles, 13,602 distinct values), pulled in vehicle-id chunks (nuke-logs garage-walk-20261121/trim-rule):
--   * A make-blind "digits with at most one letter" test refuses 6,946 evidence rows and 4,069 vehicles, almost all
--     real trims of other makes: Lexus 470/430, Porsche 4S/911S, Mercedes 300E/190E/500E, BMW 335i/328i.
--   * A make-blind GM RPO shape (one letter, two digits) refuses 2,984 evidence rows, mostly marketed trims (Z06, Z28,
--     Z71, Z51, L88, E30). A51 is the only one read off a plate here, so RPO codes are not refused.
--   So the code shapes are refused only for the domestic US makes, where door data plates and cowl tags carry them,
--   and a gearbox ("6 SPEED") is refused for every make.
--   The chosen test, over the same corpus: it refuses 586 evidence rows (55 distinct values) and the live trim of 368
--   vehicles (55 distinct values). By class, evidence / vehicles: a displacement (427, 383, 440 on Plymouth, 409,
--   400) 416 / 263; a gearbox 55 / 37; a truck series (1500, 2500, 3100, 3200, 3600) 67 / 44; plate and body codes,
--   years and stray digits (10A, 67, U 67, 20A, 63A, 1962, 0, 8) 39 / 18; values whose meaning was not verified (150 on
--   Dodge, 114, 450, 503, 700) 9 / 6, the upper bound on real names refused. A displacement is not a trim under
--   record_facet_evidence's own engine-option test; a truck series is a model-level name. The numeric names these
--   makes market are kept for that make only, so a Ford plate's "62" or "88" is still refused: Cadillac 60/62/75,
--   Oldsmobile 88/98/442, Chevrolet 150/210/300, Buick 225, Chrysler 300, Ford 500, Dodge 170/270/440/500, AMC and
--   Rambler 220-990, International 800, GMC 3X (vPIC). Nothing existing is changed by this file; the counts say what
--   the test would decide if those values arrived as cited evidence.
--
-- What changes.
--   1. trim_value_is_code(text, text): IMMUTABLE, no table reads.
--   2. accept_cited_field_evidence: before choosing filled / agreed / conflict, a row for the trim column whose value is a
--      code is refused: evidence status 'rejected', a contradicting signal naming trim_not_a_code_v1, and a log row with
--      action 'refused' (prior status kept), so a refused row leaves the 200-row oldest-first window instead of being
--      rescanned every run. The agreed branch is covered too: a code that equals a code already in the column is refused,
--      not accepted. Everything else is the live body read 2026-11-21, including its exclusion of source_type
--      'ai_visual', which is live but was never committed (applied directly between 2026-11-09 and 2026-11-12; the
--      rule's last ai_visual decision is 2026-11-12 01:59Z). This file commits it.
--   3. revert_cited_evidence_run: a 'refused' log row restores the evidence status only (the rule touched neither the
--      column nor vehicle_field_provenance for it).
--   4. cited_evidence_accept_log.action admits 'refused' (1,558 rows, a CHECK swap under lock_timeout).
-- Not changed: the cron (live: 'cited-evidence-accept' at minute 59 hourly, also drift from the committed */10),
-- record_facet_evidence's own engine-option test (it keeps its regex; it may call this function later).
--
-- Existing junk is superseded after this deploys, through the sanctioned writers, never raw updates:
--   correct_field_evidence(ids, 'rejected', {ref: '20261122005000 trim_not_a_code_v1', reason}) for the accepted and
--   pending code-shaped trim evidence, then correct_vehicle_text_field(vehicle, 'trim', <code>, NULL, source, reason)
--   for a live column that holds one (prior value kept in superseded_rows). After the deploy, so no other pending
--   cited row can refill the column in between.
-- Contract: supabase/sql/test_cited_evidence_trim_not_a_code.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 0. Refuse to replace bodies that changed since they were read -----------------------------------------------------------
DO $guard$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.accept_cited_field_evidence(uuid,integer,uuid)'::regprocedure);
  IF md5(d) NOT IN ('45df8148a07e96b345f12ed3e93c5df4') -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
     AND position('trim_not_a_code_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'accept_cited_field_evidence changed since 2026-11-21 (md5 %); review before replacement', md5(d);
  END IF;
  d := pg_get_functiondef('public.revert_cited_evidence_run(uuid)'::regprocedure);
  IF md5(d) NOT IN ('16a74ef41ad32aeb2529257c654d0428') -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
     AND position('trim_not_a_code_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'revert_cited_evidence_run changed since 2026-11-21 (md5 %); review before replacement', md5(d);
  END IF;
END
$guard$;

-- 1. The test --------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trim_value_is_code(p_value text, p_make text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO pg_catalog, pg_temp
AS $function$
  SELECT CASE WHEN v IS NULL OR v = '' THEN false
    -- a gearbox is never a trim, whatever the make ("6 SPEED", "4-Speed", "5spd")
    WHEN v ~* '^\d\s*-?\s*(speed|spd)$' THEN true
    WHEN NOT coalesce(lower(btrim(p_make)) = ANY (ARRAY['ford', 'chevrolet', 'chevy', 'gmc', 'pontiac', 'oldsmobile',
           'buick', 'cadillac', 'dodge', 'plymouth', 'chrysler', 'mercury', 'lincoln', 'amc', 'american motors', 'jeep',
           'international', 'international harvester', 'studebaker', 'desoto', 'edsel', 'rambler', 'nash', 'hudson',
           'packard', 'willys', 'ram', 'imperial']), false) THEN false
    -- numbers that are marketed names on that make only (a Ford plate's "62" or "88" is still a code)
    WHEN (lower(btrim(p_make)), upper(v)) IN (('cadillac', '60'), ('cadillac', '62'), ('cadillac', '75'),
           ('oldsmobile', '88'), ('oldsmobile', '98'), ('oldsmobile', '442'), ('chevrolet', '150'), ('chevrolet', '210'),
           ('chevrolet', '300'), ('chevy', '150'), ('chevy', '210'), ('chevy', '300'), ('buick', '225'),
           ('chrysler', '300'), ('ford', '500'), ('dodge', '170'), ('dodge', '270'), ('dodge', '440'), ('dodge', '500'),
           ('gmc', '3X'), ('international', '800'), ('international harvester', '800'))
      THEN false
    WHEN lower(btrim(p_make)) IN ('amc', 'american motors', 'rambler')
         AND v = ANY (ARRAY['220', '330', '440', '550', '660', '770', '880', '990']) THEN false
    -- door data plate and cowl tag fields: a date code (10A), a body code (63A), a trim or paint code (67, 711), a style
    -- or series number (8400, 2500), a displacement (289, 400)
    WHEN v ~ '^\d{1,2}\s*[A-Za-z]?$' THEN true
    WHEN v ~ '^\d{3,5}$' THEN true
    -- a letter and a number apart ("U 67"); "Z 28" is the Camaro's Z28 written with a space
    WHEN v ~ '^[A-Za-z]\s+\d{1,3}$' AND upper(v) !~ '^Z\s+28$' THEN true
    ELSE false END
  FROM (SELECT btrim(p_value) AS v) x
$function$;
REVOKE ALL ON FUNCTION public.trim_value_is_code(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trim_value_is_code(text, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.trim_value_is_code(text, text) IS
  'trim_not_a_code_v1 (20261122005000): true when a trim value is a bare code, not a trim. Any make: a gearbox '
  '("6 SPEED"). Domestic US makes only: 1-2 digits with at most one letter (plate date, trim or paint code: 10A, 67), '
  'a bare 3-5 digit number (displacement, series or style number: 289, 2500, 8400), a letter and a number apart other '
  'than Z 28 (U 67); a numeric name the make markets is kept for that make only (Oldsmobile 88, Ford 500, Cadillac '
  '62, Dodge 440 ...). Other '
  'makes keep numeric trims (470, 4S, 300E, 335i).';

-- 2. The log admits a refusal ------------------------------------------------------------------------------------------------
ALTER TABLE public.cited_evidence_accept_log DROP CONSTRAINT IF EXISTS cited_evidence_accept_log_action_check;
ALTER TABLE public.cited_evidence_accept_log ADD CONSTRAINT cited_evidence_accept_log_action_check
  CHECK (action IN ('filled', 'agreed', 'conflict', 'provenance_only', 'refused'));

-- 3. The rule: the live body of 2026-11-21 plus the refusal -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_cited_field_evidence(p_run_id uuid, p_limit integer DEFAULT 200, p_vehicle_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record; col text; cur text; img uuid; doc text; prov jsonb; act text; mk text;
  n_filled int := 0; n_agreed int := 0; n_conflict int := 0; n_prov int := 0; n_refused int := 0;
begin
  perform set_config('lock_timeout', '3s', true);
  if p_run_id is null then raise exception 'accept_cited_field_evidence: run_id required'; end if;
  for r in
    select fe.* from field_evidence fe
    where fe.status = 'pending'
      and fe.source_type IS DISTINCT FROM 'ai_visual'
      and (p_vehicle_id is null or fe.vehicle_id = p_vehicle_id)
      and coalesce(btrim(fe.proposed_value), '') <> ''
      and (fe.raw_extraction_data ? 'photo_id' or fe.raw_extraction_data ? 'image_id' or fe.raw_extraction_data ? 'document_id')
    order by fe.created_at, fe.id
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    for update of fe skip locked
  loop
    img := null; doc := null;
    if coalesce(r.raw_extraction_data->>'photo_id', r.raw_extraction_data->>'image_id')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select i.id into img from vehicle_images i
       where i.id = coalesce(r.raw_extraction_data->>'photo_id', r.raw_extraction_data->>'image_id')::uuid
         and i.vehicle_id = r.vehicle_id and i.is_superseded is not true;
    end if;
    doc := nullif(btrim(r.raw_extraction_data->>'document_id'), '');
    continue when img is null and doc is null;   -- citation not resolvable: leave pending

    col := cited_evidence_column(r.field_name);
    select to_jsonb(p) into prov from vehicle_field_provenance p
     where p.vehicle_id = r.vehicle_id and p.field_name = coalesce(col, r.field_name);
    if col is not null then
      execute format('select %I::text from vehicles where id = $1', col) into cur using r.vehicle_id;
    else
      cur := null;
    end if;

    -- trim_not_a_code_v1 (20261122005000): a plate, cowl-tag or gearbox code is not a trim. Tested before the action
    -- is chosen, so a code that equals a code already in the column is refused too, never accepted as agreeing.
    if col = 'trim' then
      select v.make into mk from vehicles v where v.id = r.vehicle_id;
      if public.trim_value_is_code(r.proposed_value, mk) then
        insert into cited_evidence_accept_log(run_id, evidence_id, vehicle_id, field_name, column_name, action,
          proposed_value, prev_column_value, prev_evidence_status, prev_raw_extraction_data, prev_provenance)
        values (p_run_id, r.id, r.vehicle_id, r.field_name, col, 'refused', r.proposed_value, cur, r.status,
          r.raw_extraction_data, prov);
        update field_evidence set status = 'rejected',
          contradicting_signals = coalesce(contradicting_signals, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'rule', 'trim_not_a_code_v1', 'run_id', p_run_id, 'make', mk, 'existing_value', cur,
            'reason', 'a plate, cowl-tag or gearbox code is not a trim', 'at', now()))
         where id = r.id;
        n_refused := n_refused + 1;
        continue;
      end if;
    end if;

    act := case when col is null then 'provenance_only'
                when coalesce(btrim(cur), '') = '' then 'filled'
                when cited_evidence_values_agree(r.field_name, cur, r.proposed_value) then 'agreed'
                else 'conflict' end;

    insert into cited_evidence_accept_log(run_id, evidence_id, vehicle_id, field_name, column_name, action,
      proposed_value, prev_column_value, prev_evidence_status, prev_raw_extraction_data, prev_provenance)
    values (p_run_id, r.id, r.vehicle_id, r.field_name, col, act, r.proposed_value, cur, r.status,
      r.raw_extraction_data, prov);

    if act = 'conflict' then
      update field_evidence set status = 'conflicted',
        contradicting_signals = coalesce(contradicting_signals, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'rule', 'cited_evidence_auto_accept_v1', 'run_id', p_run_id, 'existing_value', cur, 'column', col, 'at', now()))
       where id = r.id;
      insert into vehicle_field_provenance(vehicle_id, field_name, current_value, conflicting_sources, updated_at)
      values (r.vehicle_id, col, cur, jsonb_build_array(jsonb_build_object('evidence_id', r.id, 'value', r.proposed_value,
        'image_id', img, 'document_id', doc, 'run_id', p_run_id)), now())
      on conflict (vehicle_id, field_name) do update set
        conflicting_sources = coalesce(vehicle_field_provenance.conflicting_sources, '[]'::jsonb) || excluded.conflicting_sources,
        updated_at = now();
      n_conflict := n_conflict + 1;
      continue;
    end if;

    if act = 'filled' then
      execute format('update vehicles set %I = $1 where id = $2', col) using r.proposed_value, r.vehicle_id;
    end if;

    update field_evidence set status = 'accepted', assigned_at = now(), assigned_by = 'cited_evidence_auto_accept_v1',
      -- an aliased field (registration_plate) is filed under its column so the field's provenance lists it
      field_name = case when col is not null and col <> r.field_name and not exists (select 1 from field_evidence x
        where x.vehicle_id = r.vehicle_id and x.field_name = col and x.source_type = r.source_type
          and x.proposed_value = r.proposed_value) then col else field_name end,
      raw_extraction_data = case when img is not null and not (coalesce(raw_extraction_data, '{}'::jsonb) ? 'photo_id')
        then coalesce(raw_extraction_data, '{}'::jsonb) || jsonb_build_object('photo_id', img) else raw_extraction_data end,
      supporting_signals = coalesce(supporting_signals, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'rule', 'cited_evidence_auto_accept_v1', 'run_id', p_run_id, 'action', act, 'image_id', img, 'document_id', doc, 'at', now()))
     where id = r.id;

    insert into vehicle_field_provenance(vehicle_id, field_name, current_value, total_confidence, confidence_factors,
      primary_source, supporting_sources, last_verified_at, last_verified_by, updated_at)
    values (r.vehicle_id, coalesce(col, r.field_name), case when act = 'agreed' then cur else r.proposed_value end,
      least(greatest(coalesce(r.source_confidence, 70), 0), 100),
      jsonb_build_object('rule', 'cited_evidence_auto_accept_v1', 'run_id', p_run_id, 'evidence_id', r.id,
        'image_id', img, 'document_id', doc, 'source_type', r.source_type),
      'field_evidence:' || r.source_type, array[coalesce('image:' || img::text, 'document:' || doc)], now(),
      'cited_evidence_auto_accept_v1', now())
    on conflict (vehicle_id, field_name) do update set
      current_value = excluded.current_value,
      total_confidence = greatest(coalesce(vehicle_field_provenance.total_confidence, 0), excluded.total_confidence),
      confidence_factors = coalesce(vehicle_field_provenance.confidence_factors, '{}'::jsonb) || excluded.confidence_factors,
      primary_source = coalesce(vehicle_field_provenance.primary_source, excluded.primary_source),
      supporting_sources = (select array_agg(distinct s) from unnest(coalesce(vehicle_field_provenance.supporting_sources, '{}') || excluded.supporting_sources) s),
      last_verified_at = now(), last_verified_by = excluded.last_verified_by, updated_at = now();

    if act = 'filled' then n_filled := n_filled + 1;
    elsif act = 'agreed' then n_agreed := n_agreed + 1;
    else n_prov := n_prov + 1; end if;
  end loop;
  return jsonb_build_object('run_id', p_run_id, 'filled', n_filled, 'agreed', n_agreed,
    'provenance_only', n_prov, 'accepted', n_filled + n_agreed + n_prov, 'conflicts', n_conflict,
    'refused', n_refused);
end $function$;
REVOKE ALL ON FUNCTION public.accept_cited_field_evidence(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;

-- 4. Revert: a refusal restores the evidence status only (trim_not_a_code_v1) -----------------------------------------------
CREATE OR REPLACE FUNCTION public.revert_cited_evidence_run(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare l record; n int := 0;
begin
  perform set_config('lock_timeout', '3s', true);
  for l in select * from cited_evidence_accept_log where run_id = p_run_id and reverted_at is null order by id desc loop
    -- trim_not_a_code_v1: the rule changed neither the column nor the provenance for a refusal
    if l.action = 'refused' then
      update field_evidence set status = l.prev_evidence_status,
        supporting_signals = coalesce(supporting_signals, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'rule', 'trim_not_a_code_v1', 'reverted_run_id', p_run_id, 'at', now()))
       where id = l.evidence_id;
      update cited_evidence_accept_log set reverted_at = now() where id = l.id;
      n := n + 1;
      continue;
    end if;
    if l.action = 'filled' and l.column_name is not null then
      execute format('update vehicles set %I = $1 where id = $2 and %I::text is not distinct from $3', l.column_name, l.column_name)
        using l.prev_column_value, l.vehicle_id, l.proposed_value;
    end if;
    update field_evidence set status = l.prev_evidence_status, raw_extraction_data = nullif(l.prev_raw_extraction_data, 'null'::jsonb),
      field_name = l.field_name,
      supporting_signals = coalesce(supporting_signals, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'rule', 'cited_evidence_auto_accept_v1', 'reverted_run_id', p_run_id, 'at', now()))
     where id = l.evidence_id;
    if l.prev_provenance is null then
      -- the run created the provenance row; empty its values instead of deleting
      update vehicle_field_provenance set current_value = null, total_confidence = null, confidence_factors = null,
        primary_source = null, supporting_sources = null, conflicting_sources = null, last_verified_by = null, updated_at = now()
       where vehicle_id = l.vehicle_id and field_name = coalesce(l.column_name, l.field_name);
    else
      update vehicle_field_provenance p set
        current_value = l.prev_provenance->>'current_value',
        total_confidence = (l.prev_provenance->>'total_confidence')::int,
        confidence_factors = nullif(l.prev_provenance->'confidence_factors', 'null'::jsonb),
        primary_source = l.prev_provenance->>'primary_source',
        supporting_sources = (select array_agg(x) from jsonb_array_elements_text(nullif(l.prev_provenance->'supporting_sources', 'null'::jsonb)) x),
        conflicting_sources = nullif(l.prev_provenance->'conflicting_sources', 'null'::jsonb),
        last_verified_at = (l.prev_provenance->>'last_verified_at')::timestamptz,
        last_verified_by = l.prev_provenance->>'last_verified_by', updated_at = now()
       where p.vehicle_id = l.vehicle_id and p.field_name = coalesce(l.column_name, l.field_name);
    end if;
    update cited_evidence_accept_log set reverted_at = now() where id = l.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('run_id', p_run_id, 'reverted', n);
end $function$;
REVOKE ALL ON FUNCTION public.revert_cited_evidence_run(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
