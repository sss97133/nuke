-- Contributor intake ladder: bands derive from the record, never from a typed-in number.
--
-- Skylar, 2026-10-29: "why arent you citing the data model youre just making up tables... fake band estimates
-- treated like fact" and "if we can build the data model with its reasoning we have a real amazing product."
-- Migration 20261105120000 stored band_low / band_high on vehicle_evidence_rungs and seeded the Firebird's from an
-- estimate file; it also seeded three items as 'contradicted' with no proof in the record. This migration:
--
--   1. Drops the stored bands. A rung carries a comps spec (jsonb): the population rule (make, model pattern, year
--      range, price basis, sale period) and ordered class rules (regex over the lot's listing title, trim and
--      description: a documented first-pass classifier). The band is computed at read time by
--      evidence_rung_band() over auction_events joined to vehicles with the same sold-lot rule get_comps_scored uses
--      (outcome = sold, not typed not-sold by page evidence, basis price > 0, vehicle live). It returns n, the
--      interquartile interval, the median, the as-of time, the auction_events ids that formed it, the reader name
--      and its parameters, and too_few_to_tell below the floor (5 lots). No number leaves the reader without its keys.
--   2. Puts the reasoning on the record: vehicle_evidence_changes.reasoning (inputs with keys, the rule applied, the
--      result) on every status move, and a reasoning block on every computed band in the reply.
--   3. Requires proof for any status other than open (CHECK), and resets the Firebird's three seeded contradictions
--      to open with a change row saying why: nothing in the record proves them yet; the frames are not in Nuke.
--
-- Rows the readers return are keyed: auction_events.id for lots, vehicle_evidence_items.key for claims,
-- vehicle_observations.id / vehicle_images.id for proof.

BEGIN;

-- 1. The rung's spec replaces its numbers.
ALTER TABLE public.vehicle_evidence_rungs
  DROP COLUMN IF EXISTS band_low,
  DROP COLUMN IF EXISTS band_high,
  DROP COLUMN IF EXISTS currency;
ALTER TABLE public.vehicle_evidence_rungs
  ADD COLUMN IF NOT EXISTS comps_spec jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(comps_spec) = 'object');
COMMENT ON TABLE public.vehicle_evidence_rungs IS
  'The value rungs one vehicle can stand on. A rung holds the evidence item keys it requires and a comps spec; its band is never stored: evidence_rung_band() derives it from sold auction_events at read time with n, interval, as-of and lot ids. basis is a human note, not the source of any number.';
COMMENT ON COLUMN public.vehicle_evidence_rungs.comps_spec IS
  'Population rule for the rung''s comps: {make, model_pattern (regex, case-insensitive), year_min, year_max, basis (hammer|gross_incl_premium|net_to_owner), since (date), class (the class this rung competes in), class_rules [{class, pattern}] applied in order to listing title + trim + description, first match wins, else "base"}.';

-- 2. Reasoning on every change.
ALTER TABLE public.vehicle_evidence_changes ADD COLUMN IF NOT EXISTS reasoning jsonb;
COMMENT ON COLUMN public.vehicle_evidence_changes.reasoning IS
  'Why the move happened: {inputs: {keys...}, rule: text, result: {...}}. Written by the writer that made the move.';

-- 3. A status other than open needs proof. Reset what was seeded without it first.
DO $reset$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.vehicle_evidence_items WHERE status <> 'open' AND proof_ref IS NULL LOOP
    UPDATE public.vehicle_evidence_items SET status = 'open', proof_kind = NULL, updated_at = now() WHERE id = r.id;
    INSERT INTO public.vehicle_evidence_changes (vehicle_id, item_key, from_status, to_status, reasoning)
    VALUES (r.vehicle_id, r.key, r.status, 'open', jsonb_build_object(
      'rule', 'a status other than open requires a proof_ref (observation or image id); this one was seeded without proof',
      'inputs', jsonb_build_object('item_key', r.key, 'seeded_note', r.note),
      'result', 'open until an observation or image in the record proves or contradicts it'));
  END LOOP;
