-- Disposable PG17 only. Proves 20261020040000_suggested_provider_links.sql: suggestions come only from the viewer's own
-- evidence joined to attributed work (parity with actor_link_claim_evidence_read; a name-identical actor with no work gives
-- nothing; another person's overlapping session is their suggestion, not this viewer's); organizations only from the
-- viewer's own photos near a public location, excluding ones they belong to or own; legacy records only when they name the
-- viewer, confirmed by a hash-pinned Sign that never becomes skill evidence. Nothing is claimed, joined or approved.
-- Fixture and prior state: the actor-link evidence chain (user 01 approved at work_evidence on actor f3; user 03 has a
-- same-day session on the actor's vehicle; actor f4 shares user 01's name and has no work).
\set ON_ERROR_STOP on
\ir test_actor_link_claim_evidence.sql

ALTER TABLE public.vehicle_images ADD COLUMN IF NOT EXISTS latitude numeric, ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS is_superseded boolean;
CREATE TABLE public.organization_locations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, latitude numeric, longitude numeric);
CREATE TABLE public.contractor_work_contributions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contractor_user_id uuid, organization_id uuid,
  work_description text, work_category text, work_date date, labor_hours numeric, hourly_rate numeric, vehicle_id uuid, verified_by_shop boolean);
DO $$ BEGIN
  IF to_regclass('public.technicians') IS NULL THEN CREATE TABLE public.technicians(id uuid PRIMARY KEY DEFAULT gen_random_uuid()); END IF;
END $$;
ALTER TABLE public.technicians ADD COLUMN IF NOT EXISTS user_id uuid, ADD COLUMN IF NOT EXISTS name text, ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS certification_level text, ADD COLUMN IF NOT EXISTS specializations text[], ADD COLUMN IF NOT EXISTS shop_id uuid,
  ADD COLUMN IF NOT EXISTS experience_years integer, ADD COLUMN IF NOT EXISTS hourly_rate_cents integer, ADD COLUMN IF NOT EXISTS contact_info jsonb,
  ADD COLUMN IF NOT EXISTS source text;
INSERT INTO public.organizations(id, name, is_public, business_type) VALUES ('0a000000-0000-0000-0000-0000000000b2', 'Site Shop', true, 'garage'),
  ('0a000000-0000-0000-0000-0000000000b3', 'Private Yard', false, 'garage'), ('0a000000-0000-0000-0000-0000000000b4', 'Far Shop', true, 'garage'),
  ('0a000000-0000-0000-0000-0000000000b5', 'Seaside Hotel', true, 'hotel');
UPDATE public.organizations SET business_type = 'restoration_shop' WHERE id = '0a000000-0000-0000-0000-000000000001';
INSERT INTO public.organization_locations(organization_id, latitude, longitude) VALUES
  ('0a000000-0000-0000-0000-0000000000b2', 43.61000, -116.20000), ('0a000000-0000-0000-0000-0000000000b3', 43.61010, -116.20010),
  ('0a000000-0000-0000-0000-000000000001', 43.61005, -116.20005), ('0a000000-0000-0000-0000-0000000000b4', 43.70000, -116.30000),
  ('0a000000-0000-0000-0000-0000000000b5', 43.61003, -116.20002);
INSERT INTO public.vehicle_images(id, vehicle_id, taken_at, is_external, user_id, vision_gate_status, latitude, longitude) VALUES
  ('b1000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-000000000003', '2026-03-01 09:00', false, '00000000-0000-0000-0000-000000000001', 'approved', 43.61002, -116.20003),
  ('b1000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-000000000003', '2026-03-01 11:00', false, '00000000-0000-0000-0000-000000000001', 'approved', 43.60998, -116.19998),
  ('b1000000-0000-0000-0000-0000000000a3', '40000000-0000-0000-0000-000000000003', '2026-03-02 10:00', false, '00000000-0000-0000-0000-000000000001', 'approved', 43.61001, -116.20001),
  ('b1000000-0000-0000-0000-0000000000a4', '40000000-0000-0000-0000-000000000003', '2026-03-03 10:00', false, '00000000-0000-0000-0000-000000000003', 'approved', 43.61001, -116.20001);
