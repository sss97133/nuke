-- Photo identifier admission uses the existing writer and tables. No backfill,
-- worker activation, grant change or canonical VIN update. Review/deploy separately.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';
DO $guard$ BEGIN
  IF pg_get_functiondef('public.land_identifier_claims(uuid,jsonb,text,text,text,uuid,uuid)'::regprocedure)
     IS DISTINCT FROM $expected$CREATE OR REPLACE FUNCTION public.land_identifier_claims(p_vehicle_id uuid, p_read jsonb, p_source_url text, p_extractor text, p_source_kind text DEFAULT 'listing_text'::text, p_source_image_id uuid DEFAULT NULL::uuid, p_run_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v record; c jsonb; n int := 0; rr record; v_rule_body text; v_body text;
BEGIN
  SELECT id, make, model FROM vehicles WHERE id = p_vehicle_id INTO v;
  IF v.id IS NULL THEN RETURN jsonb_build_object('status','no_vehicle'); END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(p_read->'identifiers','[]')) LOOP
    SELECT * INTO rr FROM identifier_rule_for(v.make, v.model, c->>'kind', c->>'value');
    INSERT INTO vehicle_identifiers (vehicle_id, kind, value, make_canonical, source_kind, source_url, source_image_id, quote,
      extractor, run_id, confidence, rule_id, rule_status)
    VALUES (p_vehicle_id, c->>'kind', c->>'value', upper(normalize_make(v.make)), p_source_kind, p_source_url, p_source_image_id,
      left(c->>'quote', 400), p_extractor, p_run_id,
      least(1, greatest(0, (c->>'confidence')::numeric + CASE WHEN rr.rule_status = 'in_range' THEN 0.1 WHEN rr.rule_status = 'out_of_range' THEN -0.3 ELSE 0 END)),
      rr.rule_id, CASE WHEN c->>'value' IS NULL THEN 'unchecked' ELSE rr.rule_status END)
    ON CONFLICT DO NOTHING;
    IF c->>'kind' = 'chassis' AND rr.rule_status = 'in_range' THEN v_rule_body := coalesce(v_rule_body, rr.body_style); END IF;
  END LOOP;
  -- Body-style precedence: title, then the chassis rule range, then description text.
  v_body := CASE WHEN p_read->>'body_style_basis' = 'title' THEN p_read->>'body_style'
                 ELSE coalesce(v_rule_body, p_read->>'body_style') END;
  -- Vehicle labels: fill only when empty; never overwrite a human or earlier value.
  UPDATE vehicles SET
    is_replica = coalesce(is_replica, CASE WHEN (p_read->>'is_replica')::boolean THEN true END),
    replica_quote = coalesce(replica_quote, p_read->>'replica_quote'),
    numbers_state = coalesce(numbers_state, p_read->>'numbers_claim'),
    numbers_quote = coalesce(numbers_quote, p_read->>'numbers_quote'),
    numbers_documented_by = coalesce(numbers_documented_by, nullif(ARRAY(SELECT jsonb_array_elements_text(p_read->'documented_by')), '{}')),
    canonical_body_style = coalesce(canonical_body_style, CASE WHEN (p_read->>'is_replica')::boolean THEN NULL ELSE v_body END),
    body_style_quote = coalesce(body_style_quote, p_read->>'body_style_quote')
  WHERE id = p_vehicle_id;
  RETURN jsonb_build_object('status','ok');