END $reset$;
ALTER TABLE public.vehicle_evidence_items DROP CONSTRAINT IF EXISTS vehicle_evidence_items_status_needs_proof;
ALTER TABLE public.vehicle_evidence_items ADD CONSTRAINT vehicle_evidence_items_status_needs_proof
  CHECK (status = 'open' OR (proof_kind IS NOT NULL AND proof_ref IS NOT NULL));

-- 4. The band reader. Internal (the progress readers call it); bounded; every number with its keys.
CREATE OR REPLACE FUNCTION public.evidence_rung_band(p_vehicle_id uuid, p_spec jsonb, p_as_of timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_floor CONSTANT integer := 5;       -- below this many sold lots the reader says too few to tell
  c_scan CONSTANT integer := 2000;     -- lots scanned at most (newest first) for one rung
  v_make text := nullif(btrim(p_spec ->> 'make'), '');
  v_model_pattern text := coalesce(nullif(p_spec ->> 'model_pattern', ''), '.');
  v_year_min integer := nullif(p_spec ->> 'year_min', '')::integer;
  v_year_max integer := nullif(p_spec ->> 'year_max', '')::integer;
  v_basis text := coalesce(nullif(p_spec ->> 'basis', ''), 'hammer');
  v_since date := coalesce(nullif(p_spec ->> 'since', '')::date, '1900-01-01'::date);
  v_class text := coalesce(nullif(p_spec ->> 'class', ''), 'base');
  v_rules jsonb := CASE WHEN jsonb_typeof(p_spec -> 'class_rules') = 'array' THEN p_spec -> 'class_rules' ELSE '[]'::jsonb END;
  v_n integer := 0;
  v_low numeric; v_high numeric; v_median numeric;
  v_ids jsonb; v_counts jsonb;
  v_params jsonb;
BEGIN
  v_params := jsonb_build_object('make', v_make, 'model_pattern', v_model_pattern, 'year_min', v_year_min,
    'year_max', v_year_max, 'basis', v_basis, 'since', v_since, 'class', v_class, 'class_rules', v_rules,
    'floor', c_floor, 'scan_limit', c_scan, 'exclude_vehicle_id', p_vehicle_id);
  IF v_make IS NULL OR v_basis NOT IN ('hammer', 'gross_incl_premium', 'net_to_owner') THEN
    RETURN jsonb_build_object('reader', 'evidence_rung_band_v1', 'params', v_params, 'as_of', p_as_of, 'n', 0,
      'too_few_to_tell', true, 'lot_ids', '[]'::jsonb, 'class_counts', '{}'::jsonb,
      'error', 'spec needs a make and a price basis of hammer, gross_incl_premium or net_to_owner');
  END IF;
  -- The population: sold lots of the make / model pattern / years, same rule as get_comps_scored, within the period,
  -- newest first, bounded. Each lot is classed by the first class rule its text matches, else base.
  WITH lots AS (
    SELECT ae.id, ae.auction_end_date,
           CASE v_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price ELSE ae.net_to_owner END AS price,
           lower(coalesce(v.bat_listing_title, '') || ' ' || coalesce(v.listing_title, '') || ' ' || coalesce(v.trim, '')
                 || ' ' || left(coalesce(v.description, ''), 4000)) AS t
      FROM public.auction_events ae
      JOIN public.vehicles v ON v.id = ae.vehicle_id
     WHERE v.make ILIKE v_make AND v.model ~* v_model_pattern
       AND (v_year_min IS NULL OR v.year >= v_year_min) AND (v_year_max IS NULL OR v.year <= v_year_max)
       AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL AND v.id IS DISTINCT FROM p_vehicle_id
       AND ae.outcome = 'sold' AND NOT public.auction_event_typed_not_sold(ae.vehicle_id, ae.source_url)
       AND ae.auction_end_date >= v_since AND ae.auction_end_date <= p_as_of
       AND (CASE v_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price ELSE ae.net_to_owner END) > 0
     ORDER BY ae.auction_end_date DESC
     LIMIT c_scan),
  classed AS (
    SELECT l.*, coalesce((SELECT r ->> 'class' FROM jsonb_array_elements(v_rules) WITH ORDINALITY AS t(r, ord)
                           WHERE l.t ~ (r ->> 'pattern') ORDER BY ord LIMIT 1), 'base') AS cls
      FROM lots l)
  SELECT count(*) FILTER (WHERE cls = v_class),
         percentile_cont(0.25) WITHIN GROUP (ORDER BY price) FILTER (WHERE cls = v_class),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY price) FILTER (WHERE cls = v_class),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FILTER (WHERE cls = v_class),
         coalesce((SELECT jsonb_agg(c2.id ORDER BY c2.auction_end_date DESC) FROM classed c2 WHERE c2.cls = v_class), '[]'::jsonb),
         coalesce((SELECT jsonb_object_agg(k.cls, k.n) FROM (SELECT cls, count(*) AS n FROM classed GROUP BY cls) k), '{}'::jsonb)
    INTO v_n, v_low, v_high, v_median, v_ids, v_counts
    FROM classed;
  RETURN jsonb_build_object(
    'reader', 'evidence_rung_band_v1',
    'params', v_params,
    'as_of', p_as_of,
    'n', v_n,
    'too_few_to_tell', v_n < c_floor,
    'low', CASE WHEN v_n >= c_floor THEN round(v_low) END,
    'high', CASE WHEN v_n >= c_floor THEN round(v_high) END,
    'median', CASE WHEN v_n >= c_floor THEN round(v_median) END,
    'interval', 'p25 to p75 of ' || v_basis || ' prices',
    'lot_ids', v_ids,
    'class_counts', v_counts,
    'reasoning', jsonb_build_object(
      'inputs', jsonb_build_object('table', 'auction_events join vehicles', 'lot_ids', v_ids, 'n', v_n, 'as_of', p_as_of),
      'rule', format('sold lots of %s %s %s-%s since %s, classed by the spec''s rules (first match, else base), class %s; band = p25 to p75 of %s prices; too few to tell under %s lots',
                     v_make, v_model_pattern, coalesce(v_year_min::text, '*'), coalesce(v_year_max::text, '*'), v_since, v_class, v_basis, c_floor),
      'result', CASE WHEN v_n >= c_floor THEN jsonb_build_object('low', round(v_low), 'high', round(v_high), 'median', round(v_median))
                     ELSE jsonb_build_object('too_few_to_tell', true, 'n', v_n) END));
