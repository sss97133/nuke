-- Empty disposable PG17 only:
--   createdb dm_refinement_svp; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_svp -f this-file.sql
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture rows in the disposable contract database.
-- Proves 20261126121500_sold_vehicle_proof_tied_org_link.sql on production's view: the fixture view equals the live one
-- before 20261126081500 (md5 read 2026-11-25), 20261126081500 (#3998, live) runs, and the result equals the live view now
-- (md5 read 2026-11-26); then:
--   0 before (081500 alone): anon reads the sold links of a private and a deleted car; after 081500 the owner of a
--     self-made organization reads a stranger's private sold car it linked (the defect this closes);
--   1 after: anon reads only the readable car's link;
--   2 an active owner of the organization still reads all its sold links (sale_price included) through a tied linker; a
--     signed-in stranger reads only the readable one; 2b the owner of a self-made organization does not read a
--     stranger's private car it linked; 2c anon never reaches organization_vehicle_link_grants (0 calls, no EXECUTE),
--     nor does a signed-in caller who manages no organization; the wrapper is registered; 2d called directly, the wrapper
--     answers false, without an error, for another organization's link, an unknown id and anon;
--   3 security_barrier: a caller's cheap volatile filter never sees a row the gate drops;
--   4 anon keeps SELECT; a re-run is a no-op; a drifted view is refused, not edited; view_write_guard accepts it;
--     4b a changed organization-member image policy is refused before anything is registered.
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
-- organization_vehicle_link_grants and the linker stamp trigger it checks, as live (20261126031500, 2026-11-25), with
-- the live ACL (anon cannot execute it).
CREATE OR REPLACE FUNCTION public.stamp_organization_vehicle_linker()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.linked_by_user_id := auth.uid();
  ELSIF (NEW.vehicle_id, NEW.organization_id, NEW.relationship_type, NEW.status, NEW.linked_by_user_id)
        IS DISTINCT FROM (OLD.vehicle_id, OLD.organization_id, OLD.relationship_type, OLD.status, OLD.linked_by_user_id) THEN
    NEW.linked_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END $function$
;
CREATE TRIGGER trg_stamp_organization_vehicle_linker BEFORE INSERT OR UPDATE ON public.organization_vehicles FOR EACH ROW EXECUTE FUNCTION stamp_organization_vehicle_linker();
CREATE OR REPLACE FUNCTION public.organization_vehicle_link_grants(p_vehicle_id uuid, p_linker uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
           WHERE t.tgrelid = 'public.organization_vehicles'::regclass
             AND t.tgname = 'trg_stamp_organization_vehicle_linker'
             AND t.tgenabled IN ('O', 'A') AND (t.tgtype & 23) = 23
             AND p.pronamespace = 'public'::regnamespace AND p.proname = 'stamp_organization_vehicle_linker'
             AND md5(p.prosrc) = '9e8299a8e5024d4404e03d55ced96413') -- gitleaks:allow (function-body fingerprint, not a secret)
     AND (p_linker IS NULL
          OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id
                       AND p_linker IN (v.uploaded_by, v.user_id, v.owner_id, v.created_by_user_id))
          OR public.vehicle_user_has_access(p_vehicle_id, p_linker))
$function$;
REVOKE ALL ON FUNCTION public.organization_vehicle_link_grants(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_vehicle_link_grants(uuid, uuid) TO authenticated, service_role;
-- vehicle_images' organization-member read policy as live (20261126034500), and private_row_policy_copies with its
-- hash function as live (20261125204500, first_recorded_at from 20261126013700).
CREATE POLICY "Organization members can view org vehicle images" ON public.vehicle_images FOR SELECT TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (organization_vehicles ov
     JOIN organization_contributors oc ON ((ov.organization_id = oc.organization_id)))
  WHERE ((ov.vehicle_id = vehicle_images.vehicle_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text) AND
        CASE
            WHEN (oc.status = 'active'::text) THEN organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id)
            ELSE false
        END)));
