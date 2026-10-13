-- vehicle_profile_read: the vehicle page's header as one typed, viewer-scoped document.
--
-- The shape is nuke_frontend/src/kit/types.ts (ProfileDocument): every fact is a Claim with its
-- source, clock and trust, and the strip carries its coverage (n of N facts attributed, as of a
-- clock). It replaces the client-side adapter nuke_frontend/src/pages/vehicle-profile/
-- profileDocument.ts, so the vehicle row, vehicle_price_facts and field_evidence become one read.
--
-- SECURITY INVOKER: the viewer's own row policies on vehicles and field_evidence decide what is
-- read, so an anonymous document can never carry an attribution from a receipt, invoice or
-- statement, and a private vehicle reads as NULL for anyone its policies exclude.
--
-- Identity tokens (the title's display hygiene) stay in the client; the masthead ships the raw
-- identity columns as identity_source for it. Every clock in the document is rendered in UTC.
-- No table, policy, row, cron or grant changes beyond EXECUTE on the four new functions.
BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='1s';

DO $guard$ BEGIN
  IF to_regprocedure('public.vehicle_price_facts(uuid[])') IS NULL
     OR to_regprocedure('public.vehicle_user_has_access(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'vehicle_profile_read reads vehicle_price_facts and vehicle_user_has_access; one is missing';
  END IF;
END $guard$;

-- field_evidence.source_type names a method; the kit wants an evidence class.
CREATE OR REPLACE FUNCTION public.vehicle_profile_source_kind(p_source_type text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN s = '' OR s IN ('vehicle_record', 'system_update') THEN 'legacy'
    WHEN s ~ '(pixel|image|photo|plate|exif)' THEN 'image'
    WHEN s ~ '(listing|trailer|\ybat\y|auction|craigslist|classified|marketplace)' THEN 'listing'
    WHEN s ~ '(manual|documentation|corpus|spid|rpo|title|receipt|document|invoice)' THEN 'document'
    WHEN s ~ '(owner|user)' THEN 'owner'
    WHEN s ~ '(agent|llm|claude|gpt|vision|model)' THEN 'agent'
    ELSE 'legacy' END
  FROM (SELECT lower(coalesce(p_source_type, ''))) AS t(s);
$$;

-- Declared reader calibration by evidence class, used only when a row carries no confidence of its own.
CREATE OR REPLACE FUNCTION public.vehicle_profile_kind_trust(p_kind text)
RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE p_kind
    WHEN 'owner' THEN 0.9 WHEN 'document' THEN 0.85 WHEN 'image' THEN 0.8 WHEN 'listing' THEN 0.6
    WHEN 'agent' THEN 0.5 WHEN 'model' THEN 0.4 ELSE 0.3 END;
$$;

-- One Claim: the value, who said it, when it was observed, how far to trust it (0 to 1).
-- Without a source type it is the legacy record: trusted a little, never ranked as evidence.
CREATE OR REPLACE FUNCTION public.vehicle_profile_claim(
  p_value jsonb, p_unit text, p_source_type text, p_confidence integer, p_observed_at timestamptz)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
SET timezone = 'UTC'
AS $$
  SELECT jsonb_build_object(
           'value', p_value,
           'source', CASE WHEN p_source_type IS NULL
                          THEN jsonb_build_object('kind', 'legacy', 'label', 'vehicle record')
                          ELSE jsonb_build_object('kind', k.kind, 'label', replace(p_source_type, '_', ' '), 'method', p_source_type) END,
           'observed_at', CASE WHEN p_source_type IS NULL THEN NULL ELSE p_observed_at END,
           'trust', CASE WHEN p_source_type IS NULL THEN 0.3
                         WHEN p_confidence IS NOT NULL THEN round(least(1, greatest(0, p_confidence / 100.0)), 2)
                         ELSE public.vehicle_profile_kind_trust(k.kind) END)
         || CASE WHEN p_unit IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('unit', p_unit) END
  FROM (SELECT public.vehicle_profile_source_kind(p_source_type) AS kind) k;
$$;

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
      THEN (SELECT string_agg(upper(left(w, 1)) || lower(substr(w, 2)), ' ' ORDER BY n)
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
      'odometer', s.odometer)) ELSE '[]'::jsonb END)
FROM v, strip s;
$$;

COMMENT ON FUNCTION public.vehicle_profile_source_kind(text) IS
  'Maps a field_evidence.source_type (a method name) to the kit''s evidence class: listing, owner, image, document, agent, model or legacy.';
COMMENT ON FUNCTION public.vehicle_profile_kind_trust(text) IS
  'Declared reader calibration (0 to 1) by evidence class, used when a row carries no confidence of its own.';
COMMENT ON FUNCTION public.vehicle_profile_claim(jsonb, text, text, integer, timestamptz) IS
  'One kit Claim as jsonb: value, unit, source {kind, label, method}, observed_at, trust. A NULL source type is the legacy record (trust 0.3, no clock).';
COMMENT ON FUNCTION public.vehicle_profile_read(uuid) IS
  'The vehicle page''s header as one ProfileDocument (nuke_frontend/src/kit/types.ts): masthead (identity_source, the typed price as a Claim) and strip (facets and odometer as Claims; coverage n of N facts attributed, as_of). Viewer is anon, contributor or owner from auth.uid(). SECURITY INVOKER: row policies on vehicles and field_evidence bound what each viewer reads; NULL when the vehicle is not visible to the caller. Reads vehicles, field_evidence (accepted header fields), vehicle_price_facts, ownership_verifications, vehicle_contributors.';

REVOKE ALL ON FUNCTION
  public.vehicle_profile_source_kind(text),
  public.vehicle_profile_kind_trust(text),
  public.vehicle_profile_claim(jsonb, text, text, integer, timestamptz),
  public.vehicle_profile_read(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.vehicle_profile_source_kind(text),
  public.vehicle_profile_kind_trust(text),
  public.vehicle_profile_claim(jsonb, text, text, integer, timestamptz),
  public.vehicle_profile_read(uuid)
TO anon, authenticated, service_role;

COMMIT;
