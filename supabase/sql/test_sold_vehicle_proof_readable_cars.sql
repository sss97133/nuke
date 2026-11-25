-- Empty disposable PG17 only:
--   createdb dm_refinement_svp; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_svp -f this-file.sql
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture rows in the disposable contract database.
-- Proves 20261126081500_sold_vehicle_proof_readable_cars.sql on the live view (its pg_get_viewdef md5 equals the live
-- one, read 2026-11-25):
--   0 before: anon reads the sold links of a private and a deleted car, with their VINs;
--   1 after: anon reads only the readable car's link;
--   2 an active owner of the organization still reads all its sold links (sale_price included); a signed-in stranger
--     reads only the readable one;
--   3 security_barrier: a caller's cheap volatile filter never sees a row the gate drops (it did before);
--   4 anon keeps SELECT; a re-run is a no-op; a drifted view is refused, not edited; view_write_guard accepts it.
-- Fixture: the shared profile fixture (vehicles, organization_vehicles, organization_contributors, timeline_events,
-- external_listings as live), data_validations as live (columns, NOT NULL, defaults, keys; checks left out), the
-- predicate and caller_manages_organization as live.
\set ON_ERROR_STOP on
\ir helpers/get_vehicle_profile_data_fixture_20261125.sql
CREATE FUNCTION public.vehicle_publicly_readable(p_is_public boolean, p_deleted_at timestamptz, p_merged_into_vehicle_id uuid)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT coalesce(p_is_public, false) AND (p_deleted_at IS NULL OR p_merged_into_vehicle_id IS NOT NULL)
$function$;
REVOKE ALL ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) TO anon, authenticated, service_role;
CREATE FUNCTION public.caller_manages_organization(p_organization_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_contributors oc
    WHERE oc.organization_id = p_organization_id
      AND oc.user_id = auth.uid()
      AND oc.status = 'active'
      AND oc.role IN ('owner', 'manager', 'board_member')), false)
$function$;
REVOKE ALL ON FUNCTION public.caller_manages_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_manages_organization(uuid) TO anon, authenticated, service_role;
CREATE TABLE public.data_validations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  field_name text NOT NULL,
  field_value text NOT NULL,
  validation_source text NOT NULL,
  validated_by uuid,
  confidence_score integer DEFAULT 50,
  source_url text,
  source_document_id uuid,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (validated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);
\ir ../migrations/20261014214500_view_write_guard.sql
-- The live view, 2026-11-25 (pg_get_viewdef), also the reversal's source.
CREATE VIEW public.sold_vehicle_proof AS
 SELECT ov.id AS org_vehicle_id,
    ov.vehicle_id,
    ov.organization_id,
    ov.listing_status,
    ov.sale_date,
        CASE
            WHEN caller_manages_organization(ov.organization_id) THEN ov.sale_price
            ELSE NULL::numeric
        END AS sale_price,
    ov.relationship_type,
    ov.created_at AS marked_sold_at,
    ov.notes AS org_vehicle_notes,
    v.year,
    v.make,
    v.model,
    v.vin,
    COALESCE(el.listing_url, v.bat_auction_url, (te.metadata ->> 'bat_url'::text), v.discovery_url) AS proof_url,
    COALESCE(el.platform,
        CASE
            WHEN ((v.bat_auction_url IS NOT NULL) OR ((te.metadata ->> 'bat_url'::text) IS NOT NULL)) THEN 'bat'::text
            WHEN (v.discovery_url ~~ '%bringatrailer%'::text) THEN 'bat'::text
            WHEN (v.discovery_url ~~ '%carsandbids%'::text) THEN 'cars_and_bids'::text
            WHEN (v.discovery_url ~~ '%ebay%'::text) THEN 'ebay_motors'::text
            ELSE 'unknown'::text
        END) AS proof_platform,
    el.id AS external_listing_id,
    el.listing_status AS external_listing_status,
    el.final_price AS external_final_price,
    el.sold_at AS external_sold_at,
    el.end_date AS external_end_date,
    te.id AS timeline_event_id,
    te.event_date AS timeline_sale_date,
    te.title AS timeline_title,
    te.description AS timeline_description,
    te.cost_amount AS timeline_sale_price,
    (te.metadata ->> 'source'::text) AS timeline_source,
    (te.metadata ->> 'bat_url'::text) AS timeline_bat_url,
    (te.metadata ->> 'lot_number'::text) AS lot_number,
    ( SELECT json_agg(json_build_object('field', dv.field_name, 'value', dv.field_value, 'source', dv.validation_source, 'confidence', dv.confidence_score, 'url', dv.source_url)) AS json_agg
           FROM data_validations dv
          WHERE ((dv.entity_type = 'vehicle'::text) AND (dv.entity_id = ov.vehicle_id) AND (dv.field_name = ANY (ARRAY['sale_price'::text, 'sale_date'::text])) AND (dv.validation_source ~~ '%bat%'::text))) AS validation_proof,
        CASE
            WHEN (el.id IS NOT NULL) THEN 'external_listing'::text
            WHEN ((te.id IS NOT NULL) AND ((te.metadata ->> 'source'::text) = 'bat_import'::text)) THEN 'timeline_bat_import'::text
            WHEN (v.bat_auction_url IS NOT NULL) THEN 'vehicle_bat_url'::text
            WHEN (te.id IS NOT NULL) THEN 'timeline_event'::text
            WHEN ((ov.notes ~~ '%BaT%'::text) OR (ov.notes ~~ '%bringatrailer%'::text)) THEN 'notes_reference'::text
            ELSE 'manual_mark'::text
        END AS proof_type,
        CASE
            WHEN ((el.id IS NOT NULL) AND (el.listing_status = 'sold'::text) AND (el.final_price IS NOT NULL)) THEN 100
            WHEN ((te.id IS NOT NULL) AND ((te.metadata ->> 'source'::text) = 'bat_import'::text) AND (te.cost_amount IS NOT NULL)) THEN 90
            WHEN ((v.bat_auction_url IS NOT NULL) AND (ov.sale_price IS NOT NULL)) THEN 80
            WHEN ((te.id IS NOT NULL) AND (te.event_type = 'sale'::text)) THEN 70
            WHEN ((ov.notes ~~ '%BaT%'::text) OR (ov.notes ~~ '%bringatrailer%'::text)) THEN 60
            ELSE 50
        END AS proof_confidence
   FROM (((organization_vehicles ov
     JOIN vehicles v ON ((v.id = ov.vehicle_id)))
     LEFT JOIN external_listings el ON (((el.vehicle_id = ov.vehicle_id) AND (el.organization_id = ov.organization_id) AND (el.listing_status = 'sold'::text))))
     LEFT JOIN timeline_events te ON (((te.vehicle_id = ov.vehicle_id) AND (te.event_type = 'sale'::text))))
  WHERE (ov.listing_status = 'sold'::text);
