-- The asset-lot walk runs on its own and reports its own throughput (fleet rule: success = rows landed, not exit 0).
-- Follows 20261108170000_asset_lots.sql. Extends existing owners; no new table.
--   * asset_lot_next_department(source, departments[]): the department of the slice furthest behind the house's own count
--     (lowest landed / house lots from the latest house_department_facet census; ties to the larger department). Service-only;
--     the walk calls it when no department is named, so one cron job covers the whole slice.
--   * asset_lot_coverage: department names now also come from the landed rows (a house facet that shares one name across two
--     codes, Bonhams Automobilia = MOT-AUT + COL-AUT, left them null).
--   * asset_lot_walk_health(source): lots landed in the last hour and day, current totals, last landing clock, departments
--     touched in the last day. Counts only; anon, authenticated and service_role may read it.
--   * record_asset_lots: a lot's high bid when it did not sell (Mecum "bid goes on", Bonhams passed lots) is kept as
--     structured_data.high_bid and enters the content hash; the v1 body is otherwise unchanged.
--   * cron asset-lots-bonhams-walk, every 10 minutes at :07: POST extract-bonhams-typesense {mode: art_land, pages: 2}
--     (2 index reads of 250, 2 s apart; the function backs off on 403/429). Revert: SELECT cron.unschedule('asset-lots-bonhams-walk').
-- Contract: supabase/sql/test_asset_lots.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.record_asset_lots(p_source_slug text, p_lots jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  src record; l jsonb; aid uuid; prior_id uuid; ikey text; atype text; sid text; method text; hash text; obs_at timestamptz;
  obs_basis text; sd jsonb; inserted_asset boolean; new_obs uuid;
  n_in integer := 0; n_assets_new integer := 0; n_assets_existing integer := 0; n_obs_new integer := 0; n_obs_same integer := 0;
  n_superseded integer := 0; n_refused integer := 0; refused jsonb := '[]'::jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'record_asset_lots is service-only' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_lots) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lots) > 500 THEN
    RAISE EXCEPTION 'p_lots must be a JSON array of at most 500 lots' USING ERRCODE = '22023';
  END IF;
  SELECT s.id, s.slug, coalesce(s.base_trust_score, 0.5) AS trust INTO src FROM public.observation_sources s WHERE s.slug = p_source_slug;
  IF src.id IS NULL THEN
    RAISE EXCEPTION 'unknown observation source %', p_source_slug USING ERRCODE = '22023';
  END IF;

  FOR l IN SELECT x FROM jsonb_array_elements(p_lots) x LOOP
    n_in := n_in + 1;
    ikey := nullif(btrim(l->>'identity_key'), '');
    atype := nullif(btrim(l->>'asset_type'), '');
    sid := nullif(btrim(l->>'source_identifier'), '');
    method := coalesce(nullif(btrim(l->>'extraction_method'), ''), 'asset_lot_v1');
    IF ikey IS NULL OR ikey !~ ('^' || src.slug || ':[A-Za-z0-9_.-]{1,80}$')
       OR atype IS NULL OR atype NOT IN ('artwork', 'automobilia', 'memorabilia')
       OR sid IS NULL OR nullif(btrim(l->>'title'), '') IS NULL
       OR NOT ((l->>'observed_at') ~ '^\d{4}-\d{2}-\d{2}T') THEN
      n_refused := n_refused + 1;
      refused := refused || jsonb_build_array(left(coalesce(ikey, sid, '?'), 120));
      CONTINUE;
    END IF;
    obs_at := (l->>'observed_at')::timestamptz;
    obs_basis := coalesce(nullif(l->>'observed_at_basis', ''), 'index_read');

    -- The asset: one row per presentation. The house's category is a claim in attributes; the type is ours.
    inserted_asset := false;
    INSERT INTO public.assets (asset_type, title, description, status, visibility, attributes)
    VALUES (atype, left(l->>'title', 500), NULL, 'active', 'public',
      jsonb_strip_nulls(jsonb_build_object(
        'identity_key', ikey, 'identity_basis', 'lot_presentation', 'source', src.slug,
        'house_category', l->>'department_name', 'house_category_code', l->>'department_code',
        'first_lot', sid, 'first_seen_at', obs_at)))
    ON CONFLICT ((attributes->>'identity_key')) WHERE attributes ? 'identity_key' DO NOTHING
    RETURNING id INTO aid;
    IF aid IS NOT NULL THEN
      inserted_asset := true; n_assets_new := n_assets_new + 1;
    ELSE
      SELECT a.id INTO aid FROM public.assets a WHERE a.attributes->>'identity_key' = ikey;
      n_assets_existing := n_assets_existing + 1;
    END IF;

    -- The lot as testimony. The hash is the result as the house states it; a changed result appends and supersedes.
    sd := jsonb_strip_nulls(jsonb_build_object(
      'department_code', l->>'department_code', 'department_name', l->>'department_name',
      'house_group', l->>'house_group', 'lot_number', l->>'lot_number',
      'sale_key', l->>'sale_key', 'sale_name', l->>'sale_name', 'sale_ends_at', l->>'sale_ends_at',
      'result', coalesce(l->>'result', 'unknown'), 'price_basis', l->>'price_basis',
      'hammer_price', l->'hammer_price', 'hammer_premium', l->'hammer_premium', 'high_bid', l->'high_bid',
      'estimate_low', l->'estimate_low', 'estimate_high', l->'estimate_high', 'currency', l->>'currency',
      'lines', l->'lines', 'symbols', l->'symbols', 'image_url', l->>'image_url', 'footnotes', l->>'footnotes',
      'country', l->>'country', 'observed_at_basis', obs_basis, 'ts_page', l->'ts_page', 'ts_pass', l->'ts_pass',
      'identity_basis', 'lot_presentation'));
    hash := md5(concat_ws('|', ikey, sid, method, sd->>'result', sd->>'hammer_price', sd->>'hammer_premium',
      sd->>'estimate_low', sd->>'estimate_high', sd->>'sale_ends_at', sd->>'high_bid'));

    SELECT o.id INTO prior_id FROM public.asset_observations o
      WHERE o.asset_id = aid AND o.kind = 'auction_lot' AND o.source_identifier = sid AND o.extraction_method = method
        AND o.superseded_by IS NULL
      ORDER BY o.created_at DESC LIMIT 1;

    INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash,
      confidence, source_url, source_identifier, extraction_method, supersedes)
    VALUES (aid, src.id, 'auction_lot', obs_at, left(l->>'catalog_text', 8000), sd, hash, src.trust, l->>'source_url', sid, method,
      CASE WHEN prior_id IS NOT NULL THEN prior_id END)
    ON CONFLICT (asset_id, source_identifier, extraction_method, content_hash) WHERE kind = 'auction_lot' DO NOTHING
    RETURNING id INTO new_obs;
    IF new_obs IS NULL THEN
      n_obs_same := n_obs_same + 1;
    ELSE
      n_obs_new := n_obs_new + 1;
      IF prior_id IS NOT NULL THEN
        UPDATE public.asset_observations SET superseded_by = new_obs WHERE id = prior_id AND superseded_by IS NULL;
        n_superseded := n_superseded + 1;
      END IF;
      IF NOT inserted_asset THEN UPDATE public.assets SET updated_at = now() WHERE id = aid; END IF;
    END IF;
    aid := NULL; prior_id := NULL; new_obs := NULL;
  END LOOP;

  RETURN jsonb_build_object('source_id', src.id, 'source_slug', src.slug, 'in', n_in, 'assets_new', n_assets_new,
    'assets_existing', n_assets_existing, 'observations_new', n_obs_new, 'observations_same', n_obs_same,
    'observations_superseded', n_superseded, 'refused', n_refused, 'refused_keys', refused);
