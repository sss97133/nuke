-- DRAFT, NOT APPLIED. Needs the owner's yes before it becomes a migration.
--
-- ask_close_comps(p_vehicle_ids uuid[]) -> jsonb
-- A fair range for a classified ask (Craigslist / Facebook Marketplace / KSL), built only from close
-- comparable sales: sold lots of the same make, model family and model year (widened to +/-1 only when the
-- exact year has fewer than 5), within the last 36 months, at every house in auction_events, carrying every
-- distinguishing word of the subject's model. Too few or too spread -> "no_opinion" with the reason.
-- Rules and the numbers behind them: supabase/drafts/ask-close-comps/README.md.
--
-- Price basis: gross_incl_premium (what the buyer paid, premium included), USD through fx_usd_rate.
-- Bases are never mixed; a lot with no gross price is left out.
--
-- SECURITY DEFINER because record_quarantine and vehicle_lot_class have RLS with no read policy: an
-- invoker (anon) would silently skip the quarantine and lot-class exclusions. Subjects are limited to public,
-- non-deleted vehicles, and comps come from public, non-deleted vehicles only.

SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.ask_close_comps(p_vehicle_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF coalesce(cardinality(p_vehicle_ids), 0) > 60 THEN
    RAISE EXCEPTION 'ask_close_comps takes at most 60 vehicle ids per call (got %)', cardinality(p_vehicle_ids)
      USING ERRCODE = '22023';
  END IF;

  -- BEGIN READER (validated as a plain SELECT with the ids inlined; keep this block one statement)
  WITH
  rules AS (
    SELECT
      now() AS as_of,
      (now() - interval '36 months') AS since,
      5 AS min_n,
      1.75::numeric AS max_spread,
      25 AS max_comps,
      -- body words: they set the body class and are never required words
      ARRAY['convertible','cabriolet','cabrio','roadster','spyder','spider','speedster','drophead','targa','volante'] AS w_open,
      ARRAY['wagon','estate','avant','sportwagen','kombi'] AS w_wagon,
      ARRAY['coupe','sedan','saloon','hardtop','ht','fastback','hatchback','liftback','notchback','suv','pickup',
            'truck','van','cab','door','dr','crew','regular','reg','extended','ext','quad','supercab','supercrew']
        AS w_closed,
      -- a comp carrying one of these words is left out unless the subject carries it too
      ARRAY['tribute','clone','replica','recreation','restomod','custom','project','kit','protouring','gasser',
            'drag','race','racer','rat','roller','salvage','parts','modified'] AS w_modifier,
      -- words that describe the ad, not the variant
      ARRAY['original','orig','classic','clean','nice','rare','restored','runs','running','drives','driver','great',
            'good','excellent','condition','low','miles','mile','mi','obo','cash','trade','sale','new','beautiful',
            'stock','mint','only','owner','one','title','clear','rebuilt','fresh','must','see','cheap','chevy','ci',
            'cu','in','cid','the','a','and','with','w','for','of','or','by','cyl','cylinder','manual','automatic',
            'auto','trans','transmission','base','edition','model','series','vintage','antique','muscle','hot','rod',
            'street','fully','loaded','used','vehicle','car','cars','motor','motors','engine','bug'] AS w_noise
  ),
  req AS (
    SELECT DISTINCT r.id FROM unnest(p_vehicle_ids) r(id) WHERE r.id IS NOT NULL
  ),
  subj AS MATERIALIZED (
    SELECT v.id, v.year, v.make, lower(v.make) AS make_l, v.model, v.trim, v.body_style,
      coalesce(cm.display_name, initcap(v.make)) AS brand,
      fam.family_id, fam.family, public.lot_class_of(v.id) AS lot_class
    FROM req
    JOIN public.vehicles v ON v.id = req.id AND v.is_public IS TRUE AND v.deleted_at IS NULL
    LEFT JOIN public.canonical_makes cm ON cm.id = v.canonical_make_id
    LEFT JOIN public.mv_model_family_names fam
      ON fam.make_l = lower(v.make) AND fam.model_l = lower(coalesce(v.model, '')) AND fam.family_id IS NOT NULL
     AND v.year IS NOT NULL
     AND (fam.year_start IS NULL OR v.year >= fam.year_start - 1)
     AND (fam.year_end IS NULL OR v.year <= fam.year_end + 1)
  ),
  cohort AS MATERIALIZED (
    -- one candidate pull per (family, year), however many subjects share it
    SELECT s.family_id, min(s.family) AS family, s.year, array_agg(DISTINCT s.brand) AS brands
    FROM subj s WHERE s.family_id IS NOT NULL
    GROUP BY s.family_id, s.year
  ),
  sold_ids AS MATERIALIZED (
    -- the family's sold cars (+/-1 year) with a sale date in the window (a month of slack; the lot date below
    -- decides). mv_family_sales (refreshed daily by refresh-family-sales, same family fold as the subject) is
    -- only the finder, through its (brand, family_key, sale_date) index; the car is re-read live below and its
    -- price, date and lot come live from auction_events.
    SELECT DISTINCT c.family_id, c.year AS cohort_year, fs.vehicle_id AS id
    FROM cohort c
    CROSS JOIN rules ru
    JOIN public.mv_family_sales fs
      ON fs.brand = ANY (c.brands) AND fs.family_key = c.family_id::text
     AND fs.sale_date >= (ru.since - interval '31 days')::date
     AND fs.year BETWEEN c.year - 1 AND c.year + 1
  ),
  cand AS MATERIALIZED (
    SELECT si.family_id, si.cohort_year, v.id, v.year, v.make, v.model, v.trim, v.body_style, v.condition_rating,
      coalesce(v.listing_title, v.bat_listing_title, v.title) AS title,
      coalesce(v.listing_url, v.discovery_url) AS page
    FROM sold_ids si
    JOIN public.vehicles v
      ON v.id = si.id
     AND v.year BETWEEN si.cohort_year - 1 AND si.cohort_year + 1
     AND v.is_public AND v.deleted_at IS NULL
     AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
  ),
  units AS (
    -- every row that gets cut into words (subjects, family names, makes, candidates), so the word rule
    -- exists once and no row has to be joined back to its words by key
    SELECT 's'::text AS kind, s.id AS key, s.family_id AS fam, s.year AS cohort_year, s.year, s.make, s.model,
           NULL::numeric AS condition_rating, NULL::text AS title,
           concat_ws(' ', s.model, s.trim) AS x_model, NULL::text AS x_title, s.body_style AS x_body,
           NULL::text AS x_pre, NULL::text AS x_slug
    FROM subj s
    UNION ALL
    SELECT 'f', NULL, c.family_id, NULL, NULL, NULL, NULL, NULL, NULL, c.family, NULL, NULL, NULL, NULL
    FROM (SELECT DISTINCT family_id, family FROM cohort) c
    UNION ALL
    SELECT DISTINCT 'm', NULL::uuid, s.family_id, NULL::int, NULL::int, NULL, NULL, NULL::numeric, NULL, s.make, NULL, NULL, NULL, NULL
    FROM subj s WHERE s.family_id IS NOT NULL
    UNION ALL
    -- a comp's title is read from its model year on: "454-Powered 1967 Chevrolet Chevelle SS 396" reads as
    -- "Chevrolet Chevelle SS 396" (what was put in the car is not what the car is); the words before the year
    -- ("Modified", "Restomod") are kept apart and read only for modifiers. The listing page's slug
    -- (".../lots/1178105/1967-chevrolet-camaro-convertible/") is read only for body and modifiers, never for
    -- required words (its trailing numbers are lot counters, not displacement)
    SELECT 'c', k.id, k.family_id, k.cohort_year, k.year, k.make, k.model, k.condition_rating, k.title,
           concat_ws(' ', k.model, k.trim),
           CASE WHEN k.title ~ '\m(19|20)[0-9]{2}\M' THEN substring(k.title FROM '\m(?:19|20)[0-9]{2}\M(.*)$') ELSE k.title END,
           k.body_style,
           CASE WHEN k.title ~ '\m(19|20)[0-9]{2}\M' THEN substring(k.title FROM '^(.*?)\m(?:19|20)[0-9]{2}\M') END,
           substring(k.page FROM '/([^/?#]+)/?(?:[?#].*)?$')
    FROM cand k
  ),
  cut AS MATERIALIZED (
    SELECT u.*, ww.w_model, ww.w_title, ww.w_body, ww.w_pre, ww.w_slug
    FROM units u
    CROSS JOIN LATERAL (
      SELECT array_agg(DISTINCT w.w) FILTER (WHERE p.i = 1) AS w_model,
             array_agg(DISTINCT w.w) FILTER (WHERE p.i = 2) AS w_title,
             array_agg(DISTINCT w.w) FILTER (WHERE p.i = 3) AS w_body,
             array_agg(DISTINCT w.w) FILTER (WHERE p.i = 4) AS w_pre,
             array_agg(DISTINCT w.w) FILTER (WHERE p.i = 5) AS w_slug
      FROM unnest(ARRAY[u.x_model, u.x_title, u.x_body, u.x_pre, u.x_slug]) WITH ORDINALITY p(x, i)
      CROSS JOIN LATERAL (
        SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                 ' ' || regexp_replace(replace(replace(lower(p.x), '&#215;', 'x'), '×', 'x'), '[^a-z0-9]+', ' ', 'g') || ' ',
                 '\m(4x4|4wd|4 x 4)\M', ' fourwd ', 'g'),
                 -- dropped: 2wd, N-speed, 2-door, V8
                 '\m(2wd|4x2|rwd|fwd|[0-9]+ ?(speed|spd)|(2|4|two|four) ?(door|dr)|v ?(6|8|10|12))\M', ' ', 'g'),
               '\msport coupe\M', ' coupe ', 'g'),
               '([a-z])([0-9])', '\1 \2', 'g'),
               '([0-9])([a-z])', '\1 \2', 'g'),
               '\m(resto) (mod)\M|\m(pro) (touring)\M|\m(re) (creation)\M', '\1\2\3\4\5\6', 'g'),
               '\mcustom (deluxe|cab|cruiser|[0-9]+)\M', 'custom_\1', 'g') AS s
      ) n
      CROSS JOIN LATERAL regexp_split_to_table(btrim(n.s), '\s+') w(w)
      WHERE p.x IS NOT NULL AND w.w <> '' AND w.w !~ '^(19|20)[0-9]{2}$'
    ) ww
  ),
  fam_words AS MATERIALIZED (
    -- the family's words, plus the family name written as one word ("landcruiser", "roadrunner")
    SELECT f.fam AS family_id, coalesce(f.w_model, '{}') AS family_w,
           coalesce(f.w_model, '{}') || regexp_replace(lower(f.x_model), '[^a-z0-9]+', '', 'g') AS family_sub,
           coalesce((SELECT array_agg(DISTINCT x) FROM cut m, unnest(m.w_model) x WHERE m.kind = 'm' AND m.fam = f.fam), '{}') AS make_w
    FROM cut f WHERE f.kind = 'f'
  ),
  subj_k AS MATERIALIZED (
    -- required words: the subject's model words beyond the family name, the make, body words and ad noise
    SELECT s.*, ru.*, sc.w_model AS s_model_w,
      coalesce((SELECT array_agg(x ORDER BY x) FROM unnest(sc.w_model) x
                WHERE x <> ALL (coalesce(fw.family_sub, '{}') || coalesce(fw.make_w, '{}') || ru.w_noise
                                || ru.w_open || ru.w_wagon || ru.w_closed)), '{}') AS req_w,
      coalesce(sc.w_model, '{}') || coalesce(sc.w_body, '{}') AS all_w
    FROM subj s
    CROSS JOIN rules ru
    LEFT JOIN cut sc ON sc.kind = 's' AND sc.key = s.id
    LEFT JOIN fam_words fw ON fw.family_id = s.family_id
  ),
  subj_b AS MATERIALIZED (
    SELECT k.*,
      CASE WHEN k.all_w && k.w_open THEN 'open' WHEN k.all_w && k.w_wagon THEN 'wagon'
           WHEN k.all_w && k.w_closed THEN 'closed' END AS body_class
    FROM subj_k k
  ),
  cand_k AS MATERIALIZED (
    SELECT c.key AS id, c.fam AS family_id, c.cohort_year, c.year, c.make, c.model, c.condition_rating, c.title,
      coalesce(c.w_model, '{}') || coalesce(c.w_title, '{}') AS cw,
      coalesce(c.w_model, '{}') || coalesce(c.w_title, '{}') || coalesce(c.w_pre, '{}') || coalesce(c.w_slug, '{}') AS cw_mod,
      coalesce(c.w_model, '{}') || coalesce(c.w_title, '{}') || coalesce(c.w_body, '{}') || coalesce(c.w_slug, '{}') AS cw_body,
      -- a title naming another car: it has neither the family's words nor all of the comp's own model words
      (c.w_title IS NOT NULL AND NOT (c.w_title @> fw.family_w) AND NOT (c.w_title @> coalesce(c.w_model, '{}'))) AS title_conflict
    FROM cut c
    JOIN fam_words fw ON fw.family_id = c.fam
    WHERE c.kind = 'c'
  ),
  cand_m AS MATERIALIZED (
    -- which subjects each candidate is close to: every required word, no contradicting body, no modifier the
    -- subject lacks, not the subject itself, and a title that names this car
    SELECT k.*, m.subject_ids
    FROM cand_k k
    CROSS JOIN LATERAL (
      SELECT array_agg(s.id) AS subject_ids
      FROM subj_b s
      CROSS JOIN LATERAL (
        SELECT CASE WHEN k.cw_body && s.w_open THEN 'open' WHEN k.cw_body && s.w_wagon THEN 'wagon'
                    WHEN k.cw_body && s.w_closed THEN 'closed' END AS body_class
      ) kb
      WHERE s.family_id = k.family_id AND s.year = k.cohort_year
        AND k.id <> s.id
        AND k.cw @> s.req_w
        -- a known body must not be contradicted; a convertible or wagon subject needs a comp known to be one
        AND (s.body_class IS NULL OR s.body_class = kb.body_class
             OR (kb.body_class IS NULL AND s.body_class = 'closed'))
        AND NOT EXISTS (SELECT 1 FROM unnest(k.cw_mod) x WHERE x = ANY (s.w_modifier) AND x <> ALL (s.all_w))
    ) m
    WHERE NOT k.title_conflict AND m.subject_ids IS NOT NULL
  ),
  cand_s AS MATERIALIZED (
    -- each close car's sold lots in the window, read live from auction_events (index on vehicle_id): one row
    -- per lot (the same docket page is sometimes stored twice, www. and not), with the shared comp exclusions
    -- of get_comps_scored, gross price in USD through fx_usd_rate
    SELECT k.*, public.lot_class_of(k.id) AS lot_class, sl.sales
    FROM cand_m k
    CROSS JOIN rules ru
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
               'lot', d.k, 'source_url', d.source_url, 'sold_on', d.sold_on,
               'price_usd', round(d.gross_price * fx.rate, 0),
               'venue', coalesce(public.market_venue_label(d.source), initcap(d.source)))) AS sales
      FROM (
        SELECT DISTINCT ON (lot.k) lot.k, ae.source, ae.source_url, ae.gross_price, ae.hammer_price, ae.currency_code,
               (ae.auction_end_date AT TIME ZONE 'UTC')::date AS sold_on
        FROM public.auction_events_canonical ae
        CROSS JOIN LATERAL (
          SELECT coalesce(rtrim(regexp_replace(lower(ae.source_url), '^https?://(www\.)?', ''), '/'),
                          ae.source || ':' || coalesce(ae.lot_number, ae.id::text)) AS k
        ) lot
        WHERE ae.vehicle_id = k.id
          AND ae.outcome = 'sold'
          AND ae.gross_price > 0
          AND ae.auction_end_date >= ru.since AND ae.auction_end_date <= ru.as_of
          AND ae.source NOT IN ('craigslist', 'facebook_marketplace', 'ksl')
          AND NOT (coalesce(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
        ORDER BY lot.k, ae.auction_end_date ASC
      ) d
      CROSS JOIN LATERAL (
        SELECT f.rate FROM public.fx_usd_rate(coalesce(d.currency_code, 'USD'), d.sold_on) f LIMIT 1
      ) fx
      WHERE NOT public.auction_event_typed_not_sold(k.id, d.source_url)
        AND NOT public.vehicle_sale_price_untrusted(k.id, d.gross_price)
        AND NOT public.vehicle_sale_price_untrusted(k.id, d.hammer_price)
    ) sl
    WHERE sl.sales IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.record_quarantine q
                      WHERE q.tbl = 'vehicles' AND q.row_id = k.id AND q.released_at IS NULL)
  ),
  hit AS MATERIALIZED (
    -- one row per subject and lot: the same lot page is sometimes attached to two vehicle records
    SELECT DISTINCT ON (s.id, e->>'lot') s.id AS subject_id, k.year = s.year AS exact_year, k.id AS comp_id, k.year AS comp_year,
      k.make, k.model, k.title, k.condition_rating,
      (e->>'price_usd')::numeric AS price_usd, e->>'venue' AS venue, e->>'source_url' AS source_url,
      (e->>'sold_on')::date AS sold_on
    FROM cand_s k
    CROSS JOIN LATERAL unnest(k.subject_ids) sid(id)
    JOIN subj_b s ON s.id = sid.id AND s.lot_class = k.lot_class
    CROSS JOIN LATERAL jsonb_array_elements(k.sales) e
    ORDER BY s.id, e->>'lot', k.year = s.year DESC, k.id
  ),
  pick AS (
    -- exact model year first; +/-1 only when the exact year has fewer than min_n
    SELECT s.id AS subject_id, coalesce(c.n_exact, 0) < s.min_n AS widened
    FROM subj_b s
    LEFT JOIN (SELECT h.subject_id, count(*) FILTER (WHERE h.exact_year) AS n_exact FROM hit h GROUP BY 1) c
      ON c.subject_id = s.id
  ),
  used AS (
    SELECT h.* FROM hit h JOIN pick pk ON pk.subject_id = h.subject_id
    WHERE h.exact_year OR pk.widened
  ),
  stat AS (
    SELECT u.subject_id, count(*)::int AS n,
      percentile_cont(ARRAY[0.25, 0.5, 0.75]) WITHIN GROUP (ORDER BY u.price_usd::float8) AS q,
      count(u.condition_rating)::int AS condition_known
    FROM used u GROUP BY u.subject_id
  ),
  venue_n AS (
    SELECT x.subject_id, jsonb_object_agg(x.venue, x.n ORDER BY x.n DESC, x.venue) AS venues
    FROM (SELECT u.subject_id, u.venue, count(*)::int AS n FROM used u GROUP BY 1, 2) x
    GROUP BY x.subject_id
  ),
  comp_list AS (
    SELECT x.subject_id, jsonb_agg(jsonb_build_object(
        'vehicle_id', x.comp_id, 'title', x.title, 'sold_on', x.sold_on, 'price', x.price_usd,
        'venue', x.venue, 'url', x.source_url) ORDER BY x.sold_on DESC, x.price_usd DESC) AS comps
    FROM (
      SELECT u.*, coalesce(nullif(btrim(u.title), ''), concat_ws(' ', u.comp_year, u.make, u.model)) AS title_out,
             row_number() OVER (PARTITION BY u.subject_id ORDER BY u.sold_on DESC, u.price_usd DESC) AS rn
      FROM used u
    ) x0
    CROSS JOIN LATERAL (SELECT x0.subject_id, x0.comp_id, x0.title_out AS title, x0.sold_on, x0.price_usd,
                               x0.venue, x0.source_url) x
    CROSS JOIN rules ru
    WHERE x0.rn <= ru.max_comps
    GROUP BY x.subject_id
  ),
  graded AS (
    SELECT s.*, pk.widened, coalesce(st.n, 0) AS n, st.q, coalesce(st.condition_known, 0) AS condition_known,
      CASE WHEN st.q IS NOT NULL AND st.q[1] > 0 THEN round((st.q[3] / st.q[1])::numeric, 1) END AS spread
    FROM subj_b s
    JOIN pick pk ON pk.subject_id = s.id
    LEFT JOIN stat st ON st.subject_id = s.id
  ),
  verdict AS (
    SELECT g.*,
      CASE
        WHEN g.year IS NULL THEN 'Model year unknown'
        WHEN g.family_id IS NULL THEN 'Model not matched to a model family'
        WHEN g.n < g.min_n THEN format('%s close %s in 3 years; %s needed', g.n,
                                       CASE WHEN g.n = 1 THEN 'sale' ELSE 'sales' END, g.min_n)
        WHEN g.q[3] / nullif(g.q[1], 0) <= g.max_spread THEN NULL
        WHEN cardinality(g.req_w) = 0 THEN 'Model not specific enough to match close sales'
        ELSE format('Close sales too spread to say (high is %s× low)', g.spread)
      END AS reason
    FROM graded g
  )
  SELECT jsonb_build_object(
    'as_of', (SELECT as_of FROM rules),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'vehicle_id', vd.id,
      'verdict', CASE WHEN vd.reason IS NULL THEN 'range' ELSE 'no_opinion' END,
      'reason', vd.reason,
      'match', jsonb_build_object(
        'year_from', CASE WHEN vd.widened THEN vd.year - 1 ELSE vd.year END,
        'year_to', CASE WHEN vd.widened THEN vd.year + 1 ELSE vd.year END,
        'make', vd.make,
        'family', vd.family,
        'tokens', to_jsonb(vd.req_w),
        'window_from', (vd.since AT TIME ZONE 'UTC')::date,
        'window_to', (vd.as_of AT TIME ZONE 'UTC')::date),
      'n', vd.n,
      'low', CASE WHEN vd.reason IS NULL THEN round(vd.q[1]::numeric) END,
      'mid', CASE WHEN vd.reason IS NULL THEN round(vd.q[2]::numeric) END,
      'high', CASE WHEN vd.reason IS NULL THEN round(vd.q[3]::numeric) END,
      'venues', coalesce(vn.venues, '{}'::jsonb),
      'condition_known', vd.condition_known,
      'comps', coalesce(cl.comps, '[]'::jsonb)
    ) ORDER BY vd.id), '[]'::jsonb)
  ) INTO v_out
  FROM verdict vd
  LEFT JOIN venue_n vn ON vn.subject_id = vd.id
  LEFT JOIN comp_list cl ON cl.subject_id = vd.id;
  -- END READER

  RETURN v_out;
END
$function$;

COMMENT ON FUNCTION public.ask_close_comps(uuid[]) IS
  'Fair range for classified asks from close sold comps only (same make, model family, model year or +/-1, every distinguishing model word, 36 months, all houses in auction_events, gross USD). verdict range when n>=5 and p75/p25<=1.75, else no_opinion with a reason. Rules: supabase/drafts/ask-close-comps/README.md.';

REVOKE ALL ON FUNCTION public.ask_close_comps(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ask_close_comps(uuid[]) TO anon, authenticated;