GRANT ALL ON public.sold_vehicle_proof TO anon, authenticated, service_role;
DO $$ BEGIN
  ASSERT md5(pg_get_viewdef('public.sold_vehicle_proof'::regclass)) = '19a5c9e59fae46625eb706a434b3f12a',
    'fixture view equals the live definition';
END $$;

-- Made-up rows. Users: 0a owns organization aa; 0b is a stranger. Cars: 1111 public, 2222 private, 3333 public but
-- deleted (not merged). Each has a sold link from aa and a sale timeline event.
INSERT INTO auth.users (id) VALUES ('0a000000-0000-4000-8000-00000000000a'), ('0b000000-0000-4000-8000-00000000000b');
INSERT INTO public.profiles (id) VALUES ('0a000000-0000-4000-8000-00000000000a'), ('0b000000-0000-4000-8000-00000000000b');
INSERT INTO public.vehicles (id, is_public, deleted_at, make, model, year, vin) VALUES
  ('11111111-1111-4111-8111-111111111111', true,  NULL,  'Pubmake',  'Public',  1970, 'FIXTUREVINPUBLIC1'),
  ('22222222-2222-4222-8222-222222222222', false, NULL,  'Privmake', 'Private', 1971, 'FIXTUREVINPRIVATE'),
  ('33333333-3333-4333-8333-333333333333', true,  now(), 'Delmake',  'Deleted', 1972, 'FIXTUREVINDELETED');
INSERT INTO public.organization_contributors (id, organization_id, user_id, role, status)
VALUES ('c0000000-0000-4000-8000-0000000000c0', 'aa000000-0000-4000-8000-0000000000aa', '0a000000-0000-4000-8000-00000000000a', 'owner', 'active');
INSERT INTO public.organization_vehicles (id, organization_id, vehicle_id, relationship_type, status, listing_status, sale_price, created_at)
SELECT ('0' || n || '000000-0000-4000-8000-00000000000' || n)::uuid, 'aa000000-0000-4000-8000-0000000000aa', v::uuid,
       'sold_by', 'past', 'sold', 1000 * n, now()
  FROM (VALUES (1, '11111111-1111-4111-8111-111111111111'), (2, '22222222-2222-4222-8222-222222222222'),
               (3, '33333333-3333-4333-8333-333333333333')) x(n, v);
INSERT INTO public.timeline_events (id, vehicle_id, event_type, title, description, event_date)
SELECT ('e' || n || '000000-0000-4000-8000-0000000000e' || n)::uuid, v::uuid, 'sale', 'Sold ' || n, 'Sale note ' || n, current_date
  FROM (VALUES (1, '11111111-1111-4111-8111-111111111111'), (2, '22222222-2222-4222-8222-222222222222'),
               (3, '33333333-3333-4333-8333-333333333333')) x(n, v);

CREATE FUNCTION pg_temp.read_as(p_uid text) RETURNS TABLE (vehicle_id uuid, vin text, sale_price numeric, timeline_description text)
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.t_claims(p_uid);
  IF p_uid = '' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
  RETURN QUERY SELECT s.vehicle_id, s.vin, s.sale_price, s.timeline_description FROM public.sold_vehicle_proof s
                ORDER BY s.vehicle_id;
  RESET ROLE;
  PERFORM public.t_claims('none');
