-- A Facebook capture/asking price has no confirmed sale outcome or sale clock.
-- Keep it in the existing supply readers; exclude it from the 1D sold measure.
-- Preserve the existing function identity, permissions and all other horizons.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
DO $repair$
DECLARE
  v_definition text := pg_get_functiondef('public.family_share_movers_build(integer,integer,text)'::regprocedure);
  v_hash text;
BEGIN
  v_hash := encode(sha256(convert_to(v_definition, 'UTF8')), 'base64');
  IF v_hash = 'xphhtw8rYBOG4MEuvuOtKO2qcmJHtcyarmsFqj/0meI=' THEN RETURN; END IF;
  IF v_hash <> 'YPgUgOo8ArvU7Khm+xT0nOBBvEaAqcXQYnio41v+Mg4=' THEN
    RAISE EXCEPTION 'daily sales owner definition drifted; review before repair';
  END IF;
  v_definition := replace(v_definition, $old$  v_fb_1d jsonb := '[]'::jsonb;
$old$, $new$$new$);
  v_definition := replace(v_definition, $old$    IF v_has_fb THEN
      SELECT coalesce(jsonb_agg(jsonb_build_array(
        lower(trim(parsed_make)),
        lower(trim(coalesce(parsed_model, ''))),
        CASE
          WHEN coalesce(current_price, price::numeric) > 0 AND coalesce(current_price, price::numeric) < 50000000
            THEN coalesce(current_price, price::numeric)
          ELSE NULL
        END,
        scraped_at::text,
        CASE WHEN scraped_at > now() - interval '24 hours' THEN 1 ELSE 0 END
      )), '[]'::jsonb)
      INTO v_fb_1d
      FROM public.marketplace_listings
      WHERE scraped_at > now() - interval '48 hours'
        AND scraped_at <= now()
        AND parsed_make IS NOT NULL;
    END IF;

$old$, $new$$new$);
  v_definition := replace(v_definition, $old$      UNION ALL
      SELECT
        fb->>0 AS make_l,
        coalesce(
          m.family_key,
          (SELECT fn.family_key FROM f_names fn
            WHERE fn.make_l = (fb->>0)
              AND ((fb->>1) = fn.family_key
                   OR (fb->>1) LIKE fn.family_key || ' %'
                   OR (fb->>1) LIKE fn.family_key || '-%')
            LIMIT 1),
          'other'
        ) AS family_key,
        CASE WHEN (fb->>2) IS NOT NULL THEN (fb->>2)::numeric ELSE NULL END AS usd,
        (fb->>3)::timestamptz AS ended_at,
        (fb->>4)::int AS is_recent
      FROM jsonb_array_elements(v_fb_1d) fb
      LEFT JOIN m_map m
        ON m.make_l = (fb->>0)
       AND m.model_l = (fb->>1)
$old$, $new$$new$);
  v_definition := replace(v_definition, $old$  -- 2) 1D: Live 24h sold vehicle_events + active FB Marketplace captures against prior 24h when at least 10 live rows exist,$old$, $new$  -- 2) 1D: Confirmed sold vehicle_events against prior 24h when at least 10 live rows exist.$new$);
  IF encode(sha256(convert_to(v_definition, 'UTF8')), 'base64') <> 'xphhtw8rYBOG4MEuvuOtKO2qcmJHtcyarmsFqj/0meI=' THEN
    RAISE EXCEPTION 'daily sales repair did not produce reviewed definition';
  END IF;
  EXECUTE v_definition;
END
$repair$;
COMMIT;
