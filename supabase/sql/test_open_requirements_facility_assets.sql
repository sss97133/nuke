-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- open_requirements_read facility input from declared assets: pass with a free matching asset at a reachable facility in
-- the window, otherwise plan_b_supplier_needed. Chained on the open-requirements contract (job ..0d: "Two-post lift bay",
-- shop 0a..01 owned by ..04, ..06 a member, ..03 a newcomer).
\ir test_open_requirements_read.sql
\ir helpers/facility_tables_live_20261019.sql
INSERT INTO observation_sources VALUES ('90000000-0000-0000-0000-000000000002','owner-input','owner',ARRAY['work_record','specification']::public.observation_kind[],now())
  ON CONFLICT (slug) DO NOTHING;
\ir ../migrations/20261019224000_facility_assets.sql
\ir ../migrations/20261019225000_facility_reservations.sql
\ir ../migrations/20261019227000_open_requirements_facility_assets.sql

CREATE FUNCTION public.fac_input(p_viewer uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j jsonb; BEGIN
  PERFORM t_as(p_viewer);
  SELECT open_requirements_read() INTO j;
  RETURN (SELECT m FROM jsonb_array_elements(j->'rows') r, jsonb_array_elements(r->'match') m
    WHERE r->>'requirement_id'='81000000-0000-0000-0000-000000000003' AND m->>'input'='facility');
END $$;
GRANT EXECUTE ON FUNCTION public.fac_input(uuid) TO authenticated;

SET ROLE authenticated;
SELECT t_assert(fac_input('00000000-0000-0000-0000-000000000006') @> '{"result":"unknown","next":"plan_b_supplier_needed","kinds":["lift","bay"]}'
 AND fac_input('00000000-0000-0000-0000-000000000003') @> '{"result":"unknown","next":"plan_b_supplier_needed"}',
 'no declared assets: membership alone no longer passes; plan B for everyone');
SELECT t_as('00000000-0000-0000-0000-000000000004');
SELECT declare_facility_asset('0a000000-0000-0000-0000-000000000001','lift','Two-post lift',1)->>'asset_id' AS lift \gset
SELECT t_assert(fac_input('00000000-0000-0000-0000-000000000003') @> '{"result":"pass","assets":[{"kind":"lift","label":"Two-post lift","capacity":1,"free_in_window":null}]}'
 AND fac_input('00000000-0000-0000-0000-000000000003')->>'reason' ~ 'availability not assessed','declared lift at the job''s shop: pass, availability not assessed without a window');
RESET ROLE;
UPDATE work_orders SET scheduled_start=date_trunc('day', now()) + interval '3 days 8 hours', scheduled_end=date_trunc('day', now()) + interval '3 days 17 hours',
  customer_id='00000000-0000-0000-0000-000000000002' WHERE id='30000000-0000-0000-0000-00000000000d';
SET ROLE authenticated;
SELECT t_assert(fac_input('00000000-0000-0000-0000-000000000003') @> '{"result":"pass","window":{"basis":"job schedule"},"assets":[{"label":"Two-post lift","free_in_window":true}]}',
 'job window known: the lift has a free slot');
SELECT t_as('00000000-0000-0000-0000-000000000002');
SELECT reserve_facility('30000000-0000-0000-0000-00000000000d',:'lift',date_trunc('day', now()) + interval '3 days 9 hours',date_trunc('day', now()) + interval '3 days 12 hours') AS r1 \gset
SELECT t_as('00000000-0000-0000-0000-000000000004');
SELECT confirm_facility_reservation(((:'r1'::jsonb)->>'reservation_id')::uuid,(:'r1'::jsonb)->>'reservation_hash') AS c1 \gset
SELECT t_assert(fac_input('00000000-0000-0000-0000-000000000003') @> '{"result":"fail","next":"plan_b_supplier_needed","window":{"basis":"job schedule"}}'
 AND NOT fac_input('00000000-0000-0000-0000-000000000003')::text ~ ((:'r1'::jsonb)->>'reservation_id'),'the only lift is booked in the window: plan B, no reservation details');
RESET ROLE;
SELECT t_assert((:'c1'::jsonb) @> '{"state":"confirmed","slot":1}','fixture: the lift is confirmed for part of the job window');
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000004');
SELECT declare_facility_asset('0a000000-0000-0000-0000-000000000001','bay','Bay 2',1);
SELECT t_assert(fac_input('00000000-0000-0000-0000-000000000006') @> '{"result":"pass","assets":[{"kind":"bay","label":"Bay 2","free_in_window":true}]}',
 'a free matching bay passes even when the lift is booked');
RESET ROLE;
SELECT t_assert(open_requirement_facility_input('{}','{"requirement_kind":"equipment","description":"TIG welder"}',NULL,NULL,NULL)
   @> '{"result":"unknown","next":"plan_b_supplier_needed"}'
 AND open_requirement_facility_input('{}','{"requirement_kind":"skill","description":"welding"}',NULL,NULL,NULL) @> '{"result":"pass"}',
 'equipment that is not a facility asset kind is plan B; non-facility requirements pass the facility input');
SELECT t_assert(NOT has_function_privilege('authenticated','open_requirement_facility_input(uuid[],jsonb,uuid,jsonb,uuid)','EXECUTE')
 AND (SELECT count(*) FROM regexp_matches(pg_get_functiondef('open_requirements_read(uuid,integer,text)'::regprocedure),'open_requirement_facility_input','g'))=1
 AND position('no organization membership or ownership' IN pg_get_functiondef('open_requirements_read(uuid,integer,text)'::regprocedure))=0,
 'helper internal; the reader carries one call in place of the membership expression');