CREATE TABLE public.private_row_policy_copies (
  reader        text NOT NULL CHECK (reader ~ '^[a-z_][a-z0-9_]*\(([a-z_][a-z0-9_ ]*(\[\])?(, *[a-z_][a-z0-9_ ]*(\[\])?)*)?\)$'),
  relation      text NOT NULL CHECK (relation ~ '^[a-z_][a-z0-9_]*$'),
  policy_filter text NOT NULL CHECK (policy_filter <> '' AND position(';' IN policy_filter) = 0),
  recorded_hash text NOT NULL CHECK (recorded_hash ~ '^[0-9a-f]{32}$'),
  owner_lane    text NOT NULL,
  note          text NOT NULL CHECK (note <> ''),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  active        boolean NOT NULL DEFAULT true,
  first_recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reader, relation, policy_filter)
);
CREATE FUNCTION public.private_row_policy_hash(p_relation text, p_policy_filter text)
RETURNS TABLE (policy_hash text, policies int) LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $f$
BEGIN
  IF p_relation !~ '^[a-z_][a-z0-9_]*$' OR position(';' IN p_policy_filter) > 0 THEN
    RAISE EXCEPTION 'private_row_policy_hash: bad relation or filter';
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT md5(string_agg(p.policyname || '':'' || p.permissive || '':'' || p.cmd || '':'' || p.roles::text || '':'' || coalesce(p.qual, ''''),
                           ''|'' ORDER BY p.policyname)), count(*)::int
       FROM pg_catalog.pg_policies p WHERE p.schemaname = ''public'' AND p.tablename = %L AND (%s)', p_relation, p_policy_filter);
END $f$;
DO $$ BEGIN
  ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.stamp_organization_vehicle_linker()'::regprocedure)
         = '9e8299a8e5024d4404e03d55ced96413', 'fixture stamp trigger body as live'; -- gitleaks:allow (function-body fingerprint, not a secret)
  ASSERT (SELECT h.policy_hash FROM public.private_row_policy_hash('vehicle_images',
            'p.policyname = ''Organization members can view org vehicle images''') h)
         = '5294ed44f4d29e6d2e51225209975cb4', 'fixture organization-member image policy hash as live';
END $$;
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
  ASSERT md5(pg_get_viewdef('public.sold_vehicle_proof'::regclass)) = '19a5c9e59fae46625eb706a434b3f12a', -- gitleaks:allow (view definition hash, not a secret)
    'fixture view equals the live definition';
END $$;

-- Made-up rows. Users: 0a owns organization aa; 0b is a stranger; 0d owns the private car 2222 and made aa's link to it
-- (a linker tied to the car, so the manager keeps it through link_grants' tie arm, not only its NULL-linker arm). Cars:
-- 1111 public, 2222 private, 3333 public but deleted (not merged). Each has a sold link from aa and a sale timeline event.
INSERT INTO auth.users (id) VALUES ('0a000000-0000-4000-8000-00000000000a'), ('0b000000-0000-4000-8000-00000000000b'),
  ('0d000000-0000-4000-8000-00000000000d');
INSERT INTO public.profiles (id) VALUES ('0a000000-0000-4000-8000-00000000000a'), ('0b000000-0000-4000-8000-00000000000b'),
  ('0d000000-0000-4000-8000-00000000000d');
INSERT INTO public.vehicles (id, is_public, deleted_at, make, model, year, vin, user_id) VALUES
  ('11111111-1111-4111-8111-111111111111', true,  NULL,  'Pubmake',  'Public',  1970, 'FIXTUREVINPUBLIC1', NULL),
  ('22222222-2222-4222-8222-222222222222', false, NULL,  'Privmake', 'Private', 1971, 'FIXTUREVINPRIVATE',
   '0d000000-0000-4000-8000-00000000000d'),
  ('33333333-3333-4333-8333-333333333333', true,  now(), 'Delmake',  'Deleted', 1972, 'FIXTUREVINDELETED', NULL);
INSERT INTO public.organization_contributors (id, organization_id, user_id, role, status)
VALUES ('c0000000-0000-4000-8000-0000000000c0', 'aa000000-0000-4000-8000-0000000000aa', '0a000000-0000-4000-8000-00000000000a', 'owner', 'active');
INSERT INTO public.organization_vehicles (id, organization_id, vehicle_id, relationship_type, status, listing_status, sale_price, created_at)
SELECT ('0' || n || '000000-0000-4000-8000-00000000000' || n)::uuid, 'aa000000-0000-4000-8000-0000000000aa', v::uuid,
       'sold_by', 'past', 'sold', 1000 * n, now()
  FROM (VALUES (1, '11111111-1111-4111-8111-111111111111'), (2, '22222222-2222-4222-8222-222222222222'),
               (3, '33333333-3333-4333-8333-333333333333')) x(n, v);
UPDATE public.organization_vehicles SET linked_by_user_id = '0d000000-0000-4000-8000-00000000000d'
 WHERE id = '02000000-0000-4000-8000-000000000002';
INSERT INTO public.timeline_events (id, vehicle_id, event_type, title, description, event_date)
SELECT ('e' || n || '000000-0000-4000-8000-0000000000e' || n)::uuid, v::uuid, 'sale', 'Sold ' || n, 'Sale note ' || n, current_date
  FROM (VALUES (1, '11111111-1111-4111-8111-111111111111'), (2, '22222222-2222-4222-8222-222222222222'),
               (3, '33333333-3333-4333-8333-333333333333')) x(n, v);

-- 0c makes its own organization bb, is its active owner, and links the stranger's private sold car 2222 (skeptic2's
-- three inserts; the linker is 0c, as the stamp trigger sets it for a signed-in insert).
INSERT INTO auth.users (id) VALUES ('0c000000-0000-4000-8000-00000000000c');
INSERT INTO public.profiles (id) VALUES ('0c000000-0000-4000-8000-00000000000c');
INSERT INTO public.organization_contributors (id, organization_id, user_id, role, status)
VALUES ('c1000000-0000-4000-8000-0000000000c1', 'bb000000-0000-4000-8000-0000000000bb', '0c000000-0000-4000-8000-00000000000c', 'owner', 'active');
INSERT INTO public.organization_vehicles (id, organization_id, vehicle_id, relationship_type, status, listing_status, sale_price,
                                          linked_by_user_id, created_at)
VALUES ('0c000000-0000-4000-8000-0000000000c2', 'bb000000-0000-4000-8000-0000000000bb', '22222222-2222-4222-8222-222222222222',
        'sold_by', 'past', 'sold', 9999, '0c000000-0000-4000-8000-00000000000c', now());

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
  ASSERT (SELECT count(*) FROM pg_temp.read_as('')) = 4, '0 anon reads all 4 sold links';
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
RESET statement_timeout;
RESET lock_timeout;
DO $$ BEGIN
  ASSERT md5(pg_get_viewdef('public.sold_vehicle_proof'::regclass)) = '2cc5f9e239c7a0b6828e8496091dc0d4', -- gitleaks:allow (view definition hash, not a secret)
    'fixture view after 20261126081500 equals the live view';
  ASSERT EXISTS (SELECT 1 FROM pg_temp.read_as('0c000000-0000-4000-8000-00000000000c') WHERE vin = 'FIXTUREVINPRIVATE'),
    '0 the defect on production''s view: the self-made organization''s owner reads the private VIN';
END $$;
CREATE TEMP TABLE live_def2 AS SELECT pg_get_viewdef('public.sold_vehicle_proof'::regclass) AS d;
\ir ../migrations/20261126121500_sold_vehicle_proof_tied_org_link.sql

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
  ASSERT (SELECT linked_by_user_id FROM public.organization_vehicles WHERE id = '02000000-0000-4000-8000-000000000002')
         = '0d000000-0000-4000-8000-00000000000d', '2 the private link has a tied, non-NULL linker';
  ASSERT (SELECT array_agg(vehicle_id::text) FROM pg_temp.read_as('0b000000-0000-4000-8000-00000000000b'))
         = ARRAY['11111111-1111-4111-8111-111111111111'], '2 stranger reads only the readable car';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_temp.read_as('0b000000-0000-4000-8000-00000000000b')
                      WHERE timeline_description IN ('Sale note 2', 'Sale note 3')), '2 stranger reads no hidden sale event';
