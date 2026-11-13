-- record_asset_lots carries a house's price semantics, premium schedule and printed lot symbols (PR #3176, Christie's art ingester).
-- Follows 20261108200000_asset_lot_walk.sql (the v2 body), unchanged except:
--   * structured_data keeps four more statements when a lot sends them, each as the house printed or stated it:
--       price_semantics   what the printed price is and the house statement it rests on (Christie's: "Price realised" =
--                         hammer price plus buyer's premium, 2025 year-end release, https://press.christies.com/62b-projected-global-sales-in-2025/)
--       premium_schedule  the buyer's premium schedule in force for the sale's site and date, rows as printed, with its page URL
--       symbols_printed   the lot page's symbols_list as printed ([{code, version, symbol, name, description}], e.g. S02 "Third
--                         party guarantee"); symbols keeps the display labels the profile already renders
--       symbols_basis     where they came from (lot_page_symbols_list)
--   * the content hash is extended only when one of these is present, so lots without them (every Bonhams row) hash exactly as
--     before and nothing landed is re-superseded; symbols read later from a lot page append a new version.
-- No reader changes; asset_profile_read already passes symbols through. Nothing is derived (no hammer backed out of a premium price).
-- Contract: supabase/sql/test_asset_lots_house_statements.sql (PG17). DRAFT: not applied.
-- Rollback: re-run the record_asset_lots body of 20261108200000_asset_lot_walk.sql. Rows written meanwhile keep their keys.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.record_asset_lots(p_source_slug text, p_lots jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  src record; l jsonb; aid uuid; prior_id uuid; ikey text; atype text; sid text; method text; hash text; obs_at timestamptz;
  obs_basis text; sd jsonb; inserted_asset boolean; new_obs uuid; ext text;
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
      'price_semantics', l->'price_semantics', 'premium_schedule', l->'premium_schedule',
      'symbols_printed', l->'symbols_printed', 'symbols_basis', l->>'symbols_basis',
      'identity_basis', 'lot_presentation'));
    -- The v2 hash, extended only when a lot carries one of the new statements: a lot without them (every Bonhams row) hashes
    -- exactly as before, so nothing already landed is re-superseded. Symbols read later from a lot page land as a new version.
    ext := CASE WHEN sd ?| ARRAY['price_semantics', 'premium_schedule', 'symbols_basis'] THEN concat_ws('|',
      sd->'price_semantics'->>'reading', sd->'premium_schedule'->>'schedule', sd->'premium_schedule'->>'site', sd->>'symbols_basis',
      (SELECT string_agg(coalesce(x->>'code', '') || ':' || coalesce(x->>'version', ''), ',' ORDER BY ord)
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(sd->'symbols_printed') = 'array' THEN sd->'symbols_printed' ELSE '[]'::jsonb END) WITH ORDINALITY e(x, ord))) END;
    hash := md5(concat_ws('|', ikey, sid, method, sd->>'result', sd->>'hammer_price', sd->>'hammer_premium',
      sd->>'estimate_low', sd->>'estimate_high', sd->>'sale_ends_at', sd->>'high_bid') || coalesce('|' || ext, ''));

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
COMMIT;
