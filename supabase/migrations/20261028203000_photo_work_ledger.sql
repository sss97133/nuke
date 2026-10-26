-- Photo work ledger: the tools, equipment, parts and goods a person's own photos show, folded into assets, and the
-- work those photos document. Extends existing owners; no new table.
--
--   * image_analysis_records: one photo work reading per image (analysis_tier 1 = small vision model, 2 = escalation),
--     inferred_findings = {objects[], work{}, commerce{}, scene, place_kind, photo_work_pass}. vehicle_id is left NULL so
--     the table's read policy (public vehicle or vehicle owner) keeps these readings owner-private; the vehicle context
--     comes through image_id. A higher-tier reading supersedes the lower one (supersedes / superseded_by).
--   * assets: asset_type gains equipment, tool, part, material, goods. A photo-found asset is status 'pending',
--     visibility 'private', creator_id = the person whose photos found it, owner_id NULL: ownership is the person's
--     own confirmation, not a photo inference. attributes.fold_key = '<key>|<printed brand or ->'.
--   * asset_observations (empty until now; its DEPRECATED comment is replaced): one 'photo_sighting' row per asset per
--     photo per reading tier; observed_at = the photo's taken_at (event clock), created_at = ingest clock.
--   * record_photo_work_readings(person, readings): service-only writer. Refuses photos of other people, rows the
--     device gate marked rejected_personal and sensitive rows. Equipment, tools and goods fold into assets; parts and
--     materials fold only when loose, for sale or being moved (installed parts stay in the reading for the vehicle).
--   * photo_assets_read(person, kind, limit): the person's photo-found assets with first/last sighting, sighting days,
--     places, a holding reading (held / seen / in_transaction, labelled, never written to owner_id), any amount printed
--     on a commerce photo, and whether an expense cites it (the person's user_tools, a current book Expense record or a
--     receipt in the window first sighting -120 days .. +30 days naming the brand or the item type). No catalogue prices.
--   * photo_footprint_traces(person, year): the uncited held or in-transaction assets first seen that year, in the
--     external-trace shape of accounting_expense_footprints(p_external), which owns amount/date money matching.
--   * photo_work_proof_read(person, from, to): per skill documented in the photos, first and last day, days, photo span
--     hours (lower bound, capped at 10 h a day), vehicles and example image ids, plus documented days per month.
--     Documented by the person; performed-by stays unknown unless the reading saw the photographer's own hands.
-- Readers: SECURITY DEFINER, the person themself (auth.uid()) or service_role only; anon cannot execute.
-- Contract: supabase/sql/test_photo_work_ledger.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.assets DROP CONSTRAINT assets_asset_type_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_asset_type_check CHECK (asset_type = ANY (ARRAY['image'::text, 'vehicle'::text,
  'garment'::text, 'publication'::text, 'issue'::text, 'article'::text, 'shoot'::text,
  'equipment'::text, 'tool'::text, 'part'::text, 'material'::text, 'goods'::text]));

CREATE UNIQUE INDEX assets_creator_fold_key_uidx ON public.assets (creator_id, (attributes->>'fold_key'))
  WHERE attributes ? 'fold_key';
CREATE UNIQUE INDEX asset_observations_photo_sighting_uidx ON public.asset_observations (asset_id, source_identifier, extraction_method)
  WHERE kind = 'photo_sighting';
CREATE INDEX asset_observations_asset_observed_idx ON public.asset_observations (asset_id, observed_at);
CREATE UNIQUE INDEX image_analysis_records_photo_work_uidx ON public.image_analysis_records
  (image_id, (inferred_findings->>'photo_work_pass'), analysis_tier) WHERE inferred_findings ? 'photo_work_pass';

