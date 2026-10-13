-- vehicle_profile_read: the timeline as a section.
--
-- The page's activity strip reads the legacy RPC's last 100 timeline rows, so a vehicle with 257 events
-- shows the days of the newest 100 and nothing of the rest. The document now carries every dated event
-- the viewer may read, folded to days × kinds (one row per day, newest first, at most 1000 days), with
-- coverage: n events dated of N events, as of the latest row. One index scan per vehicle
-- (idx_timeline_events_vehicle_id); measured 257 rows on the K5 in milliseconds.
-- Same function, grants and earlier sections; guarded on the deployed source hash.
BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='1s';

DO $guard$
DECLARE p record;
BEGIN
  SELECT prosrc, prosecdef, provolatile INTO p FROM pg_proc WHERE oid = 'public.vehicle_profile_read(uuid)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc, 'UTF8')), 'base64') NOT IN
       ('IIIJkKknfHtC6kTw5b/fWgyN786ldbcw7TE+mK2Wbkw=', 'BQMNcV57K6x+2wfNjOtkC3ZYsBI5RtTWgP66abyCsBs=')
     OR p.prosecdef OR p.provolatile <> 's' THEN
    RAISE EXCEPTION 'vehicle_profile_read differs from the reviewed invoker contract';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.vehicle_profile_read(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
SET timezone = 'UTC'
AS $$
WITH v AS (
  SELECT id, user_id, owner_id, uploaded_by,
         year, make, model, normalized_model, series, trim, transmission, transmission_model,
         mileage, mileage_source, canonical_body_style, body_style, engine_size, drivetrain, city, state, location
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
    AND field_name IN ('body_style', 'engine_size', 'transmission', 'drivetrain', 'mileage')
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
      WHEN 'engine'       THEN v.engine_size
      WHEN 'transmission' THEN v.transmission
      WHEN 'drivetrain'   THEN v.drivetrain
      WHEN 'location'     THEN coalesce(nullif(concat_ws(', ', nullif(v.city, ''), nullif(v.state, '')), ''), v.location)
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
    WHERE fa.field IS NOT NULL AND e.field_name = fa.field
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
           'source', jsonb_build_object('kind', 'listing', 'url', p.source_url,
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
)
SELECT jsonb_build_object(
  'vehicle_id', v.id,
  'viewer', (SELECT viewer FROM viewer),
  'read_at', now(),
  'sections',
    jsonb_build_array(jsonb_build_object(
      'kind', 'masthead',
      'identity_source', jsonb_build_object(
        'year', v.year, 'make', v.make, 'model', v.model, 'normalized_model', v.normalized_model,
        'series', v.series, 'trim', v.trim, 'transmission', v.transmission, 'transmission_model', v.transmission_model),
      'year', v.year, 'make', v.make, 'model', v.model,
      'price', (SELECT claim FROM price_claim),
      'priceLabel', (SELECT label FROM price_claim)))
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
$$;

COMMENT ON FUNCTION public.vehicle_profile_read(uuid) IS
  'The vehicle page as one ProfileDocument (nuke_frontend/src/kit/types.ts): masthead (identity_source, the typed price as a Claim), strip (facets and odometer as Claims; coverage n of N facts attributed, as_of) and timeline (days × kinds; coverage n events dated of N events, as_of). Viewer is anon, contributor or owner from auth.uid(). SECURITY INVOKER: row policies on vehicles, field_evidence and timeline_events bound what each viewer reads; NULL when the vehicle is not visible to the caller. Reads vehicles, field_evidence (accepted header fields), vehicle_price_facts, ownership_verifications, vehicle_contributors, timeline_events.';
COMMIT;
