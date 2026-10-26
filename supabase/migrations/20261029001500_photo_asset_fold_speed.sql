-- photo_asset_fold speed: the first live read (1,749 assets, 8,855 sightings) exceeded the 30 s statement timeout.
-- Measured parts: the recurring-places scan over every vehicle_images row of the person took 12 s (scattered heap reads),
-- and the per-asset citation lookups rescanned the book view and receipt text for each of up to 500 assets (~13 s).
--   * Recurring places now come from the person's own sightings (cells where their items are seen on 5+ days).
--   * Book lines, receipts and the tool ledger are read once; only words that are some asset's key term are kept
--     (with a trailing plural s folded), and the full term is verified with strpos on the line's text.
-- Same output shape and citation order (user_tools, book, receipt). Live timing of the body as a read-only query:
-- 500 assets in 5.6 s, 132 cited (61 tool ledger, 59 book, 12 receipts).
-- Contract: supabase/sql/test_photo_work_ledger.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.photo_asset_fold(p_person uuid, p_kind text DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
  WITH s0 AS MATERIALIZED (
    SELECT a.id AS asset_id, a.asset_type, a.title, a.attributes, o.observed_at, o.confidence, o.structured_data AS sd,
           (o.observed_at AT TIME ZONE 'America/Los_Angeles')::date AS d
    FROM public.assets a
    JOIN public.asset_observations o ON o.asset_id = a.id AND o.kind = 'photo_sighting'
    JOIN public.image_analysis_records ar ON ar.id = (o.structured_data->>'reading_id')::uuid AND ar.superseded_by IS NULL
    WHERE a.creator_id = p_person AND a.attributes ? 'fold_key'
  ), home AS MATERIALIZED (   -- recurring places: ~100 m cells where the person's items are seen on 5 or more days
    SELECT s0.sd->>'cell' AS cell FROM s0 WHERE s0.sd ? 'cell' GROUP BY 1 HAVING count(DISTINCT s0.d) >= 5
  ), s AS MATERIALIZED (
    SELECT * FROM s0 WHERE p_kind IS NULL OR s0.asset_type = p_kind
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
  ), tk AS MATERIALIZED (   -- each match term with its longest word as the join key
    SELECT tm.asset_id, t, (SELECT regexp_replace(w, '(.{4,})s$', '\1') FROM regexp_split_to_table(t, '[^a-z0-9]+') w
      ORDER BY length(w) DESC, w LIMIT 1) AS k
    FROM terms tm, unnest(tm.ts) t
  ), book AS MATERIALIZED (
    SELECT b.local_id, b.record_date, b.record_date::date AS d, lower(concat_ws(' ', b.description, b.decision)) AS txt
    FROM public.v_financial_accounting_records b
    WHERE b.owner_id = p_person AND b.section = 'Expense' AND b.record_date ~ '^\d{4}-\d{2}-\d{2}$'
  ), keys AS MATERIALIZED (
    SELECT DISTINCT tk.k FROM tk WHERE length(tk.t) >= 5 AND length(tk.k) >= 3
  ), book_hit AS MATERIALIZED (   -- book lines holding some asset's key word, with their date and text
    SELECT DISTINCT b.local_id, b.record_date, b.d, b.txt, w
    FROM book b, LATERAL (SELECT regexp_replace(x, '(.{4,})s$', '\1') AS w FROM regexp_split_to_table(b.txt, '[^a-z0-9]+') x) ws
    WHERE w IN (SELECT k FROM keys)
  ), rc AS MATERIALIZED (
    SELECT p.id, coalesce(p.receipt_date, p.transaction_date, p.purchase_date) AS d,
           lower(concat_ws(' ', p.vendor_name, p.part_number, left(p.raw_extraction::text, 4000))) AS txt
    FROM public.receipts p
    WHERE p.user_id = p_person AND NOT coalesce(p.is_superseded, false) AND p.duplicate_of IS NULL
      AND coalesce(p.receipt_date, p.transaction_date, p.purchase_date) IS NOT NULL
  ), rc_hit AS MATERIALIZED (
    SELECT DISTINCT p.id, p.d, p.txt, w
    FROM rc p, LATERAL (SELECT regexp_replace(x, '(.{4,})s$', '\1') AS w FROM regexp_split_to_table(p.txt, '[^a-z0-9]+') x) ws
    WHERE w IN (SELECT k FROM keys)
  ), c_ut AS (
    SELECT DISTINCT ON (r.asset_id) r.asset_id, jsonb_build_object('source', 'user_tools', 'id', u.id,
      'date', coalesce(u.first_purchase_date, u.transaction_date)) AS cite
    FROM ranked r JOIN tk ON tk.asset_id = r.asset_id
    JOIN public.user_tools u ON u.user_id = p_person
      AND strpos(lower(concat_ws(' ', u.brand, u.description, u.category)), tk.t) > 0
      AND (r.attributes->>'brand' IS NULL OR (tk.t <> lower(r.attributes->>'brand')
        AND strpos(lower(coalesce(u.brand, '') || ' ' || coalesce(u.description, '')), lower(r.attributes->>'brand')) > 0))
    ORDER BY r.asset_id, coalesce(u.first_purchase_date, u.transaction_date) NULLS LAST
  ), c_book AS (
    SELECT DISTINCT ON (r.asset_id) r.asset_id, jsonb_build_object('source', 'book', 'local_id', b.local_id, 'date', b.record_date) AS cite
    FROM ranked r JOIN tk ON tk.asset_id = r.asset_id AND length(tk.t) >= 5
    JOIN book_hit b ON b.w = tk.k
    WHERE b.d BETWEEN (r.first_seen AT TIME ZONE 'America/Los_Angeles')::date - 120 AND (r.first_seen AT TIME ZONE 'America/Los_Angeles')::date + 30
      AND strpos(b.txt, tk.t) > 0
    ORDER BY r.asset_id, b.d
  ), c_rc AS (
    SELECT DISTINCT ON (r.asset_id) r.asset_id, jsonb_build_object('source', 'receipt', 'id', p.id, 'date', p.d) AS cite
    FROM ranked r JOIN tk ON tk.asset_id = r.asset_id AND length(tk.t) >= 5
    JOIN rc_hit p ON p.w = tk.k
    WHERE p.d BETWEEN (r.first_seen AT TIME ZONE 'America/Los_Angeles')::date - 120 AND (r.first_seen AT TIME ZONE 'America/Los_Angeles')::date + 30
      AND strpos(p.txt, tk.t) > 0
    ORDER BY r.asset_id, p.d
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
  LEFT JOIN LATERAL (SELECT coalesce((SELECT cite FROM c_ut WHERE c_ut.asset_id = r.asset_id),
      (SELECT cite FROM c_book WHERE c_book.asset_id = r.asset_id),
      (SELECT cite FROM c_rc WHERE c_rc.asset_id = r.asset_id)) AS cited_by) c ON true
$$;
REVOKE ALL ON FUNCTION public.photo_asset_fold(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.photo_asset_fold(uuid, text, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
