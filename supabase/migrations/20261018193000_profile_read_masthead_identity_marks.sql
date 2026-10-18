-- Update `public.vehicle_profile_read` so the `masthead` section includes `identity_marks`
-- resolved from `public.resolve_vehicle_identity_marks(v.make, COALESCE(v.normalized_model, v.model), v.year, v.series, v.trim, v.body_style)`.
-- Also normalizes blank string parameters in `public.resolve_vehicle_identity_marks` and maps
-- 4x4 Squarebody series codes (`K10`/`K20`/`K30`/`K1500`) to their shared `10`/`20`/`30`/`1500` fender plates.

BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.resolve_vehicle_identity_marks(
  p_brand text,
  p_family text DEFAULT NULL,
  p_year integer DEFAULT NULL,
  p_series text DEFAULT NULL,
  p_trim text DEFAULT NULL,
  p_body text DEFAULT NULL
)
RETURNS SETOF public.vehicle_identity_marks
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH args AS (
    SELECT
      nullif(btrim(p_brand), '') AS brand,
      nullif(btrim(p_family), '') AS family,
      p_year AS yr,
      nullif(btrim(p_series), '') AS series,
      nullif(btrim(p_trim), '') AS trim_pkg,
      nullif(btrim(p_body), '') AS body
  )
  SELECT m.*
  FROM public.vehicle_identity_marks m
  CROSS JOIN args a
  WHERE m.vetted = true
    AND a.brand IS NOT NULL
    AND lower(m.brand) = lower(a.brand)
    AND (
      a.family IS NULL
      OR m.family IS NULL
      OR lower(m.family) = lower(a.family)
      OR lower(coalesce(m.series_code, '')) = lower(a.family)
      OR position(lower(m.family) in lower(a.family)) > 0
      OR (
        lower(m.family) = 'pickup'
        AND (
          lower(a.family) IN (
            'c10', 'k10', 'c20', 'k20', 'c30', 'k30', 'r10', 'v10', 'r20', 'v20',
            '3100', '3600', '3800', 'apache', 'cameo', 'silverado',
            'c1500', 'k1500', 'c2500', 'k2500', 'c3500', 'k3500',
            'sierra', 'syclone', 's10', 's-10', 'sonoma', 'caballero',
            'f-1', 'f-100', 'f-150', 'f-250', 'f-350', 'f-450',
            'power wagon', 'd100', 'd150', 'w100', 'w150', 'w200', 'c/k'
          )
          OR lower(a.family) ~ '\y(pickup|c10|k10|c20|k20|c30|k30|3100|3600|apache|cameo|silverado|c1500|k1500|sierra|syclone|f-100|f-150|f-250|f-350|power wagon)\y'
        )
      )
    )
    AND (a.yr IS NULL OR (a.yr >= m.year_start AND a.yr <= m.year_end))
    AND (
      m.series_code IS NULL
      OR (
        a.series IS NOT NULL
        AND (
          lower(m.series_code) = lower(a.series)
          OR position(lower(m.series_code) in lower(a.series)) > 0
          OR (lower(a.series) = 'k10' AND lower(m.series_code) = 'c10')
          OR (lower(a.series) = 'k20' AND lower(m.series_code) = 'c20')
          OR (lower(a.series) = 'k30' AND lower(m.series_code) = 'c30')
          OR (lower(a.series) = 'k1500' AND lower(m.series_code) = 'c1500')
        )
      )
      OR (
        a.series IS NULL
        AND a.family IS NOT NULL
        AND (
          lower(m.series_code) = lower(a.family)
          OR position(lower(m.series_code) in lower(a.family)) > 0
          OR (lower(a.family) = 'k10' AND lower(m.series_code) = 'c10')
          OR (lower(a.family) = 'k20' AND lower(m.series_code) = 'c20')
          OR (lower(a.family) = 'k30' AND lower(m.series_code) = 'c30')
          OR (lower(a.family) = 'k1500' AND lower(m.series_code) = 'c1500')
        )
      )
      OR (
        a.series IS NULL
        AND a.trim_pkg IS NULL
        AND a.body IS NULL
        AND lower(coalesce(a.family, '')) IN ('', 'pickup', 'c/k')
      )
    )
    AND (
      m.trim_package IS NULL
      OR (
        a.trim_pkg IS NOT NULL
        AND (
          lower(m.trim_package) = lower(a.trim_pkg)
          OR lower(regexp_replace(m.trim_package, '\s*\(.*$', '')) = lower(a.trim_pkg)
        )
      )
      OR (
        a.trim_pkg IS NULL
        AND a.family IS NOT NULL
        AND (
          (
            position(lower(m.trim_package) in lower(a.family)) > 0
            AND NOT (lower(m.trim_package) = 'cheyenne' AND position('cheyenne super' in lower(a.family)) > 0)
            AND NOT (lower(m.trim_package) = 'custom' AND (position('custom deluxe' in lower(a.family)) > 0 OR position('super custom' in lower(a.family)) > 0))
            AND NOT (lower(m.trim_package) = 'sierra' AND (position('sierra grande' in lower(a.family)) > 0 OR position('sierra classic' in lower(a.family)) > 0 OR position('high sierra' in lower(a.family)) > 0))
          )
          OR (m.series_code IS NOT NULL AND lower(m.series_code) = lower(a.family) AND m.mark_kind = 'series_badge')
        )
      )
      OR (
        a.series IS NULL
        AND a.trim_pkg IS NULL
        AND a.body IS NULL
        AND lower(coalesce(a.family, '')) IN ('', 'pickup', 'c/k')
      )
    )
    AND (
      m.body_style IS NULL
      OR (
        a.body IS NOT NULL
        AND (
          lower(m.body_style) = lower(a.body)
          OR position(lower(m.body_style) in lower(a.body)) > 0
          OR position(lower(a.body) in lower(m.body_style)) > 0
        )
      )
      OR (
        a.body IS NULL
        AND a.family IS NOT NULL
        AND position(lower(m.body_style) in lower(a.family)) > 0
      )
      OR (
        a.series IS NULL
        AND a.trim_pkg IS NULL
        AND a.body IS NULL
        AND lower(coalesce(a.family, '')) IN ('', 'pickup', 'c/k')
      )
    )
  ORDER BY
    (m.trim_package IS NOT NULL) DESC,
    (m.series_code IS NOT NULL) DESC,
    (m.body_style IS NOT NULL) DESC,
    (m.family IS NOT NULL) DESC,
    (m.year_end - m.year_start) ASC,
    m.year_start DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_vehicle_identity_marks(text, text, integer, text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.vehicle_profile_read(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
WITH v AS (
  SELECT id, user_id, owner_id, uploaded_by,
         year, make, model, normalized_model, series, trim, transmission, transmission_model,
         mileage, mileage_source, canonical_body_style, body_style, engine_size, engine_type,
         drivetrain, city, state, location, listing_location, bat_location, discovery_url
  FROM public.vehicles
  WHERE id = p_vehicle_id AND deleted_at IS NULL
),
who AS (SELECT (SELECT auth.uid()) AS uid),
viewer AS (
  SELECT CASE
    WHEN who.uid IS NULL THEN 'anon'
    WHEN who.uid = v.user_id OR who.uid = v.owner_id
      OR EXISTS (SELECT 1 FROM public.ownership_verifications ov
                 WHERE ov.vehicle_id = v.id AND ov.user_id = who.uid AND ov.status = 'approved'
                   AND coalesce(ov.title_document_url, '') NOT IN ('', 'pending')
                   AND coalesce(ov.drivers_license_url, '') NOT IN ('', 'pending'))
      OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc
                 WHERE vc.vehicle_id = v.id AND vc.user_id = who.uid AND vc.role = 'owner'
                   AND coalesce(vc.status, 'active') = 'active') THEN 'owner'
    WHEN who.uid = v.uploaded_by OR public.vehicle_user_has_access(v.id, who.uid) THEN 'contributor'
    ELSE 'anon' END AS viewer
  FROM v, who
),
-- Accepted evidence for the header's fields, as the viewer may read it.
evidence AS (
  SELECT field_name, source_type, source_confidence, extracted_at,
         lower(regexp_replace(btrim(proposed_value), '\s+', ' ', 'g')) AS norm
  FROM public.field_evidence
  WHERE vehicle_id = p_vehicle_id AND status = 'accepted' AND proposed_value IS NOT NULL
    AND field_name IN ('body_style', 'engine_size', 'engine_type', 'transmission', 'drivetrain', 'mileage')
),
-- The strip's dimensions in order, the value the record holds for each, and the evidence field it is attributed under.
facets AS (
  SELECT f.ord, f.dimension, f.field, f.title_case, btrim(x.value) AS value
  FROM v
  CROSS JOIN (VALUES
    (1, 'body_style',   'body_style',   true),
    (2, 'engine',       'engine_size',  false),
    (3, 'transmission', 'transmission', true),
    (4, 'drivetrain',   'drivetrain',   false),
    (5, 'location',     NULL::text,     false)) AS f(ord, dimension, field, title_case)
  CROSS JOIN LATERAL (SELECT CASE f.dimension
      WHEN 'body_style'   THEN coalesce(nullif(v.canonical_body_style, ''), v.body_style)
      WHEN 'engine'       THEN coalesce(nullif(btrim(v.engine_size), ''), nullif(btrim(v.engine_type), ''))
      WHEN 'transmission' THEN v.transmission
      WHEN 'drivetrain'   THEN v.drivetrain
      WHEN 'location'     THEN coalesce(
        nullif(concat_ws(', ', nullif(v.city, ''), nullif(v.state, '')), ''),
        nullif(btrim(v.location), ''),
        nullif(btrim(v.listing_location), ''),
        nullif(btrim(v.bat_location), '')
      )
    END AS value) x
  WHERE x.value IS NOT NULL AND btrim(x.value) <> ''
),
-- The best accepted row whose value is what the record shows; otherwise the legacy claim.
claims AS (
  SELECT fa.ord, fa.dimension,
    CASE WHEN fa.title_case
      THEN (SELECT string_agg(CASE WHEN w ~ '^[A-Z0-9]{1,4}$' THEN w ELSE upper(left(w, 1)) || lower(substr(w, 2)) END, ' ' ORDER BY n)
            FROM regexp_split_to_table(fa.value, '\s+') WITH ORDINALITY AS t(w, n))
      ELSE fa.value END AS label,
    public.vehicle_profile_claim(to_jsonb(fa.value), NULL, e.source_type, e.source_confidence, e.extracted_at) AS member
  FROM facets fa
  LEFT JOIN LATERAL (
    SELECT e.source_type, e.source_confidence, e.extracted_at
    FROM evidence e
    WHERE fa.field IS NOT NULL
      AND (CASE WHEN fa.dimension = 'engine' THEN e.field_name IN ('engine_size', 'engine_type') ELSE e.field_name = fa.field END)
      AND e.norm = lower(regexp_replace(fa.value, '\s+', ' ', 'g'))
    ORDER BY e.source_confidence DESC NULLS LAST, e.extracted_at DESC NULLS LAST
    LIMIT 1) e ON true
),
-- A reading without a source is a guess, and a guess is not shown.
odometer AS (
  SELECT CASE
    WHEN v.mileage IS NULL OR v.mileage <= 0 THEN NULL
    WHEN e.source_type IS NOT NULL
      THEN public.vehicle_profile_claim(to_jsonb(v.mileage), 'mi', e.source_type, e.source_confidence, e.extracted_at)
    WHEN nullif(btrim(coalesce(v.mileage_source, '')), '') IS NOT NULL
      THEN jsonb_build_object('value', v.mileage, 'unit', 'mi',
             'source', jsonb_build_object('kind', k.kind, 'label', btrim(v.mileage_source)),
             'observed_at', NULL, 'trust', public.vehicle_profile_kind_trust(k.kind))
    ELSE NULL END AS claim
  FROM v
  LEFT JOIN LATERAL (
    SELECT e.source_type, e.source_confidence, e.extracted_at
    FROM evidence e
    WHERE e.field_name = 'mileage' AND e.norm = v.mileage::text
    ORDER BY e.source_confidence DESC NULLS LAST, e.extracted_at DESC NULLS LAST
    LIMIT 1) e ON true
  CROSS JOIN LATERAL (
    SELECT CASE WHEN s.sk = 'legacy' THEN 'listing' ELSE s.sk END AS kind
    FROM (SELECT public.vehicle_profile_source_kind(v.mileage_source) AS sk) s) k
),
-- The headline price as a claim: what kind of price, from which platform, as of when.
-- A recorded sale is not a bid is not an ask; an estimate is never presented as the car's price.
price AS (
  SELECT p.price_kind, p.price_amount, p.price_as_of, p.price_live, p.platform, p.source_url,
         lower(regexp_replace(coalesce(p.platform, ''), '[_\-\s]+', '', 'g')) IN
           ('craigslist', 'facebookmarketplace', 'ksl', 'kslclassifieds', 'classiccars', 'autotrader', 'carscom', 'dealersite') AS classified
  FROM public.vehicle_price_facts(ARRAY[p_vehicle_id]) p
  WHERE p.price_kind IN ('sold', 'bid', 'ask') AND p.price_amount > 0
  LIMIT 1
),
price_claim AS (
  SELECT jsonb_build_object(
           'value', p.price_amount,
           'unit', CASE WHEN p.classified THEN '' ELSE 'USD' END,
           'source', jsonb_build_object('kind', 'listing', 'url', coalesce(p.source_url, (SELECT discovery_url FROM v)),
                       'label', upper(regexp_replace(p.platform, '[-_]', ' ', 'g')), 'method', p.price_kind),
           'observed_at', p.price_as_of,
           'trust', CASE p.price_kind WHEN 'sold' THEN 0.9 WHEN 'bid' THEN 0.7 ELSE 0.5 END) AS claim,
         (CASE p.price_kind
            WHEN 'sold' THEN 'Last recorded sale'
            WHEN 'bid'  THEN CASE WHEN p.price_live THEN 'Current bid' ELSE 'High bid' END
            ELSE 'Asking' END)
         || CASE WHEN p.classified THEN ' · currency unrecorded' ELSE '' END AS label
  FROM price p
),
shown AS (
  SELECT member AS c, ord FROM claims
  UNION ALL
  SELECT claim, 99 FROM odometer WHERE claim IS NOT NULL
),
strip AS (
  SELECT (SELECT count(*) FROM shown) AS shown,
         (SELECT count(*) FROM shown WHERE c->'source'->>'kind' <> 'legacy') AS attributed,
         (SELECT max((c->>'observed_at')::timestamptz) FROM shown) AS as_of,
         (SELECT coalesce(jsonb_agg(jsonb_build_object('dimension', dimension, 'label', label, 'member', member) ORDER BY ord), '[]'::jsonb)
          FROM claims) AS facets,
         (SELECT claim FROM odometer) AS odometer
),
-- The timeline as days × kinds: every dated event the viewer may read, folded to one row per day,
-- newest first, at most 1000 days. Coverage states how many of the vehicle's events the days carry.
timeline_days AS (
  SELECT d.day, d.kinds, d.n
  FROM (
    SELECT k.event_date AS day, jsonb_object_agg(k.kind, k.n ORDER BY k.kind) AS kinds, sum(k.n) AS n
    FROM (SELECT event_date, coalesce(nullif(btrim(event_type), ''), 'event') AS kind, count(*) AS n
          FROM public.timeline_events
          WHERE vehicle_id = p_vehicle_id AND event_date IS NOT NULL
          GROUP BY 1, 2) k
    GROUP BY k.event_date
    ORDER BY k.event_date DESC
    LIMIT 1000) d
),
timeline AS (
  SELECT (SELECT count(*) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id) AS total,
         (SELECT max(created_at) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id) AS as_of,
         (SELECT coalesce(sum(n), 0) FROM timeline_days) AS dated,
         (SELECT coalesce(jsonb_agg(jsonb_build_object('day', day, 'kinds', kinds) ORDER BY day DESC), '[]'::jsonb) FROM timeline_days) AS days
),
-- The listing's full prose as captured: the newest description-capture observation the viewer may read. vehicles.description
-- is a short summary on some sources (BaT keeps 480 characters); the prose lives in the log, so the document carries it
-- beside the summary, with its source and clock. Absent when no capture is readable.
descr AS (
  SELECT jsonb_build_object(
           'text', o.content_text,
           'length', length(o.content_text),
           'source', jsonb_build_object('kind', 'listing', 'url', o.source_url, 'method', o.extraction_method),
           'observed_at', o.observed_at) AS d
  FROM public.vehicle_observations o
  WHERE o.vehicle_id = p_vehicle_id AND o.kind = 'listing'
    AND coalesce(o.is_superseded, false) = false
    AND o.structured_data ->> 'description_capture' = 'true'
    AND length(btrim(coalesce(o.content_text, ''))) > 0
  ORDER BY o.observed_at DESC NULLS LAST, length(o.content_text) DESC
  LIMIT 1
),
-- Vetted period-accurate factory marque emblems, series badges, trim plates, and body silhouettes.
identity_marks AS (
  SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) AS marks
  FROM v,
  LATERAL public.resolve_vehicle_identity_marks(
    v.make,
    COALESCE(v.normalized_model, v.model),
    v.year,
    v.series,
    v.trim,
    v.body_style
  ) m
)
SELECT jsonb_build_object(
  'vehicle_id', v.id,
  'viewer', (SELECT viewer FROM viewer),
  'read_at', now(),
  'description', (SELECT d FROM descr),
  'identity_marks', (SELECT marks FROM identity_marks),
  'sections',
    jsonb_build_array(jsonb_build_object(
      'kind', 'masthead',
      'identity_source', jsonb_build_object(
        'year', v.year, 'make', v.make, 'model', v.model, 'normalized_model', v.normalized_model,
        'series', v.series, 'trim', v.trim, 'transmission', v.transmission, 'transmission_model', v.transmission_model),
      'year', v.year, 'make', v.make, 'model', v.model,
      'price', (SELECT claim FROM price_claim),
      'priceLabel', (SELECT label FROM price_claim),
      'identity_marks', (SELECT marks FROM identity_marks)))
    || CASE WHEN s.shown > 0 THEN jsonb_build_array(jsonb_build_object(
      'kind', 'strip',
      'coverage', jsonb_build_object('n', s.attributed, 'of', s.shown, 'grain', 'facts attributed', 'as_of', s.as_of),
      'facets', s.facets,
      'odometer', s.odometer)) ELSE '[]'::jsonb END
    || CASE WHEN t.total > 0 THEN jsonb_build_array(jsonb_build_object(
      'kind', 'timeline',
      'coverage', jsonb_build_object('n', t.dated, 'of', t.total, 'grain', 'events dated', 'as_of', t.as_of),
      'days', t.days)) ELSE '[]'::jsonb END)
FROM v, strip s, timeline t;
$function$
;

REVOKE ALL ON FUNCTION public.vehicle_profile_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_profile_read(uuid) TO anon, authenticated, service_role;

COMMIT;