END $$;

-- 0. Before: anon reads every sold link, private and deleted cars included.
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM pg_temp.read_as('')) = 3, '0 anon reads all 3 sold links';
  ASSERT EXISTS (SELECT 1 FROM pg_temp.read_as('') WHERE vin = 'FIXTUREVINPRIVATE'), '0 anon reads the private VIN';
END $$;

-- For case 3: a cheap volatile filter a caller could pass, recording every vin it is evaluated on.
CREATE TEMP TABLE seen (v text);
GRANT ALL ON seen TO anon;
CREATE FUNCTION pg_temp.peek(text) RETURNS boolean LANGUAGE plpgsql VOLATILE COST 0.0001 AS $$
BEGIN INSERT INTO seen VALUES ($1); RETURN true; END $$;
CREATE FUNCTION pg_temp.peek_as_anon() RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM public.t_claims('');
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.sold_vehicle_proof s WHERE pg_temp.peek(s.vin);
  RESET ROLE;
  PERFORM public.t_claims('none');
END $$;

CREATE TEMP TABLE live_def AS SELECT pg_get_viewdef('public.sold_vehicle_proof'::regclass) AS d;
\ir ../migrations/20261126081500_sold_vehicle_proof_readable_cars.sql

-- 1. After: anon reads only the readable car's link.
DO $$ BEGIN
  ASSERT (SELECT array_agg(vehicle_id::text) FROM pg_temp.read_as('')) = ARRAY['11111111-1111-4111-8111-111111111111'],
    '1 anon reads only the readable car';
  ASSERT (SELECT sale_price FROM pg_temp.read_as('')) IS NULL, '1 anon gets no sale_price';
END $$;

-- 2. The organization's owner keeps all three, with sale_price; a stranger reads only the readable one.
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM pg_temp.read_as('0a000000-0000-4000-8000-00000000000a')) = 3, '2 owner reads all 3';
  ASSERT (SELECT sale_price FROM pg_temp.read_as('0a000000-0000-4000-8000-00000000000a')
           WHERE vehicle_id = '22222222-2222-4222-8222-222222222222') = 2000, '2 owner reads the private sale_price';
  ASSERT (SELECT array_agg(vehicle_id::text) FROM pg_temp.read_as('0b000000-0000-4000-8000-00000000000b'))
         = ARRAY['11111111-1111-4111-8111-111111111111'], '2 stranger reads only the readable car';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_temp.read_as('0b000000-0000-4000-8000-00000000000b')
                      WHERE timeline_description IN ('Sale note 2', 'Sale note 3')), '2 stranger reads no hidden sale event';
END $$;

-- 3. With the barrier the caller's filter sees only rows the gate passed.
TRUNCATE seen;
SELECT pg_temp.peek_as_anon();
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM seen WHERE v IN ('FIXTUREVINPRIVATE', 'FIXTUREVINDELETED')),
    format('3 the filter saw a dropped row: %s', (SELECT array_agg(v) FROM seen));
  ASSERT EXISTS (SELECT 1 FROM seen WHERE v = 'FIXTUREVINPUBLIC1'), '3 the filter ran';
END $$;

-- 4. Privileges kept, re-run no-op, drift refused.
\ir ../migrations/20261126081500_sold_vehicle_proof_readable_cars.sql
DO $$
DECLARE d text := pg_get_viewdef('public.sold_vehicle_proof'::regclass);
BEGIN
  ASSERT has_table_privilege('anon', 'public.sold_vehicle_proof', 'SELECT')
     AND has_table_privilege('authenticated', 'public.sold_vehicle_proof', 'SELECT'), '4 SELECT kept';
  ASSERT (length(d) - length(replace(d, 'vehicle_publicly_readable(', ''))) / length('vehicle_publicly_readable(') = 1,
    '4 one gate after a re-run';
  ASSERT (SELECT 'security_barrier=true' = ANY (reloptions) FROM pg_class WHERE oid = 'public.sold_vehicle_proof'::regclass),
    '4 security_barrier';
END $$;
DO $$
DECLARE d text := (SELECT d FROM live_def);
BEGIN
  -- the live read with one literal changed: neither the 2026-11-25 view nor this migration's result
  ASSERT position('''manual_mark''::text' IN d) > 0, 'drift anchor';
  EXECUTE 'CREATE OR REPLACE VIEW public.sold_vehicle_proof WITH (security_barrier = false) AS '
          || replace(rtrim(d, ';'), '''manual_mark''::text', '''manual_mark_2''::text');
END $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261126081500_sold_vehicle_proof_readable_cars.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  ASSERT position('vehicle_publicly_readable(' IN pg_get_viewdef('public.sold_vehicle_proof'::regclass)) = 0,
    '4 drifted view refused, not edited';
END $$;
SELECT 'PASS: sold_vehicle_proof lists only readable cars to the public, all to the organization''s managers' AS result;