END $function$
$expected$ THEN
    RAISE EXCEPTION 'land_identifier_claims owner drifted; review current definition';
  END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.land_identifier_claims(p_vehicle_id uuid, p_read jsonb, p_source_url text, p_extractor text, p_source_kind text DEFAULT 'listing_text'::text, p_source_image_id uuid DEFAULT NULL::uuid, p_run_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v record; c jsonb; n int := 0; rr record; v_rule_body text; v_body text;
  image_row record; cited jsonb := p_read->'cited_vin'; yr_index integer; vin_read jsonb;
  fields_written integer := 0; identifiers_written integer := 0;
BEGIN
  -- The source attachment and both evidence writes share one transaction. A
  -- concurrent unfile/reassignment must acquire this same image row lock.
  -- Lock photo before vehicle, matching attribution and image bookkeeping.
  IF p_source_kind = 'photo' THEN
    SELECT id, vehicle_id, image_url, is_superseded INTO image_row
      FROM vehicle_images WHERE id=p_source_image_id FOR UPDATE;
    IF image_row.id IS NULL OR image_row.vehicle_id IS DISTINCT FROM p_vehicle_id
       OR image_row.is_superseded IS TRUE OR image_row.image_url IS DISTINCT FROM p_source_url THEN
      RETURN jsonb_build_object('status','source_image_changed');
    END IF;
  END IF;
  SELECT id, make, model, year, vin FROM vehicles WHERE id = p_vehicle_id FOR UPDATE INTO v;
  IF v.id IS NULL THEN RETURN jsonb_build_object('status','no_vehicle'); END IF;
  IF cited IS NOT NULL THEN
    -- Optional, bounded input to this existing writer, currently only for the
    -- new pre-1981 physical-VIN path. Legacy callers retain their old envelope.
    IF p_source_kind IS DISTINCT FROM 'photo' OR jsonb_typeof(cited) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_read->'identifiers') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_read->'identifiers') <> 1 THEN
      RETURN jsonb_build_object('status','invalid_vin_citation');
    END IF;
    vin_read := p_read->'identifiers'->0;
    IF vin_read->>'kind' IS DISTINCT FROM 'vin'
       OR cited->>'admission_basis' IS DISTINCT FROM 'pre1981_physical_plate'
       OR cited->>'evidence_role' NOT IN ('vehicle_vin_plate','vehicle_vin_stamp')
       OR coalesce(cited->>'evidence_role','')=''
       OR cited->'checksum_ok' IS DISTINCT FROM 'null'::jsonb
       OR cited->>'checksum_status' IS DISTINCT FROM 'not_applicable_pre1981'
       OR jsonb_typeof(cited->'confidence') IS DISTINCT FROM 'number'
       OR (cited->>'confidence')::numeric NOT BETWEEN 0.9 AND 1
       OR coalesce(length(vin_read->>'value'),0) NOT BETWEEN 5 AND 16
       OR NOT ((vin_read->>'value') = ANY(regexp_split_to_array(upper(coalesce(vin_read->>'quote','')), '[^A-Z0-9]+')))
       OR length(coalesce(vin_read->>'quote','')) > 400 THEN
      RETURN jsonb_build_object('status','invalid_vin_citation');
    END IF;
    SELECT * INTO rr FROM identifier_rule_for(v.make,v.model,'vin',vin_read->>'value');
    -- Same registered layouts as 20261023000700_identifier_rules_pre1981_seed.
    yr_index := CASE rr.series WHEN 'GM 13-char 1965-71' THEN 6 WHEN 'GM 13-char 1971' THEN 6
      WHEN 'GM 13-char 1972-80' THEN 6 WHEN 'Chevrolet 12-char 1960-64' THEN 1
      WHEN 'Ford 11-char 1960-80' THEN 1 WHEN 'Mopar 13-char 1966-80' THEN 6 END;
    IF v.year IS NULL OR v.year NOT BETWEEN 1886 AND 1980
       OR rr.rule_status IS DISTINCT FROM 'in_range' OR yr_index IS NULL
       OR rr.model_year_from IS NULL OR rr.model_year_to IS NULL
       OR v.year NOT BETWEEN rr.model_year_from AND rr.model_year_to
       OR substring(vin_read->>'value',yr_index,1) IS DISTINCT FROM (v.year % 10)::text
       OR cited->>'model_year_context' IS DISTINCT FROM v.year::text
       OR cited->>'identifier_rule_id' IS DISTINCT FROM rr.rule_id::text
       OR cited->>'identifier_rule_series' IS DISTINCT FROM rr.series
       OR (nullif(btrim(v.vin),'') IS NOT NULL
           AND regexp_replace(upper(v.vin),'[[:space:]/.\-]','','g') IS DISTINCT FROM vin_read->>'value') THEN
      RETURN jsonb_build_object('status','vin_context_changed');
    END IF;
    INSERT INTO field_evidence(vehicle_id,field_name,proposed_value,source_type,source_confidence,extraction_context,raw_extraction_data)
    VALUES(p_vehicle_id,'vin',vin_read->>'value','ai_visual',79,
      left('photo-pipeline VIN (pre1981_physical_plate): '||(vin_read->>'quote'),400),
      jsonb_build_object('photo_id',p_source_image_id,'image_id',p_source_image_id,'image_url',image_row.image_url,
        'quote',vin_read->>'quote','confidence',cited->'confidence','checksum_ok',NULL,
        'checksum_status','not_applicable_pre1981','identifier_kind','vin','evidence_role',cited->>'evidence_role',
        'admission_basis','pre1981_physical_plate','model_year_context',v.year,'model_year_basis','vehicles.year',
        'identifier_rule_id',rr.rule_id,'identifier_rule_series',rr.series,'extractor',p_extractor,
        'prompt_version',left(cited->>'prompt_version',80)))
    ON CONFLICT (vehicle_id,field_name,source_type,proposed_value) DO NOTHING;
    GET DIAGNOSTICS fields_written = ROW_COUNT;
  END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(p_read->'identifiers','[]')) LOOP
    SELECT * INTO rr FROM identifier_rule_for(v.make, v.model, c->>'kind', c->>'value');
    INSERT INTO vehicle_identifiers (vehicle_id, kind, value, make_canonical, source_kind, source_url, source_image_id, quote,
      extractor, run_id, confidence, rule_id, rule_status)
    VALUES (p_vehicle_id, c->>'kind', c->>'value', upper(normalize_make(v.make)), p_source_kind, p_source_url, p_source_image_id,
      left(c->>'quote', 400), p_extractor, p_run_id,
      least(1, greatest(0, (c->>'confidence')::numeric + CASE WHEN rr.rule_status = 'in_range' THEN 0.1 WHEN rr.rule_status = 'out_of_range' THEN -0.3 ELSE 0 END)),
      rr.rule_id, CASE WHEN c->>'value' IS NULL THEN 'unchecked' ELSE rr.rule_status END)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    identifiers_written := identifiers_written + n;
    IF c->>'kind' = 'chassis' AND rr.rule_status = 'in_range' THEN v_rule_body := coalesce(v_rule_body, rr.body_style); END IF;
  END LOOP;
  -- Body-style precedence: title, then the chassis rule range, then description text.
  v_body := CASE WHEN p_read->>'body_style_basis' = 'title' THEN p_read->>'body_style'
                 ELSE coalesce(v_rule_body, p_read->>'body_style') END;
  -- Vehicle labels: fill only when empty; never overwrite a human or earlier value.
  UPDATE vehicles SET
    is_replica = coalesce(is_replica, CASE WHEN (p_read->>'is_replica')::boolean THEN true END),
    replica_quote = coalesce(replica_quote, p_read->>'replica_quote'),
    numbers_state = coalesce(numbers_state, p_read->>'numbers_claim'),
    numbers_quote = coalesce(numbers_quote, p_read->>'numbers_quote'),
    numbers_documented_by = coalesce(numbers_documented_by, nullif(ARRAY(SELECT jsonb_array_elements_text(p_read->'documented_by')), '{}')),
    canonical_body_style = coalesce(canonical_body_style, CASE WHEN (p_read->>'is_replica')::boolean THEN NULL ELSE v_body END),
    body_style_quote = coalesce(body_style_quote, p_read->>'body_style_quote')
  WHERE id = p_vehicle_id;
  RETURN jsonb_build_object('status','ok','field_evidence',fields_written,'identifiers',identifiers_written);