COMMENT ON TABLE public.asset_observations IS 'Testimony log for an asset (grain: one observation of one asset from one source). '
  'kind photo_sighting: one photo in which a photo work reading saw the asset; source_identifier = vehicle_images.id; '
  'observed_at = the photo''s taken_at (event clock), created_at = ingest clock; structured_data carries image_id, reading_id '
  '(image_analysis_records), role, model, text_read, place cell, vehicle_id and the photo''s commerce context. Writer: '
  'record_photo_work_readings (service role). Private: no anon/authenticated policies; read through photo_assets_read.';
COMMENT ON COLUMN public.assets.creator_id IS 'The person or source whose evidence created the asset row. For photo-found assets '
  '(attributes.fold_key) it is the photographer; owner_id stays NULL until the owner confirms ownership.';

CREATE FUNCTION public.record_photo_work_readings(p_person uuid, p_readings jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  r jsonb; o jsonb; img record; prior record;
  pass text; tier integer; rec_id uuid; aid uuid; k text; brand text; fold text; conf numeric; com jsonb;
  n_in integer := 0; n_new integer := 0; n_same integer := 0; n_refused integer := 0; n_assets integer := 0; n_sightings integer := 0;
  refused jsonb := '[]'::jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'record_photo_work_readings is service-only' USING ERRCODE = '42501';
  END IF;
  IF p_person IS NULL OR jsonb_typeof(p_readings) IS DISTINCT FROM 'array' OR jsonb_array_length(p_readings) > 500 THEN
    RAISE EXCEPTION 'p_readings must be a JSON array of at most 500 readings for one person' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT x FROM jsonb_array_elements(p_readings) x LOOP
    n_in := n_in + 1;
    pass := coalesce(nullif(r->>'pass', ''), 'photo_work_v1');
    tier := CASE WHEN r->>'tier' IN ('1', '2') THEN (r->>'tier')::integer ELSE 1 END;
    img := NULL;
    IF r->>'image_id' ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN
      SELECT i.id, i.user_id, i.vehicle_id, i.taken_at, i.latitude, i.longitude, i.vision_gate_status::text AS gate, i.is_sensitive
        INTO img FROM public.vehicle_images i WHERE i.id = (r->>'image_id')::uuid;
    END IF;
    IF img.id IS NULL OR img.user_id IS DISTINCT FROM p_person OR img.gate = 'rejected_personal' OR coalesce(img.is_sensitive, false)
       OR jsonb_typeof(r#>'{reading,objects}') IS DISTINCT FROM 'array' OR jsonb_typeof(r#>'{reading,work}') IS DISTINCT FROM 'object'
       OR jsonb_typeof(r#>'{reading,commerce}') IS DISTINCT FROM 'object' OR nullif(r->>'model', '') IS NULL THEN
      n_refused := n_refused + 1;
      refused := refused || jsonb_build_array(left(coalesce(r->>'image_id', '?'), 36));
      CONTINUE;
    END IF;
    SELECT a.id, a.analysis_tier INTO prior FROM public.image_analysis_records a
      WHERE a.image_id = img.id AND a.inferred_findings->>'photo_work_pass' = pass AND a.superseded_by IS NULL
      ORDER BY a.analysis_tier DESC LIMIT 1;
    IF prior.id IS NOT NULL AND prior.analysis_tier >= tier THEN n_same := n_same + 1; CONTINUE; END IF;

    SELECT avg(CASE WHEN x->>'confidence' ~ '^[0-9.]+$' THEN least((x->>'confidence')::numeric, 1) END) INTO conf
      FROM jsonb_array_elements(r#>'{reading,objects}') x;
    INSERT INTO public.image_analysis_records (image_id, vehicle_id, analysis_tier, analyzed_at, analyzed_by_model,
      confirmed_findings, inferred_findings, unknown_items, overall_confidence, citation_count, inference_count, unknown_count,
      supersedes, handoff_notes)
    VALUES (img.id, NULL, tier, CASE WHEN r->>'analyzed_at' ~ '^\d{4}-\d{2}-\d{2}T' THEN (r->>'analyzed_at')::timestamptz ELSE now() END,
      r->>'model',
      jsonb_build_object('text_read', (SELECT coalesce(jsonb_agg(x->>'text_read'), '[]'::jsonb) FROM jsonb_array_elements(r#>'{reading,objects}') x
        WHERE nullif(btrim(x->>'text_read'), '') IS NOT NULL)),
      (r->'reading') || jsonb_build_object('photo_work_pass', pass, 'usage', r->'usage'),
      '[]'::jsonb, round(conf, 3),
      (SELECT count(*) FROM jsonb_array_elements(r#>'{reading,objects}') x WHERE nullif(btrim(x->>'text_read'), '') IS NOT NULL),
      jsonb_array_length(r#>'{reading,objects}'), 0, prior.id,
      'photo work reading; vehicle_id left NULL to keep it owner-private, vehicle context via image_id')
    RETURNING id INTO rec_id;
    IF prior.id IS NOT NULL THEN
      UPDATE public.image_analysis_records SET superseded_by = rec_id, superseded_at = now(),
        superseded_reason = 'higher-tier photo work reading' WHERE id = prior.id;
    END IF;
    n_new := n_new + 1;
    com := CASE WHEN coalesce(r#>>'{reading,commerce,context}', 'none') <> 'none' THEN r#>'{reading,commerce}' END;

    FOR o IN SELECT x FROM jsonb_array_elements(r#>'{reading,objects}') x LOOP
      CONTINUE WHEN NOT (o->>'kind' IN ('equipment', 'tool', 'goods')
        OR (o->>'kind' IN ('part', 'material') AND o->>'role' IN ('loose', 'for_sale', 'being_moved')));
      CONTINUE WHEN NOT (o->>'confidence' ~ '^[0-9.]+$' AND (o->>'confidence')::numeric >= 0.5);
      k := nullif(regexp_replace(lower(coalesce(o->>'key', '')), '[^a-z0-9._]', '', 'g'), '');
      CONTINUE WHEN k IS NULL;
      brand := nullif(regexp_replace(lower(coalesce(o->>'brand', '')), '[^a-z0-9]', '', 'g'), '');
      IF brand IN ('unknown', 'null', 'none', 'generic', 'na', 'unbranded') THEN brand := NULL; END IF;
      fold := k || '|' || coalesce(brand, '-');
      aid := NULL;
      SELECT a.id INTO aid FROM public.assets a WHERE a.creator_id = p_person AND a.attributes->>'fold_key' = fold;
      IF aid IS NULL THEN
        INSERT INTO public.assets (asset_type, title, creator_id, owner_id, status, visibility, attributes)
        VALUES (o->>'kind', left(coalesce(nullif(btrim(o->>'label'), ''), k), 200), p_person, NULL, 'pending', 'private',
          jsonb_build_object('fold_key', fold, 'key', k, 'brand', nullif(btrim(o->>'brand'), ''), 'method', pass,
            'first_reading', rec_id, 'instance_resolved', false,
            'basis', 'photo sightings folded by item type and printed brand; ownership not established'))
        ON CONFLICT (creator_id, (attributes->>'fold_key')) WHERE attributes ? 'fold_key' DO NOTHING
        RETURNING id INTO aid;
        IF aid IS NULL THEN
          SELECT a.id INTO aid FROM public.assets a WHERE a.creator_id = p_person AND a.attributes->>'fold_key' = fold;
        ELSE
          n_assets := n_assets + 1;
        END IF;
      END IF;
      INSERT INTO public.asset_observations (asset_id, kind, observed_at, content_text, structured_data, confidence,
        source_identifier, extraction_method, agent_model)
      VALUES (aid, 'photo_sighting', img.taken_at, left(o->>'label', 300),
        jsonb_strip_nulls(jsonb_build_object('image_id', img.id, 'reading_id', rec_id, 'role', o->>'role', 'model', nullif(btrim(o->>'model'), ''),
          'text_read', nullif(btrim(o->>'text_read'), ''), 'count', o->'count', 'vehicle_id', img.vehicle_id,
          'cell', CASE WHEN img.latitude IS NOT NULL AND img.longitude IS NOT NULL
            THEN round(img.latitude::numeric, 3)::text || ',' || round(img.longitude::numeric, 3)::text END,
          'commerce', com, 'activity', nullif(r#>>'{reading,work,activity}', 'none'))),
        least((o->>'confidence')::numeric, 1), img.id::text, pass || ':t' || tier, r->>'model')
      ON CONFLICT (asset_id, source_identifier, extraction_method) WHERE kind = 'photo_sighting' DO NOTHING;
      IF FOUND THEN n_sightings := n_sightings + 1; END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('received', n_in, 'recorded', n_new, 'already_recorded', n_same, 'refused', n_refused,
    'refused_ids', refused, 'assets_created', n_assets, 'sightings_recorded', n_sightings);
END $$;
REVOKE ALL ON FUNCTION public.record_photo_work_readings(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_photo_work_readings(uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.record_photo_work_readings(uuid, jsonb) IS 'Service-only writer of photo work readings (image_analysis_records) '
  'and their fold into private pending assets + asset_observations photo sightings. Refuses other people''s photos, '
  'rejected_personal and sensitive rows. Idempotent per image, pass and tier; a higher tier supersedes.';

-- Internal fold: one jsonb per photo-found asset of the person, with sighting statistics, holding reading and citation.
CREATE FUNCTION public.photo_asset_fold(p_person uuid, p_kind text DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
  WITH home AS MATERIALIZED (   -- the person's recurring places: ~100 m cells with photos on 5 or more days
    SELECT round(i.latitude::numeric, 3)::text || ',' || round(i.longitude::numeric, 3)::text AS cell
    FROM public.vehicle_images i
    WHERE i.user_id = p_person AND i.latitude IS NOT NULL AND i.longitude IS NOT NULL AND i.taken_at IS NOT NULL
    GROUP BY 1 HAVING count(DISTINCT (i.taken_at AT TIME ZONE 'America/Los_Angeles')::date) >= 5
  ), s AS MATERIALIZED (
    SELECT a.id AS asset_id, a.asset_type, a.title, a.attributes, o.observed_at, o.confidence, o.structured_data AS sd,
           (o.observed_at AT TIME ZONE 'America/Los_Angeles')::date AS d
    FROM public.assets a
    JOIN public.asset_observations o ON o.asset_id = a.id AND o.kind = 'photo_sighting'
    JOIN public.image_analysis_records ar ON ar.id = (o.structured_data->>'reading_id')::uuid AND ar.superseded_by IS NULL
    WHERE a.creator_id = p_person AND a.attributes ? 'fold_key' AND (p_kind IS NULL OR a.asset_type = p_kind)
  ), stats AS (
    SELECT s.asset_id, min(s.asset_type) AS asset_type, min(s.title) AS title, (array_agg(s.attributes))[1] AS attributes,
      count(*) AS photos, count(DISTINCT s.d) AS days, min(s.observed_at) AS first_seen, max(s.observed_at) AS last_seen,
      count(DISTINCT s.sd->>'cell') AS places,
      count(*) FILTER (WHERE s.sd->>'cell' IN (SELECT cell FROM home)) AS photos_home,
      count(*) FILTER (WHERE s.sd->>'cell' IS NULL) AS photos_no_gps,
      count(*) FILTER (WHERE s.sd->>'role' IN ('for_sale', 'being_moved') OR s.sd ? 'commerce') AS photos_commerce,
      count(*) FILTER (WHERE s.sd->>'role' = 'in_use') AS photos_in_use,
      max(CASE WHEN s.sd#>>'{commerce,amount}' ~ '^[0-9]+(\.[0-9]+)?$' AND (s.sd->>'role' IN ('for_sale', 'being_moved')
            OR s.sd#>>'{commerce,context}' IN ('listing_screenshot', 'receipt', 'invoice', 'payment_screenshot', 'price_tag'))
          THEN (s.sd#>>'{commerce,amount}')::numeric END) AS amount_seen,
      (SELECT jsonb_agg(DISTINCT m) FROM unnest(array_agg(s.sd->>'model')) m WHERE m IS NOT NULL) AS models,
      (array_agg(s.sd->>'image_id' ORDER BY s.confidence DESC NULLS LAST, s.observed_at))[1:4] AS best_images,
      (array_agg(s.sd->>'image_id' ORDER BY s.observed_at NULLS LAST))[1] AS first_image,
      (array_agg(s.sd->>'image_id' ORDER BY s.sd ? 'commerce' DESC, s.observed_at) FILTER (WHERE s.sd ? 'commerce' OR s.sd->>'role' IN ('for_sale', 'being_moved')))[1:3] AS commerce_images,
      count(DISTINCT s.sd->>'vehicle_id') AS vehicles
    FROM s GROUP BY s.asset_id
  ), ranked AS (
    SELECT st.*,
      CASE WHEN st.photos_commerce > 0 AND st.days <= 2 THEN 'in_transaction'
           WHEN st.days >= 3 AND st.last_seen - st.first_seen >= interval '14 days'
                AND st.photos_home >= greatest(1, (st.photos - st.photos_no_gps) / 2) THEN 'held'
           WHEN st.photos_commerce > 0 THEN 'in_transaction'
           ELSE 'seen' END AS holding,
      array_remove(ARRAY[lower(st.attributes->>'brand'),
        replace(regexp_replace(st.attributes->>'key', '^.*\.', ''), '_', ' '),
        nullif(regexp_replace(lower(st.title), '^.*\s', ''), '')]
        || coalesce((SELECT array_agg(m.source_key) FROM public.tool_requirement_key_map m
             WHERE m.source_kind = 'tool_term' AND m.requirement_key = st.attributes->>'key'), '{}'), NULL) AS terms
    FROM stats st
    ORDER BY (st.amount_seen IS NOT NULL) DESC,
      CASE st.asset_type WHEN 'equipment' THEN 0 WHEN 'goods' THEN 1 WHEN 'tool' THEN 2 ELSE 3 END, st.days DESC, st.photos DESC
    LIMIT least(greatest(coalesce(p_limit, 200), 1), 500)
  ), terms AS (
    SELECT r.asset_id, array_agg(DISTINCT t) FILTER (WHERE length(t) >= 4 AND t NOT IN ('tool', 'part', 'parts', 'item', 'unit', 'other')) AS ts
    FROM ranked r, unnest(r.terms) t GROUP BY r.asset_id
  )
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'asset_id', r.asset_id, 'kind', r.asset_type, 'title', r.title, 'key', r.attributes->>'key', 'brand', r.attributes->>'brand',
    'models_read', r.models, 'photos', r.photos, 'sighting_days', r.days,
    'first_seen', r.first_seen, 'last_seen', r.last_seen, 'places', r.places, 'photos_at_recurring_places', r.photos_home,
    'photos_without_gps', r.photos_no_gps, 'photos_in_use', r.photos_in_use, 'photos_with_commerce', r.photos_commerce,
    'vehicles', r.vehicles, 'holding', r.holding,
    'amount', r.amount_seen, 'amount_basis', CASE WHEN r.amount_seen IS NOT NULL THEN 'document' ELSE 'unknown' END,
    'first_image_id', r.first_image, 'best_image_ids', to_jsonb(r.best_images), 'commerce_image_ids', to_jsonb(r.commerce_images),
    'cited_by', c.cited_by, 'citation', CASE WHEN c.cited_by IS NULL THEN 'uncited' ELSE c.cited_by->>'source' END,
    'match_terms', to_jsonb(tm.ts)))
  FROM ranked r
  LEFT JOIN terms tm ON tm.asset_id = r.asset_id
  LEFT JOIN LATERAL (
    SELECT coalesce(
      (SELECT jsonb_build_object('source', 'user_tools', 'id', u.id, 'date', coalesce(u.first_purchase_date, u.transaction_date))
       FROM public.user_tools u WHERE u.user_id = p_person AND tm.ts IS NOT NULL
         AND EXISTS (SELECT 1 FROM unnest(tm.ts) t WHERE strpos(lower(concat_ws(' ', u.brand, u.description, u.category)), t) > 0
           AND (r.attributes->>'brand' IS NULL OR t <> lower(r.attributes->>'brand')))
         AND (r.attributes->>'brand' IS NULL OR strpos(lower(coalesce(u.brand, '') || ' ' || coalesce(u.description, '')), lower(r.attributes->>'brand')) > 0)
       ORDER BY u.first_purchase_date NULLS LAST LIMIT 1),
      (SELECT jsonb_build_object('source', 'book', 'local_id', b.local_id, 'date', b.record_date)
       FROM public.v_financial_accounting_records b
       WHERE b.owner_id = p_person AND b.section = 'Expense' AND tm.ts IS NOT NULL
         AND b.record_date ~ '^\d{4}-\d{2}-\d{2}$'
         AND b.record_date::date BETWEEN (r.first_seen AT TIME ZONE 'America/Los_Angeles')::date - 120
                                     AND (r.first_seen AT TIME ZONE 'America/Los_Angeles')::date + 30
         AND EXISTS (SELECT 1 FROM unnest(tm.ts) t WHERE length(t) >= 5
           AND strpos(lower(concat_ws(' ', b.description, b.decision)), t) > 0)
       ORDER BY b.record_date LIMIT 1),
      (SELECT jsonb_build_object('source', 'receipt', 'id', p.id, 'date', coalesce(p.receipt_date, p.transaction_date, p.purchase_date))
       FROM public.receipts p
       WHERE p.user_id = p_person AND NOT coalesce(p.is_superseded, false) AND p.duplicate_of IS NULL AND tm.ts IS NOT NULL
         AND coalesce(p.receipt_date, p.transaction_date, p.purchase_date)::date
             BETWEEN (r.first_seen AT TIME ZONE 'America/Los_Angeles')::date - 120 AND (r.first_seen AT TIME ZONE 'America/Los_Angeles')::date + 30
         AND EXISTS (SELECT 1 FROM unnest(tm.ts) t WHERE length(t) >= 5
           AND strpos(lower(concat_ws(' ', p.vendor_name, p.part_number, left(p.raw_extraction::text, 4000))), t) > 0)
       ORDER BY coalesce(p.receipt_date, p.transaction_date, p.purchase_date) LIMIT 1)) AS cited_by
  ) c ON true
$$;
REVOKE ALL ON FUNCTION public.photo_asset_fold(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.photo_asset_fold(uuid, text, integer) TO service_role;
COMMENT ON FUNCTION public.photo_asset_fold(uuid, text, integer) IS 'Internal: the person''s photo-found assets with sighting '
  'statistics, holding reading and expense citation (user_tools, current book Expense records, receipts; window first sighting '
  '-120..+30 days; text names the brand or item type). Called by photo_assets_read and photo_footprint_traces.';

CREATE FUNCTION public.photo_assets_read(p_person uuid, p_kind text DEFAULT NULL, p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE rows jsonb;
BEGIN
  IF NOT ((auth.uid() IS NOT NULL AND auth.uid() = p_person) OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'photo_assets_read: only the person themself' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(f), '[]'::jsonb) INTO rows FROM public.photo_asset_fold(p_person, p_kind, p_limit) f;
  RETURN jsonb_build_object('person', p_person, 'as_of', statement_timestamp(), 'kind_filter', p_kind,
    'assets_total', (SELECT count(*) FROM public.assets a WHERE a.creator_id = p_person AND a.attributes ? 'fold_key'
      AND (p_kind IS NULL OR a.asset_type = p_kind)),
    'readings_total', (SELECT count(*) FROM public.image_analysis_records ar JOIN public.vehicle_images i ON i.id = ar.image_id
      WHERE i.user_id = p_person AND ar.inferred_findings ? 'photo_work_pass' AND ar.superseded_by IS NULL),
    'assets', rows,
    'basis', jsonb_build_object(
      'asset', 'photo sightings folded by item type and printed brand; one row can hold several physical items of that type',
      'holding', 'held = seen on 3+ days over 14+ days mostly at the person''s recurring places; in_transaction = a sale, listing, '
        'payment or hauling context; seen = otherwise. A reading of the photos, not ownership',
      'amount', 'document = printed on a commerce photo of the item; unknown otherwise (no catalogue prices)',
      'citation', 'user_tools, a current book Expense record or a receipt dated first sighting -120..+30 days whose text names the '
        'brand or item type; uncited = none found'));
END $$;
REVOKE ALL ON FUNCTION public.photo_assets_read(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_assets_read(uuid, text, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.photo_assets_read(uuid, text, integer) IS 'The person''s own photo-found tools, equipment, parts and goods '
  'with first/last sighting, holding reading, any printed amount and expense citation. Self or service role only.';

CREATE FUNCTION public.photo_footprint_traces(p_person uuid, p_year integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
BEGIN
  IF NOT ((auth.uid() IS NOT NULL AND auth.uid() = p_person) OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'photo_footprint_traces: only the person themself' USING ERRCODE = '42501';
  END IF;
  IF p_year IS NULL OR p_year NOT BETWEEN 1990 AND 2100 THEN RAISE EXCEPTION 'p_year out of range' USING ERRCODE = '22023'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(t ORDER BY t->>'date'), '[]'::jsonb) FROM (
    SELECT jsonb_strip_nulls(jsonb_build_object('ref', 'photo-asset-' || left(f->>'asset_id', 8), 'kind', 'photo_asset',
      'date', ((f->>'first_seen')::timestamptz AT TIME ZONE 'America/Los_Angeles')::date, 'amount', f->'amount',
      'vendor', f->>'brand', 'what', f->>'title',
      'where', 'photos: ' || (f->>'sighting_days') || ' days, ' || (f->>'holding') || ', asset ' || (f->>'asset_id'))) AS t
    FROM public.photo_asset_fold(p_person, NULL, 500) f
    WHERE f->>'citation' = 'uncited' AND f->>'holding' IN ('held', 'in_transaction') AND f->>'kind' <> 'material'
      AND extract(year FROM ((f->>'first_seen')::timestamptz AT TIME ZONE 'America/Los_Angeles')) = p_year
    LIMIT 500) x);
END $$;
REVOKE ALL ON FUNCTION public.photo_footprint_traces(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_footprint_traces(uuid, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.photo_footprint_traces(uuid, integer) IS 'Uncited held or in-transaction photo-found assets first seen in '
  'the year, as accounting_expense_footprints p_external traces (ref, kind photo_asset, date, amount, vendor, what, where).';

CREATE FUNCTION public.photo_work_proof_read(p_person uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE d0 date := coalesce(p_from, DATE '2000-01-01'); d1 date := coalesce(p_to, current_date); result jsonb;
BEGIN
  IF NOT ((auth.uid() IS NOT NULL AND auth.uid() = p_person) OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'photo_work_proof_read: only the person themself' USING ERRCODE = '42501';
  END IF;
  WITH rd AS MATERIALIZED (
    SELECT i.id AS image_id, i.vehicle_id, i.taken_at, (i.taken_at AT TIME ZONE 'America/Los_Angeles')::date AS d,
           ar.inferred_findings->'work' AS w
    FROM public.vehicle_images i
    JOIN public.image_analysis_records ar ON ar.image_id = i.id AND ar.inferred_findings ? 'photo_work_pass' AND ar.superseded_by IS NULL
    WHERE i.user_id = p_person AND i.taken_at IS NOT NULL
      AND i.taken_at >= (d0::timestamp AT TIME ZONE 'America/Los_Angeles') AND i.taken_at < ((d1 + 1)::timestamp AT TIME ZONE 'America/Los_Angeles')
      AND coalesce(ar.inferred_findings#>>'{work,activity}', 'none') NOT IN ('none', 'inspection')
  ), sk AS (
    SELECT DISTINCT rd.image_id, rd.vehicle_id, rd.taken_at, rd.d, rd.w->>'performer_visible' AS who,
      CASE WHEN jsonb_typeof(rd.w->'skill_keys') = 'array' AND jsonb_array_length(rd.w->'skill_keys') > 0
           THEN lower(btrim(s.k)) ELSE rd.w->>'activity' END AS skill
    FROM rd LEFT JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(rd.w->'skill_keys') = 'array' THEN rd.w->'skill_keys' END) s(k) ON true
  ), per_day AS (
    SELECT skill, d, count(*) AS photos, least(extract(epoch FROM max(taken_at) - min(taken_at)) / 3600.0, 10) AS span_h,
      bool_or(who = 'own_hands') AS own_hands, array_agg(DISTINCT vehicle_id) FILTER (WHERE vehicle_id IS NOT NULL) AS vids,
      (array_agg(image_id ORDER BY taken_at DESC))[1] AS img
    FROM sk WHERE nullif(skill, '') IS NOT NULL GROUP BY skill, d
  ), skills AS (
    SELECT skill, count(*) AS days, sum(photos) AS photos, round(sum(span_h)::numeric, 1) AS span_hours, min(d) AS first_day, max(d) AS last_day,
      count(*) FILTER (WHERE own_hands) AS own_hands_days,
      (SELECT count(DISTINCT v) FROM per_day p2, unnest(p2.vids) v WHERE p2.skill = per_day.skill) AS vehicles,
      (array_agg(img ORDER BY d DESC))[1:3] AS example_image_ids
    FROM per_day GROUP BY skill
  )
  SELECT jsonb_build_object('person', p_person, 'as_of', statement_timestamp(), 'from', d0, 'to', d1,
    'skills', coalesce((SELECT jsonb_agg(jsonb_build_object('skill', skill, 'days', days, 'photos', photos, 'photo_span_hours', span_hours,
        'first_day', first_day, 'last_day', last_day, 'own_hands_days', own_hands_days, 'vehicles', vehicles,
        'example_image_ids', to_jsonb(example_image_ids)) ORDER BY days DESC, skill) FROM skills), '[]'::jsonb),
    'work_days_by_month', coalesce((SELECT jsonb_object_agg(m, n ORDER BY m) FROM (SELECT to_char(d, 'YYYY-MM') AS m, count(DISTINCT d) AS n
        FROM sk GROUP BY 1) mm), '{}'::jsonb),
    'work_days', (SELECT count(DISTINCT d) FROM sk),
    'readings_in_range', (SELECT count(*) FROM public.vehicle_images i JOIN public.image_analysis_records ar ON ar.image_id = i.id
        AND ar.inferred_findings ? 'photo_work_pass' AND ar.superseded_by IS NULL
      WHERE i.user_id = p_person AND i.taken_at >= (d0::timestamp AT TIME ZONE 'America/Los_Angeles')
        AND i.taken_at < ((d1 + 1)::timestamp AT TIME ZONE 'America/Los_Angeles')),
    'basis', jsonb_build_object(
      'skill', 'a skill or activity the photo work reading saw documented; documented by this person, performer unknown unless own_hands',
      'photo_span_hours', 'per day, first to last photo of that skill, capped at 10 h: a lower bound on time, not a timesheet',
      'scope', 'photos with a current photo work reading only; unread photos are not counted'))
  INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.photo_work_proof_read(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_work_proof_read(uuid, date, date) TO authenticated, service_role;
COMMENT ON FUNCTION public.photo_work_proof_read(uuid, date, date) IS 'Per skill documented in the person''s own photos: days, first '
  'and last day, photo-span hours (lower bound), vehicles, examples, and documented work days per month. Self or service role only.';

NOTIFY pgrst, 'reload schema';
COMMIT;