END $$;
CREATE OR REPLACE FUNCTION public.asset_lot_next_department(p_source_slug text, p_departments text[])
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN auth.role() IS DISTINCT FROM 'service_role' THEN NULL ELSE (
    SELECT c.department_code
    FROM public.asset_lot_coverage(p_source_slug) c
    WHERE c.department_code = ANY (p_departments) AND coalesce(c.house_lots, 0) > 0
    ORDER BY c.landed_lots::numeric / c.house_lots ASC, c.house_lots DESC, c.department_code
    LIMIT 1) END
$$;
REVOKE ALL ON FUNCTION public.asset_lot_next_department(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asset_lot_next_department(text, text[]) TO service_role;
COMMENT ON FUNCTION public.asset_lot_next_department(text, text[]) IS 'The slice department furthest behind the house''s own lot count '
  '(latest house_department_facet census), for the walk to take next. Null when no census row names any of the departments.';

CREATE OR REPLACE FUNCTION public.asset_lot_coverage(p_source_slug text)
RETURNS TABLE (department_code text, department_name text, house_lots integer, house_priced_lots integer, landed_lots bigint,
               landed_priced_lots bigint, first_sale_year integer, last_sale_year integer, census_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH src AS (SELECT s.id FROM public.observation_sources s WHERE s.slug = p_source_slug),
  census AS (
    SELECT c.by_category, c.raw_response, c.census_at FROM public.source_census c JOIN src ON src.id = c.source_id
    WHERE c.census_method = 'house_department_facet' ORDER BY c.census_at DESC LIMIT 1),
  house AS (
    SELECT kv.key AS code, (kv.value)::text::integer AS lots,
           nullif(census.raw_response->'priced'->>kv.key, '')::integer AS priced,
           census.raw_response->'names'->>kv.key AS name, census.census_at
    FROM census, jsonb_each(census.by_category) kv),
  landed AS (
    SELECT o.structured_data->>'department_code' AS code,
           max(o.structured_data->>'department_name') AS name,
           count(DISTINCT o.asset_id) AS lots,
           count(DISTINCT o.asset_id) FILTER (WHERE (o.structured_data->>'hammer_price')::numeric > 0) AS priced,
           min(extract(year FROM o.observed_at))::integer AS first_year, max(extract(year FROM o.observed_at))::integer AS last_year
    FROM public.asset_observations o JOIN src ON src.id = o.source_id
    WHERE o.kind = 'auction_lot' AND o.superseded_by IS NULL
    GROUP BY 1)
  SELECT coalesce(house.code, landed.code), coalesce(house.name, landed.name), house.lots, house.priced,
         coalesce(landed.lots, 0), coalesce(landed.priced, 0), landed.first_year, landed.last_year, house.census_at
  FROM house FULL OUTER JOIN landed ON landed.code = house.code
  ORDER BY coalesce(landed.lots, 0) DESC, house.lots DESC NULLS LAST
$$;

CREATE OR REPLACE FUNCTION public.asset_lot_walk_health(p_source_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
  WITH src AS (SELECT s.id FROM public.observation_sources s WHERE s.slug = p_source_slug),
  o AS (SELECT o.asset_id, o.created_at, o.structured_data->>'department_code' AS code
        FROM public.asset_observations o JOIN src ON src.id = o.source_id WHERE o.kind = 'auction_lot')
  SELECT jsonb_build_object(
    'source', p_source_slug,
    'landed_last_hour', (SELECT count(*) FROM o WHERE o.created_at > now() - interval '1 hour'),
    'landed_last_day', (SELECT count(*) FROM o WHERE o.created_at > now() - interval '1 day'),
    'observations', (SELECT count(*) FROM o),
    'assets', (SELECT count(DISTINCT o.asset_id) FROM o),
    'last_landed_at', (SELECT max(o.created_at) FROM o),
    'departments_last_day', (SELECT coalesce(jsonb_object_agg(code, n), '{}'::jsonb) FROM (SELECT code, count(*) n FROM o WHERE o.created_at > now() - interval '1 day' GROUP BY 1) d),
    'read_at', now())
$$;
GRANT EXECUTE ON FUNCTION public.asset_lot_walk_health(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.asset_lot_walk_health(text) IS 'Throughput of the asset-lot walk for one source: lots landed in the last hour and day '
  '(ingest clock), current totals, last landing, departments touched. The check behind cron asset-lots-bonhams-walk; counts only.';

DO $job$
BEGIN
  -- Nested, because a disposable contract database has no cron schema and the planner resolves cron.job before the IF runs.
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'asset-lots-bonhams-walk') THEN
    EXECUTE $s$ SELECT cron.schedule('asset-lots-bonhams-walk', '7-59/10 * * * *', $c$
      SELECT net.http_post(
        url := get_service_url() || '/functions/v1/extract-bonhams-typesense',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || get_service_role_key_for_cron()
        ),
        body := '{"mode": "art_land", "pages": 2}'::jsonb,
        timeout_milliseconds := 120000
      );
    $c$) $s$;
  END IF;
END $job$;
COMMIT;