INSERT INTO public.contractor_work_contributions(id, contractor_user_id, organization_id, work_description, work_category, work_date, labor_hours, hourly_rate) VALUES
  ('c3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '0a000000-0000-0000-0000-000000000001', 'Rebuilt front brakes', 'mechanical', '2025-06-01', 6, 45),
  ('c3000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', '0a000000-0000-0000-0000-000000000001', 'Seat covers', 'upholstery', '2025-07-01', 3, 40);
INSERT INTO public.technicians(id, user_id, name, display_name, certification_level, specializations, shop_id, experience_years, contact_info, source) VALUES
  ('c4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Fixture Legal Name', 'fixture_tech', 'ase', ARRAY['brakes'],
   '0a000000-0000-0000-0000-000000000001', 8, '{"phone":"+15550111"}', 'platform_user_self'),
  ('c4000000-0000-0000-0000-000000000002', NULL, 'Unlinked Person', 'unlinked', NULL, NULL, NULL, NULL, NULL, NULL);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;

\ir ../migrations/20261020040000_suggested_provider_links.sql

SELECT t_assert(NOT has_function_privilege('anon', 'public.my_suggested_provider_links()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.my_suggested_provider_links()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.confirm_provider_record(text,uuid,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.confirm_provider_record(text,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.actor_link_evidence_items(uuid,uuid)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.provider_record_confirmations', 'SELECT'), 'grants: reader and Sign signed-in only; internals and table private');
SELECT t_assert((SELECT bool_and(prosrc !~* '(full_name|\.phone|\.email|\.name\s*=|=\s*[a-z_]+\.name\M|\.username|contact_info|license_number)') FROM pg_proc
  WHERE proname IN ('actor_link_evidence_items', 'my_suggested_provider_links', 'provider_record_snapshot')), 'no name, phone, e-mail or contact comparisons or reads');
SELECT t_assert((SELECT count(*) FROM pg_proc WHERE prosrc ~ 'provider_record_confirmations' AND proname NOT IN
  ('confirm_provider_record', 'provider_record_confirmation_state', 'provider_record_confirmations_immutable')) = 0, 'no other function (no capability fold) reads confirmations');

-- 1. Parity with the claim evidence finder.
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT t_assert(actor_link_evidence_items('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f3')
  = actor_link_claim_evidence_read('c1000000-0000-0000-0000-0000000000f3')->'items', 'items equal the claim finder''s for the same account and actor');
RESET ROLE;

-- 2. The viewer's suggestions.
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000001');
CREATE TEMP TABLE s1 AS SELECT my_suggested_provider_links() j;
SELECT t_assert((SELECT jsonb_array_length(j->'actor_links') = 2 AND j->'actor_links'->0 @> '{"actor":{"actor_id":"a0000000-0000-0000-0000-0000000000f3"},
  "strength":"direct","your_claim":{"status":"approved","rung":"work_evidence"},"actions":[]}' FROM s1), 'viewer: the actor their evidence supports directly comes first, already claimed, no new action');
SELECT t_assert((SELECT j->'actor_links'->1 @> '{"actor":{"actor_id":"a0000000-0000-0000-0000-0000000000f1"},"strength":"corroborating",
  "evidence":{"direct":0,"by_kind":{"org_membership":1},"approvable_for":[]},"linked_to_another_account":true,"actions":[{"action":"claim"}]}' FROM s1),
  'verified-org co-membership alone is a corroborating suggestion, approvable for nothing');
SELECT t_assert((SELECT (j#>>'{actor_links,0,evidence,direct}')::int >= 2 AND (j#>>'{actor_links,0,evidence,total}')::int
  = (j#>>'{actor_links,0,evidence,direct}')::int + (j#>>'{actor_links,0,evidence,corroborating}')::int FROM s1), 'evidence counts by strength');
SELECT t_assert((SELECT NOT (j::text ~ 'a0000000-0000-0000-0000-0000000000f4') FROM s1), 'the name-identical actor with no attributed work is never suggested');
SELECT t_assert((SELECT jsonb_array_length(j->'organizations') = 1 AND j->'organizations'->0 @> '{"organization":{"organization_id":"0a000000-0000-0000-0000-0000000000b2"},
  "strength":"corroborating","evidence":{"photos_at_site":3,"days":2},"actions":[{"action":"ask_to_join","row":{"role":"contributor","status":"pending","verification_method":"self_claimed"}}]}'
  FROM s1), 'organizations: the public work facility holding their photos, as ask to join; not the private one, the one they belong to, the far one or a hotel');
SELECT t_assert((SELECT jsonb_array_length(j#>'{recorded_contributions,contractor_work}') = 1
  AND j#>'{recorded_contributions,contractor_work,0}' @> '{"source_id":"c3000000-0000-0000-0000-000000000001","work_category":"mechanical","confirmation":{"state":"unconfirmed"}}'
  AND jsonb_array_length(j#>'{recorded_contributions,technician_records}') = 1
  AND j#>'{recorded_contributions,technician_records,0}' @> '{"source_id":"c4000000-0000-0000-0000-000000000001","display_name":"fixture_tech"}' FROM s1),
  'recorded contributions: only records that name the viewer');
SELECT t_assert((SELECT j::text !~ '(Fixture Legal Name|5550111|"phone"|Seat covers)' FROM s1), 'no legal name, contact field or another person''s record');

-- 3. Another account's same-day session is their own suggestion, with a claim action.
SELECT t_as('00000000-0000-0000-0000-000000000003');
CREATE TEMP TABLE s3 AS SELECT my_suggested_provider_links() j;
SELECT t_assert((SELECT j->'actor_links'->0 @> '{"actor":{"actor_id":"a0000000-0000-0000-0000-0000000000f3"},"strength":"direct","linked_to_another_account":true,
  "actions":[{"action":"claim","row":{"platform":"nuke_actor","verification_method":"self_claim","actor_id":"a0000000-0000-0000-0000-0000000000f3"}}]}'
  AND j->'actor_links'->0->'your_claim' = 'null'::jsonb FROM s3), 'other viewer: suggestion with a self_claim action; nothing filed');
SELECT t_assert((SELECT count(*) FROM account_link_claims WHERE user_id = '00000000-0000-0000-0000-000000000003') = 0, 'reading files no claim');
SELECT t_assert((SELECT jsonb_array_length(j->'organizations') = 2 AND j->'organizations' @> '[{"organization":{"organization_id":"0a000000-0000-0000-0000-0000000000b2"}},
  {"organization":{"organization_id":"0a000000-0000-0000-0000-000000000001"}}]' AND j::text !~ '0000000000b3' AND j::text !~ '0000000000b5' FROM s3),
  'their photo at the site suggests both public organizations there (they belong to neither); never the private one');
SELECT t_as('00000000-0000-0000-0000-000000000009');
SELECT t_assert((SELECT j->'counts' = '{"actor_links":0,"actor_links_direct":0,"organizations":0,"contractor_work":0,"technician_records":0}'
  FROM (SELECT my_suggested_provider_links() j) x), 'a viewer with no evidence gets nothing');
RESET ROLE;

-- 4. Confirming a recorded contribution (hash-pinned, own records only, never skill).
SELECT provider_record_snapshot_hash(provider_record_snapshot('contractor_work_contribution', 'c3000000-0000-0000-0000-000000000002')) AS other_hash \gset
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000001');
SELECT t_assert(t_refused($q$SELECT confirm_provider_record('contractor_work_contribution', 'c3000000-0000-0000-0000-000000000001', repeat('0', 64))$q$),
  'a stale or invented hash is refused');
SELECT t_assert(t_refused(format('SELECT confirm_provider_record(%L, %L, %L)', 'contractor_work_contribution', 'c3000000-0000-0000-0000-000000000002', :'other_hash')),
  'another account''s record cannot be confirmed');
SELECT t_assert(t_refused($q$SELECT confirm_provider_record('technician', 'c4000000-0000-0000-0000-000000000002', repeat('0', 64))$q$),
  'an unlinked technician record cannot be confirmed');
CREATE TEMP TABLE cf AS SELECT confirm_provider_record('contractor_work_contribution', 'c3000000-0000-0000-0000-000000000001',
  (SELECT j#>>'{recorded_contributions,contractor_work,0,snapshot_hash}' FROM s1)) r;
SELECT t_assert((SELECT r @> '{"rung":"self_confirmed","duplicate":false,"counted_as_skill_evidence":false}' FROM cf), 'confirmed as shown, self_confirmed, not skill evidence');
SELECT t_assert((SELECT confirm_provider_record('contractor_work_contribution', 'c3000000-0000-0000-0000-000000000001',
  (SELECT j#>>'{recorded_contributions,contractor_work,0,snapshot_hash}' FROM s1)) @> '{"duplicate":true}'), 'a repeat is a duplicate');
SELECT t_assert((SELECT confirm_provider_record('technician', 'c4000000-0000-0000-0000-000000000001',
  (SELECT j#>>'{recorded_contributions,technician_records,0,snapshot_hash}' FROM s1)) @> '{"rung":"self_confirmed","duplicate":false}'), 'own technician record confirmed');
SELECT t_assert((SELECT my_suggested_provider_links()#>>'{recorded_contributions,contractor_work,0,confirmation,state}') = 'confirmed', 'reader shows confirmed');
RESET ROLE;
UPDATE contractor_work_contributions SET labor_hours = 7 WHERE id = 'c3000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT t_assert((SELECT my_suggested_provider_links()#>>'{recorded_contributions,contractor_work,0,confirmation,state}') = 'changed_since_confirmed',
  'a changed source reads as changed since confirmed');
RESET ROLE;
SELECT t_assert(t_refused($q$UPDATE provider_record_confirmations SET rung = 'self_confirmed'$q$) AND t_refused($q$DELETE FROM provider_record_confirmations$q$),
  'confirmations are immutable');
SELECT t_assert((SELECT count(*) FROM provider_record_confirmations) = 2, 'two confirmations recorded');