END $$;
COMMENT ON FUNCTION public.evidence_rung_band(uuid, jsonb, timestamptz) IS
  'One rung''s band from the record: sold auction_events lots matching the spec, classed by its rules, p25-p75 of the basis price, with n, as-of and the lot ids. Below 5 lots: too_few_to_tell. Scans at most 2000 lots, newest first.';
REVOKE ALL ON FUNCTION public.evidence_rung_band(uuid, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;

-- 5. The progress block: every rung carries its derived band and reasoning. band_low / band_high remain in the
--    reply as the derived p25 / p75 (null when too few to tell) so the page keeps rendering; `band` holds the keys.
CREATE OR REPLACE FUNCTION public.contributor_intake_progress_for(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_proven text[];
  v_rungs jsonb;
  v_current jsonb;
  v_next jsonb;
  v_last jsonb;
  v_as_of timestamptz := now();
BEGIN
  SELECT coalesce(array_agg(key), '{}') INTO v_proven FROM public.vehicle_evidence_items
   WHERE vehicle_id = p_vehicle_id AND status = 'proven';
  WITH r AS (
    SELECT g.*, ARRAY(SELECT x FROM jsonb_array_elements_text(g.requirements) x) AS req,
           public.evidence_rung_band(p_vehicle_id, g.comps_spec, v_as_of) AS band
      FROM public.vehicle_evidence_rungs g WHERE g.vehicle_id = p_vehicle_id),
  s AS (
    SELECT r.*, (r.req <@ v_proven) AS reached,
           ARRAY(SELECT x FROM unnest(r.req) x WHERE NOT (x = ANY (v_proven))) AS missing
      FROM r),
  t AS (
    SELECT s.*, bool_and(s.reached) OVER (ORDER BY s.position ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS standing
      FROM s)
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'position', t.position, 'label', t.label,
           'band_low', t.band -> 'low', 'band_high', t.band -> 'high', 'band', t.band, 'basis', t.basis,
           'comps_spec', t.comps_spec, 'requirements', t.requirements, 'reached', t.reached, 'standing', t.standing,
           'missing', to_jsonb(t.missing)) ORDER BY t.position), '[]'::jsonb),
         (SELECT jsonb_build_object('key', x.key, 'position', x.position, 'label', x.label,
            'band_low', x.band -> 'low', 'band_high', x.band -> 'high', 'band', x.band, 'basis', x.basis)
            FROM t x WHERE x.standing ORDER BY x.position DESC LIMIT 1)
    INTO v_rungs, v_current
    FROM t;
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', n.key, 'label', n.label, 'kind', n.kind,
           'satisfied_by', n.satisfied_by, 'question_key', CASE WHEN n.kind = 'question' THEN n.satisfied_by END,
           'for_rung', n.for_rung)
           ORDER BY n.rung_position, n.position, n.key), '[]'::jsonb)
    INTO v_next
    FROM (
      SELECT d.* FROM (
        SELECT DISTINCT ON (it.key) it.key, it.label, it.kind, it.satisfied_by, it.position,
               g.key AS for_rung, g.position AS rung_position
          FROM public.vehicle_evidence_items it
          JOIN public.vehicle_evidence_rungs g ON g.vehicle_id = it.vehicle_id AND g.requirements ? it.key
         WHERE it.vehicle_id = p_vehicle_id AND it.status = 'open'
           AND NOT (ARRAY(SELECT x FROM jsonb_array_elements_text(g.requirements) x) <@ v_proven)
         ORDER BY it.key, g.position) d
       ORDER BY d.rung_position, d.position, d.key LIMIT 3) n;
  SELECT jsonb_build_object('at', c.changed_at, 'what', c.item_key, 'from_status', c.from_status, 'to_status', c.to_status,
           'moved_from', c.rung_from, 'moved_to', c.rung_to, 'proof_kind', c.proof_kind, 'proof_ref', c.proof_ref,
           'reasoning', c.reasoning)
    INTO v_last
    FROM public.vehicle_evidence_changes c WHERE c.vehicle_id = p_vehicle_id ORDER BY c.changed_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'as_of', v_as_of,
    'rung', v_current,
    'rungs', v_rungs,
    'proven', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', i.key, 'label', i.label, 'kind', i.kind,
        'satisfied_by', i.satisfied_by, 'proof_kind', i.proof_kind, 'proof_ref', i.proof_ref, 'note', i.note,
        'updated_at', i.updated_at) ORDER BY i.position, i.key), '[]'::jsonb)
      FROM public.vehicle_evidence_items i WHERE i.vehicle_id = p_vehicle_id AND i.status = 'proven'),
    'open', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', i.key, 'label', i.label, 'kind', i.kind,
        'satisfied_by', i.satisfied_by, 'note', i.note) ORDER BY i.position, i.key), '[]'::jsonb)
      FROM public.vehicle_evidence_items i WHERE i.vehicle_id = p_vehicle_id AND i.status = 'open'),
    'contradicted', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', i.key, 'label', i.label, 'kind', i.kind,
        'satisfied_by', i.satisfied_by, 'proof_kind', i.proof_kind, 'proof_ref', i.proof_ref, 'note', i.note,
        'updated_at', i.updated_at) ORDER BY i.position, i.key), '[]'::jsonb)
      FROM public.vehicle_evidence_items i WHERE i.vehicle_id = p_vehicle_id AND i.status = 'contradicted'),
    'counts', (SELECT jsonb_build_object('proven', count(*) FILTER (WHERE status = 'proven'),
        'open', count(*) FILTER (WHERE status = 'open'), 'contradicted', count(*) FILTER (WHERE status = 'contradicted'))
      FROM public.vehicle_evidence_items WHERE vehicle_id = p_vehicle_id),
    'next', v_next,
    'last_change', v_last);