END $$;

-- 2b. The self-made organization's owner reads no private car through its own link: the link's linker (0c) is not tied
--     to 2222, so organization_vehicle_link_grants refuses it; 0c reads the readable car only.
DO $$ BEGIN
  ASSERT (SELECT array_agg(DISTINCT vehicle_id::text) FROM pg_temp.read_as('0c000000-0000-4000-8000-00000000000c'))
         = ARRAY['11111111-1111-4111-8111-111111111111'],
    format('2b self-made organization reads a private car: %s',
           (SELECT array_agg(vehicle_id::text) FROM pg_temp.read_as('0c000000-0000-4000-8000-00000000000c')));
  ASSERT NOT EXISTS (SELECT 1 FROM pg_temp.read_as('0c000000-0000-4000-8000-00000000000c') WHERE vin = 'FIXTUREVINPRIVATE'),
    '2b no private VIN';
  ASSERT (SELECT sale_price FROM pg_temp.read_as('0c000000-0000-4000-8000-00000000000c')) IS NULL,
    '2b no sale_price on another organization''s link';
END $$;

-- calls_during(uid): organization_vehicle_link_grants calls while uid reads the view (a delta: the backend's pending
-- function counters can still hold calls from earlier transactions that were not flushed yet).
CREATE FUNCTION pg_temp.calls_during(p_uid text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE c0 bigint := coalesce(pg_stat_get_xact_function_calls('public.organization_vehicle_link_grants(uuid,uuid)'::regprocedure), 0);
BEGIN
  PERFORM count(*) FROM pg_temp.read_as(p_uid);
  RETURN coalesce(pg_stat_get_xact_function_calls('public.organization_vehicle_link_grants(uuid,uuid)'::regprocedure), 0) - c0;
END $$;
-- 2c. anon never reaches organization_vehicle_link_grants (0 calls) and cannot execute it; a signed-in manager does
--     (the counter works); the wrapper is executable by both and registered as a policy copy.
SET track_functions = 'all';
DO $$
DECLARE a bigint := pg_temp.calls_during(''); m bigint := pg_temp.calls_during('0a000000-0000-4000-8000-00000000000a');
BEGIN
  ASSERT a = 0, format('2c anon reached link_grants %s times', a);
  ASSERT m > 0, '2c the counter sees a manager''s calls';
END $$;
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.organization_vehicle_link_grants(uuid,uuid)', 'EXECUTE'), '2c anon has no link_grants';
  ASSERT has_function_privilege('anon', 'public.caller_manages_tied_org_link(uuid)', 'EXECUTE')
     AND has_function_privilege('authenticated', 'public.caller_manages_tied_org_link(uuid)', 'EXECUTE'), '2c wrapper executable';
  ASSERT (SELECT recorded_hash FROM public.private_row_policy_copies WHERE reader = 'caller_manages_tied_org_link(uuid)'
            AND relation = 'vehicle_images') = '5294ed44f4d29e6d2e51225209975cb4', '2c registered with the live hash';
  ASSERT to_regprocedure((SELECT reader FROM public.private_row_policy_copies WHERE reader = 'caller_manages_tied_org_link(uuid)'))
         IS NOT NULL, '2c registry key resolves';
END $$;

-- 2c'. A signed-in caller who manages no organization (the stranger 0b) never reaches organization_vehicle_link_grants.
DO $$
DECLARE n bigint := pg_temp.calls_during('0b000000-0000-4000-8000-00000000000b');
BEGIN
  ASSERT n = 0, format('2c the stranger reached link_grants %s times', n);
END $$;

-- 2d. Called directly (it is an RPC for anon and authenticated): another organization's link, an unknown id, and anon
--     all answer false, with no error, so the function is not an existence probe; the manager of a tied link gets true.
CREATE FUNCTION pg_temp.wrap_as(p_uid text, p_link uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM public.t_claims(p_uid);
  IF p_uid = '' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
  BEGIN
    r := public.caller_manages_tied_org_link(p_link)::text;
  EXCEPTION WHEN OTHERS THEN
    r := 'error ' || SQLSTATE;
  END;
  RESET ROLE;
  PERFORM public.t_claims('none');
  RETURN r;
END $$;
DO $$ BEGIN
  ASSERT pg_temp.wrap_as('0c000000-0000-4000-8000-00000000000c', '02000000-0000-4000-8000-000000000002') = 'false',
    '2d 0c (manages only bb) on aa''s link';
  ASSERT pg_temp.wrap_as('0c000000-0000-4000-8000-00000000000c', gen_random_uuid()) = 'false', '2d 0c on an unknown id';
  ASSERT pg_temp.wrap_as('0a000000-0000-4000-8000-00000000000a', '0c000000-0000-4000-8000-0000000000c2') = 'false',
    '2d 0a (manages aa) on bb''s link';
  ASSERT pg_temp.wrap_as('0c000000-0000-4000-8000-00000000000c', '0c000000-0000-4000-8000-0000000000c2') = 'false',
    '2d 0c on its own untied link';
  ASSERT pg_temp.wrap_as('', '02000000-0000-4000-8000-000000000002') = 'false', '2d anon';
  ASSERT pg_temp.wrap_as('0a000000-0000-4000-8000-00000000000a', '02000000-0000-4000-8000-000000000002') = 'true',
    '2d 0a on aa''s tied link';
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
\ir ../migrations/20261126121500_sold_vehicle_proof_tied_org_link.sql
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
-- 4b. A changed organization-member image policy is refused before the wrapper is registered against it.
DELETE FROM public.private_row_policy_copies WHERE reader = 'caller_manages_tied_org_link(uuid)';
ALTER POLICY "Organization members can view org vehicle images" ON public.vehicle_images USING (false);
\set ON_ERROR_STOP off
\ir ../migrations/20261126121500_sold_vehicle_proof_tied_org_link.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.private_row_policy_copies WHERE reader = 'caller_manages_tied_org_link(uuid)'),
    '4b a changed policy is refused, nothing registered';
END $$;
ALTER POLICY "Organization members can view org vehicle images" ON public.vehicle_images
  USING (EXISTS ( SELECT 1
   FROM (organization_vehicles ov
     JOIN organization_contributors oc ON ((ov.organization_id = oc.organization_id)))
  WHERE ((ov.vehicle_id = vehicle_images.vehicle_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text) AND
        CASE
            WHEN (oc.status = 'active'::text) THEN organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id)
            ELSE false
        END)));
DO $$
DECLARE d text := (SELECT d FROM live_def2);
BEGIN
  -- the live read with one literal changed: neither the 20261126081500 view nor this migration's result
  ASSERT position('''manual_mark''::text' IN d) > 0, 'drift anchor';
  EXECUTE 'CREATE OR REPLACE VIEW public.sold_vehicle_proof WITH (security_barrier = false) AS '
          || replace(rtrim(d, ';'), '''manual_mark''::text', '''manual_mark_2''::text');
END $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261126121500_sold_vehicle_proof_tied_org_link.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  ASSERT position('caller_manages_tied_org_link(' IN pg_get_viewdef('public.sold_vehicle_proof'::regclass)) = 0,
    '4 drifted view refused, not edited';
END $$;
SELECT 'PASS: sold_vehicle_proof lists only readable cars to the public, managers of a tied link keep theirs' AS result;
