-- Exact-source estimate read for a bounded set of public BaT presentations. This is additive:
-- the existing vehicle-keyed reader and older clients keep their current contract. A relisted
-- lot is eligible only through the board's applied current-episode link or native fold and a prediction that
-- carries that same episode and listing URL in its writer's notes. Ambiguity returns no row.
-- Model 33 is intentionally withheld here until its inputs are also scoped to one episode.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.live_finish_episode_estimates(p_lots jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF jsonb_typeof(p_lots) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Expected an array of 1 to 40 lot references' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lots) < 1 OR jsonb_array_length(p_lots) > 40 THEN
    RAISE EXCEPTION 'Expected an array of 1 to 40 lot references' USING ERRCODE = '22023';
  END IF;

  RETURN (
    WITH requested AS MATERIALIZED (
      SELECT DISTINCT
        CASE WHEN pg_input_is_valid(x->>'vehicle_id', 'uuid') THEN (x->>'vehicle_id')::uuid END AS vehicle_id,
        rtrim(x->>'listing_url', '/') AS listing_url
      FROM jsonb_array_elements(p_lots) x
      WHERE jsonb_typeof(x) = 'object'
        AND length(x->>'listing_url') <= 512
        AND x->>'listing_url' ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
    ), beat AS MATERIALIZED (
      SELECT max(predicted_at) AS at FROM public.hammer_predictions WHERE model_version = 32
    ), board AS MATERIALIZED (
      SELECT public.market_pulse_live() AS value
    ), board_clock AS MATERIALIZED (
      SELECT CASE WHEN pg_input_is_valid(value->>'synced_at', 'timestamp with time zone')
                  THEN (value->>'synced_at')::timestamptz END AS at FROM board
    ), board_columns AS MATERIALIZED (
      SELECT CASE WHEN count(*) FILTER (WHERE name = 'id') = 1
                  THEN min((pos-1)::integer) FILTER (WHERE name = 'id') END AS id_pos,
             CASE WHEN count(*) FILTER (WHERE name = 'listing_url') = 1
                  THEN min((pos-1)::integer) FILTER (WHERE name = 'listing_url') END AS url_pos,
             CASE WHEN count(*) FILTER (WHERE name = 'ends_at') = 1
                  THEN min((pos-1)::integer) FILTER (WHERE name = 'ends_at') END AS end_pos,
             CASE WHEN count(*) FILTER (WHERE name = 'current_bid') = 1
                  THEN min((pos-1)::integer) FILTER (WHERE name = 'current_bid') END AS bid_pos
      FROM board CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(board.value->'columns') = 'array' THEN board.value->'columns' ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS columns(name, pos)
    ), board_rows AS MATERIALIZED (
      SELECT a->>c.id_pos AS vehicle_id, rtrim(a->>c.url_pos, '/') AS listing_url,
             CASE WHEN pg_input_is_valid(a->>c.end_pos, 'timestamp with time zone')
               THEN (a->>c.end_pos)::timestamptz END AS ends_at,
             CASE WHEN jsonb_typeof(a->c.bid_pos) = 'number' THEN (a->>c.bid_pos)::numeric END AS current_bid,
             count(*) OVER (PARTITION BY a->>c.id_pos) AS presentations
      FROM board CROSS JOIN board_columns c CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(board.value->'auctions') = 'array' THEN board.value->'auctions' ELSE '[]'::jsonb END
      ) a
      WHERE c.id_pos IS NOT NULL AND c.url_pos IS NOT NULL AND c.end_pos IS NOT NULL AND c.bid_pos IS NOT NULL
    ), candidates AS MATERIALIZED (
      SELECT v.id AS vehicle_id, b.listing_url, b.current_bid AS board_bid, e.id AS event_id
      FROM requested r
      JOIN board_rows b ON b.vehicle_id = r.vehicle_id::text AND b.listing_url = r.listing_url
      CROSS JOIN board
      CROSS JOIN LATERAL (SELECT board.value->'identity_links'->b.listing_url AS value) l
      CROSS JOIN LATERAL (SELECT board.value->'native_state'->b.vehicle_id AS value) n
      CROSS JOIN LATERAL (SELECT coalesce(l.value, n.value) AS value) evidence
      JOIN public.vehicles v ON v.id = r.vehicle_id
      JOIN public.auction_events_canonical e ON e.id = CASE
        WHEN pg_input_is_valid(evidence.value->>'auction_event_id', 'uuid')
          THEN (evidence.value->>'auction_event_id')::uuid END
      WHERE b.presentations = 1 AND b.ends_at > now() AND b.current_bid > 0
        AND ((l.value IS NOT NULL AND l.value->'applied' = 'true'::jsonb
              AND l.value->>'basis' = 'retained_native_current_episode'
              AND l.value->>'canonical_vehicle_id' = v.id::text)
          OR (l.value IS NULL AND n.value->>'basis' = 'canonical_native_fold'
              AND (n.value->'source_listing_claims' IS NULL OR n.value->'source_listing_claims' = 'null'::jsonb
                   OR (jsonb_typeof(n.value->'source_listing_claims') = 'object'
                       AND rtrim(n.value#>>'{source_listing_claims,source_url}', '/') = b.listing_url))))
        AND v.is_public AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
        AND e.vehicle_id = v.id AND e.source = 'bat' AND e.outcome = 'live'
        AND rtrim(e.source_url, '/') = b.listing_url AND e.auction_end_date > now()
    ), chosen AS MATERIALIZED (
      SELECT c.*, h.predicted_hammer, h.predicted_low, h.predicted_high, h.confidence_score,
             h.current_bid, h.predicted_at, h.n
      FROM candidates c CROSS JOIN beat CROSS JOIN board_clock
      CROSS JOIN LATERAL (
        SELECT x.predicted_hammer, x.predicted_low, x.predicted_high, x.confidence_score,
               x.current_bid, x.predicted_at,
               CASE WHEN x.notes IS JSON OBJECT THEN x.notes::jsonb ELSE '{}'::jsonb END AS n
        FROM public.hammer_predictions x
        WHERE x.vehicle_id = c.vehicle_id AND x.model_version = 32
          AND x.current_bid = c.board_bid
          AND x.predicted_at <= now() + interval '1 minute'
          AND CASE WHEN x.notes IS JSON OBJECT THEN x.notes::jsonb ELSE '{}'::jsonb END @>
              jsonb_build_object('source_event_id', c.event_id::text, 'source_listing_url', c.listing_url)
          AND CASE WHEN x.notes IS JSON OBJECT THEN x.notes::jsonb ELSE '{}'::jsonb END->>'source_identity_basis'
              IN ('retained_native_current_episode', 'canonical_native_fold')
          AND x.predicted_low > 0 AND x.predicted_low <= x.predicted_hammer AND x.predicted_hammer <= x.predicted_high
        ORDER BY x.predicted_at DESC
        LIMIT 1
      ) h
      WHERE beat.at > now() - interval '2 hours' AND beat.at <= now() + interval '1 minute'
        AND board_clock.at > now() - interval '2 hours' AND board_clock.at <= now() + interval '1 minute'
    )
    SELECT jsonb_build_object(
      'as_of', now(), 'writer_at', beat.at, 'board_at', board_clock.at,
      'fresh', coalesce(beat.at > now() - interval '2 hours' AND beat.at <= now() + interval '1 minute'
                        AND board_clock.at > now() - interval '2 hours' AND board_clock.at <= now() + interval '1 minute', false),
      'rows', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'vehicle_id', c.vehicle_id, 'listing_url', c.listing_url, 'auction_event_id', c.event_id,
          'estimate', c.predicted_hammer, 'low', c.predicted_low, 'high', c.predicted_high,
          'grade', CASE WHEN c.n->>'grade' IN ('A', 'B', 'C') THEN c.n->>'grade' END,
          'coverage', c.confidence_score,
          'sentence', CASE WHEN jsonb_typeof(c.n->'sentence') = 'string' AND length(c.n->>'sentence') <= 512
                           THEN c.n->>'sentence' END,
          'estimated_at', c.predicted_at, 'bid_at_estimate', c.current_bid,
          'comps_through', CASE WHEN jsonb_typeof(c.n->'comps_through') = 'string'
                                     AND length(c.n->>'comps_through') <= 32 THEN c.n->>'comps_through' END,
          'model', 32, 'analogs', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'title', CASE WHEN jsonb_typeof(a->'title') = 'string' AND length(a->>'title') <= 512 THEN a->>'title' END,
              'url', CASE WHEN jsonb_typeof(a->'url') = 'string' AND length(a->>'url') <= 512
                                AND a->>'url' ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$' THEN a->>'url' END,
              'closed', CASE WHEN jsonb_typeof(a->'closed') = 'string' AND length(a->>'closed') <= 32 THEN a->>'closed' END,
              'bid', CASE WHEN jsonb_typeof(a->'bid') = 'number' THEN a->'bid' END,
              'final', CASE WHEN jsonb_typeof(a->'final') = 'number' THEN a->'final' END,
              'outcome', CASE WHEN jsonb_typeof(a->'outcome') = 'string' AND length(a->>'outcome') <= 80 THEN a->>'outcome' END))
            FROM (SELECT value AS a FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(c.n->'analogs') = 'array' THEN c.n->'analogs' ELSE '[]'::jsonb END
            ) LIMIT 5) analogs
          ), '[]'::jsonb)
        ) ORDER BY c.vehicle_id, c.listing_url) FROM chosen c
      ), '[]'::jsonb)
    ) FROM beat CROSS JOIN board_clock
  );
END;
$function$;

COMMENT ON FUNCTION public.live_finish_episode_estimates(jsonb) IS
  'Bounded public model 32 estimates and allowlisted analog fields for exact, uniquely verified current BaT episodes; '
  'matches the prediction receipt to the board and event, and withholds model 33 and ambiguous presentations.';
REVOKE ALL ON FUNCTION public.live_finish_episode_estimates(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_finish_episode_estimates(jsonb) TO anon, authenticated, service_role;

COMMIT;