END $$;

-- 6. The move writer records its reasoning. Body otherwise as merged in 20261105120000.
CREATE OR REPLACE FUNCTION public.contributor_intake_after_input(p_invite public.vehicle_contributor_invites,
  p_action text, p_ref uuid, p_question_key text, p_label text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it public.vehicle_evidence_items;
  v_before jsonb;
  v_after jsonb;
  v_rung_from text;
  v_rung_to text;
  v_owner uuid;
  v_name text;
  v_title text;
  v_msg text;
  v_match text := lower(btrim(coalesce(p_question_key, p_label, '')));
  v_matched_on text;
BEGIN
  v_before := public.contributor_intake_progress_for(p_invite.vehicle_id);
  v_rung_from := v_before #>> '{rung,key}';
  IF v_match <> '' THEN
    SELECT * INTO it FROM public.vehicle_evidence_items
     WHERE vehicle_id = p_invite.vehicle_id AND status = 'open'
       AND (lower(coalesce(satisfied_by, '')) = v_match OR key = v_match OR lower(label) = v_match)
     ORDER BY (lower(coalesce(satisfied_by, '')) = v_match) DESC, position LIMIT 1;
    IF it.id IS NOT NULL THEN
      v_matched_on := CASE WHEN lower(coalesce(it.satisfied_by, '')) = v_match THEN 'satisfied_by'
                           WHEN it.key = v_match THEN 'key' ELSE 'label' END;
      UPDATE public.vehicle_evidence_items SET status = 'proven',
        proof_kind = CASE WHEN p_action = 'upload' THEN 'image' ELSE 'observation' END, proof_ref = p_ref, updated_at = now()
       WHERE id = it.id;
      v_after := public.contributor_intake_progress_for(p_invite.vehicle_id);
      v_rung_to := v_after #>> '{rung,key}';
      INSERT INTO public.vehicle_evidence_changes (vehicle_id, item_key, from_status, to_status, rung_from, rung_to,
        proof_kind, proof_ref, invite_id, reasoning)
      VALUES (p_invite.vehicle_id, it.key, 'open', 'proven', v_rung_from, v_rung_to,
        CASE WHEN p_action = 'upload' THEN 'image' ELSE 'observation' END, p_ref, p_invite.id,
        jsonb_build_object(
          'inputs', jsonb_build_object('action', p_action, 'proof_ref', p_ref, 'invite_id', p_invite.id,
            'match_text', v_match, 'matched_on', v_matched_on, 'item_key', it.key),
          'rule', 'an open item whose satisfied_by, key or label equals the input''s question key or file label is proven by that input; the rung is the highest whose requirements are all proven with every lower rung reached',
          'result', jsonb_build_object('item', it.key, 'from', 'open', 'to', 'proven', 'rung_from', v_rung_from, 'rung_to', v_rung_to)));
      v_after := public.contributor_intake_progress_for(p_invite.vehicle_id);
    END IF;
  END IF;
  IF v_after IS NULL THEN v_after := v_before; END IF;
  INSERT INTO public.contributor_intake_reevaluations (vehicle_id, invite_id, observation_id, image_id)
  VALUES (p_invite.vehicle_id, p_invite.id, CASE WHEN p_action = 'upload' THEN NULL ELSE p_ref END,
    CASE WHEN p_action = 'upload' THEN p_ref END)
  ON CONFLICT DO NOTHING;
  BEGIN
    SELECT v.user_id INTO v_owner FROM public.vehicles v WHERE v.id = p_invite.vehicle_id;
    SELECT e.display_name INTO v_name FROM public.contributors c JOIN public.external_identities e ON e.id = c.external_identity_id
     WHERE c.id = p_invite.contributor_id;
    IF v_owner IS NOT NULL THEN
      v_title := coalesce(v_name, 'A contributor') || CASE WHEN p_action = 'upload' THEN ' sent a file' ELSE ' answered' END;
      v_msg := CASE WHEN it.id IS NULL THEN 'No evidence item changed.'
                    WHEN v_rung_to IS DISTINCT FROM v_rung_from THEN
                      format('%s proven. The car moved from %s to %s.', it.label, coalesce(v_before #>> '{rung,label}', 'no rung'),
                        coalesce(v_after #>> '{rung,label}', v_rung_to))
                    ELSE format('%s proven. Still on %s; next: %s.', it.label, coalesce(v_after #>> '{rung,label}', 'no rung'),
                      coalesce(v_after #>> '{next,0,label}', 'nothing open')) END;
      PERFORM public.create_notification(v_owner, 'contributor_intake_progress', v_title, v_msg, p_invite.vehicle_id, NULL,
        jsonb_strip_nulls(jsonb_build_object('invite_id', p_invite.id, 'action', p_action, 'ref_id', p_ref,
          'item_key', it.key, 'rung_from', v_rung_from, 'rung_to', v_rung_to,
          'action_url', '/vehicle/' || p_invite.vehicle_id)), 1);
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'contributor_intake_after_input: notification failed: %', SQLERRM;
  END;
  RETURN v_after;
EXCEPTION WHEN others THEN
  RAISE WARNING 'contributor_intake_after_input: %', SQLERRM;
  RETURN coalesce(v_after, v_before);
END $$;

-- 7. The Firebird's rungs: specs in place of numbers. basis becomes the note of what each rung competes with.
--    Guarded on the rows existing; the seed in 20261105120000 is not repeated.
UPDATE public.vehicle_evidence_rungs SET
  comps_spec = jsonb_build_object('make', 'Pontiac', 'model_pattern', 'firebird', 'year_min', 1970, 'year_max', 1973,
    'basis', 'hammer', 'since', '2022-01-01', 'class', 'base',
    'class_rules', '[{"class":"sd","pattern":"super duty|sd-455|sd455|\\msd\\M"},{"class":"clone","pattern":"clone|tribute|re-creation|recreation|replica"},{"class":"trans_am","pattern":"trans am"}]'::jsonb),
  basis = 'Sold 1970-73 Firebird lots since 2022 whose listing text names neither Trans Am, SD nor a clone: the class a six-cylinder-born base coupe with a 455 and Trans Am hardware sells in before its numbers are photographed. The band is the reader''s, not this note''s.',
  updated_at = now()
 WHERE vehicle_id = '20d21fb0-4651-4469-a0ba-e751309a1e54' AND key = 'as_photographed';
UPDATE public.vehicle_evidence_rungs SET
  comps_spec = jsonb_build_object('make', 'Pontiac', 'model_pattern', 'firebird', 'year_min', 1970, 'year_max', 1973,
    'basis', 'hammer', 'since', '2022-01-01', 'class', 'trans_am',
    'class_rules', '[{"class":"sd","pattern":"super duty|sd-455|sd455|\\msd\\M"},{"class":"clone","pattern":"clone|tribute|re-creation|recreation|replica"},{"class":"trans_am","pattern":"trans am"}]'::jsonb),
  basis = 'Sold 1970-73 lots since 2022 whose listing text names Trans Am but not SD or a clone: the class the car is built to present as once the underside is detailed and every engine number is in a frame. Clone-labelled lots are counted beside it (class_counts) and are too few to form their own band. The band is the reader''s, not this note''s.',
  updated_at = now()
 WHERE vehicle_id = '20d21fb0-4651-4469-a0ba-e751309a1e54' AND key = 'numbers_photographed';
UPDATE public.vehicle_evidence_rungs SET
  comps_spec = jsonb_build_object('make', 'Pontiac', 'model_pattern', 'firebird', 'year_min', 1970, 'year_max', 1973,
    'basis', 'hammer', 'since', '2022-01-01', 'class', 'sd',
    'class_rules', '[{"class":"sd","pattern":"super duty|sd-455|sd455|\\msd\\M"},{"class":"clone","pattern":"clone|tribute|re-creation|recreation|replica"},{"class":"trans_am","pattern":"trans am"}]'::jsonb),
  basis = 'Sold 1970-73 lots since 2022 whose listing text names Super Duty or SD-455: the roof a buyer measures an SD-parts build against, since a real one can still be bought. The block itself is a 1970 455 casting and the listing says so. The band is the reader''s, not this note''s.',
  updated_at = now()
 WHERE vehicle_id = '20d21fb0-4651-4469-a0ba-e751309a1e54' AND key = 'sd_parts_proven';

COMMIT;