END $function$;

-- Retained photo claims also withdraw at read time, after a later attribution
-- change. This extends the existing reader; no testimony is rewritten.
DO $reader_guard$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.identifier_consensus(uuid,text)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex') <> '426c50e54778df1bb27c8a9142e5be5e065c502652eddfa7b08130508775da1a' THEN
   RAISE EXCEPTION 'identifier_consensus owner drifted; review current definition';
 END IF;
END $reader_guard$;
CREATE OR REPLACE FUNCTION public.identifier_consensus(p_vehicle_id uuid, p_kind text DEFAULT 'vin'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with gate as (
  select v.id, v.vin from public.vehicles v
  where v.id = p_vehicle_id and ((v.is_public = true and v.deleted_at is null) or auth.uid() in (v.user_id, v.owner_id, v.uploaded_by))
), claims as (
  select i.*,
    coalesce(i.evidence_class, case i.source_kind
      when 'photo' then 'photo_text' when 'title' then 'document' when 'kardex' then 'document'
      when 'coa' then 'document' when 'owner' then 'owner' when 'listing_text' then 'listing_text'
      else 'legacy_column' end) as ev
  from public.vehicle_identifiers i join gate g on g.id = i.vehicle_id
  where i.superseded_at is null
    -- A withdrawn or inaccessible photo no longer supports identifier authority.
    -- Listing/document/owner claims remain independently attributed.
    and (i.source_kind <> 'photo' or exists (
      select 1 from public.vehicle_images source_image
      where source_image.id=i.source_image_id and source_image.vehicle_id=i.vehicle_id
        and source_image.image_url=i.source_url
        and nullif(btrim(source_image.image_url),'') is not null
        and source_image.is_superseded is not true and source_image.is_sensitive is not true
        and source_image.is_duplicate is not true
        and (source_image.vision_gate_status is null or source_image.vision_gate_status::text='approved')
        and coalesce(source_image.image_vehicle_match_status,'') not in ('mismatch','unrelated')))
    and (i.kind = p_kind or (p_kind = 'vin' and i.kind in ('vin','chassis')))
  union all
  -- the bare column is itself a (weak) claim when no backfilled row exists for it
  select null, g.id, 'vin', g.vin, upper(regexp_replace(g.vin, '[\s\-/.]', '', 'g')), null, null,
         'legacy_vin_column', null, null, null, 'vehicles.vin', null, null, null, 'unchecked', now(), null,
         'legacy_column', null, null, 'column:vehicles.vin', 'legacy_column'
  from gate g
  where p_kind = 'vin' and nullif(btrim(g.vin), '') is not null
    and not exists (select 1 from public.vehicle_identifiers x where x.vehicle_id = g.id
      and x.source_kind = 'legacy_vin_column' and x.superseded_at is null
      and x.value_norm = upper(regexp_replace(g.vin, '[\s\-/.]', '', 'g')))
), grouped as (
  -- a partial read (digits only) supports the longer value it prefixes when the rest is a short letter suffix
  select c.*, coalesce((select max(o.value_norm) from claims o
      where o.value_norm <> c.value_norm and c.value_norm ~ '^[0-9]+$'
        and left(o.value_norm, length(c.value_norm)) = c.value_norm
        and substr(o.value_norm, length(c.value_norm)+1) ~ '^[A-Z]{1,3}$'), c.value_norm) as grp
  from claims c
), weighted as (
  select g.*,
    coalesce(g.independence_key, g.contributor_id::text,
      case when g.source_kind = 'photo' then 'photo:' else 'text:' end
        || coalesce(substring(g.source_url from '^https?://(?:www\.)?([^/]+)'), g.extractor, 'unknown')) as fam,
    least(0.9, (case g.ev when 'plate_stamping' then 0.60 when 'document' then 0.50 when 'registry' then 0.50
        when 'listing_text' then 0.35 when 'owner' then 0.35 when 'photo_text' then 0.25 else 0.20 end)
      * greatest(0.3, least(1.6, coalesce(ct.trust_mean, 0.5) / 0.5))) as w
  from grouped g
  left join public.contributor_trust ct on ct.contributor_id = g.contributor_id and ct.family = 'identity'
), ranked as (
  select w2.*, row_number() over (partition by grp, fam order by w desc) as rk from weighted w2
), fam as (
  select grp, fam, 1 - exp(sum(ln(1 - least(0.95, w * case when rk = 1 then 1 else 0.3 end)))) as fw
  from ranked group by grp, fam
), val as (
  select f.grp, 1 - exp(sum(ln(1 - least(0.95, f.fw)))) as conf, count(*) as independent_sources
  from fam f group by f.grp
), ordered as (
  select v.*, row_number() over (order by conf desc, grp) as pos from val v
), summary as (
  select o.grp, o.conf, o.independent_sources, o.pos,
    (select count(*) from weighted w where w.grp = o.grp) as citations,
    (select count(distinct w.source_image_id) from weighted w where w.grp = o.grp and w.source_image_id is not null) as images,
    (select array_agg(distinct coalesce(substring(w.source_url from '^https?://(?:www\.)?([^/.]+)'), w.extractor))
       from weighted w where w.grp = o.grp and w.source_image_id is null) as text_sources,
    (select jsonb_object_agg(ev, n) from (select ev, count(*) n from weighted w where w.grp = o.grp group by ev) e) as evidence_mix,
    (select array_agg(distinct rule_status) from weighted w where w.grp = o.grp and rule_status in ('out_of_range','no_rule')) as rule_flags,
    (select w.value from weighted w where w.grp = o.grp and w.value_norm = o.grp
       order by case w.ev when 'plate_stamping' then 0 when 'document' then 1 when 'listing_text' then 2 else 3 end, w.observed_at
       limit 1) as display_value
  from ordered o
), top as (select * from summary where pos = 1), second as (select * from summary where pos = 2)
select case when not exists (select 1 from gate) then null else jsonb_build_object(
  'kind', p_kind,
  'status', case when not exists (select 1 from top) then 'none'
    when (select conf from top) * (1 - coalesce((select conf from second), 0)) >= 0.5
         and coalesce((select conf from second), 0) < 0.5 * (select conf from top) then 'resolved'
    when exists (select 1 from second) then 'conflict' else 'weak' end,
  'canonical_value', case when (select conf from top) * (1 - coalesce((select conf from second), 0)) >= 0.5
         and coalesce((select conf from second), 0) < 0.5 * (select conf from top)
    then (select display_value from top) end,
  'confidence', round(((select conf from top) * (1 - coalesce((select conf from second), 0)))::numeric, 3),
  'citation_summary', (select citations || case when citations = 1 then ' source' else ' sources' end || ': '
      || concat_ws(' + ', case when images > 0 then images || case when images = 1 then ' image' else ' images' end end,
                   case when text_sources is not null then array_to_string(text_sources, ', ') || ' text' end)
     from top),
  'values', coalesce((select jsonb_agg(jsonb_build_object('value', s.display_value, 'value_norm', s.grp,
      'confidence', round(s.conf::numeric, 3), 'independent_sources', s.independent_sources,
      'citations', s.citations, 'images', s.images, 'text_sources', to_jsonb(s.text_sources),
      'evidence_mix', s.evidence_mix, 'rule_flags', to_jsonb(s.rule_flags)) order by s.pos) from summary s), '[]'::jsonb),
  'shared_with_vehicles', (select count(*) from public.vehicles o, top t
     where upper(trim(o.vin)) in (t.grp, upper(trim(t.display_value))) and o.id <> p_vehicle_id
       and o.status is distinct from 'merged' and o.deleted_at is null),
  'method', 'identifier_consensus_v1'
) end
$function$;
COMMIT;
