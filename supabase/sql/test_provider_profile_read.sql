-- Disposable PG17 only. Proves 20261019140000_provider_profile_read.sql: anon reads a public provider profile with
-- no personal information and no money; self-claims never appear under capabilities; private-vehicle work and photos
-- are hidden from strangers but counted for the subject and slot holders; private profiles stay private.
-- Fixture and prior state: the statement contract chain (job readers, bridge, open readers, statement).
\set ON_ERROR_STOP on
\ir test_work_order_statement_read.sql

-- Provider-side columns of the live tables, and user_org_relations reduced to its output shape.
ALTER TABLE public.actors ADD COLUMN specialties text[], ADD COLUMN certifications text[], ADD COLUMN licenses text[],
  ADD COLUMN training text[], ADD COLUMN specialty_makes text[], ADD COLUMN specialty_eras text[],
  ADD COLUMN years_experience integer, ADD COLUMN created_at timestamptz DEFAULT now();
CREATE TABLE public.actor_capabilities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid, capability_type text,
  complexity_tier text, evidence_count integer, first_demonstrated date, last_demonstrated date, notes text);
ALTER TABLE public.vehicle_images ADD COLUMN user_id uuid, ADD COLUMN vision_gate_status text;
ALTER TABLE public.user_tools ADD COLUMN category text, ADD COLUMN total_quantity integer, ADD COLUMN total_spent numeric;
ALTER TABLE public.tool_inventory ADD COLUMN category text, ADD COLUMN purchase_price numeric;
ALTER TABLE public.organizations ADD COLUMN business_type text, ADD COLUMN is_public boolean;
ALTER TABLE public.profiles ADD COLUMN created_at timestamptz DEFAULT '2026-01-01';
CREATE FUNCTION public.user_org_relations(p_user_id uuid, p_at timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('relations', COALESCE(jsonb_agg(jsonb_build_object('organization_id', oc.organization_id, 'name', NULL,
    'type', NULL, 'role', oc.role, 'membership_status', oc.status,
    'relation', jsonb_build_object('weight', 0.5, 'state', 'live', 'last_contribution_at', '2026-01-04T12:00:00Z'))), '[]'::jsonb))
  FROM public.organization_contributors oc WHERE oc.user_id = p_user_id $$;

UPDATE public.profiles SET city='Boise', state='ID', role='mechanic', profession='technician', expertise_areas=ARRAY['welding'],
  full_name='Tech Legal Name', email='tech@example.com', phone='+15550166', address='12 Private Ln', member_since='2026-01-02'
  WHERE id='00000000-0000-0000-0000-000000000006';
INSERT INTO public.profiles(id,is_public,city) VALUES ('00000000-0000-0000-0000-000000000004',true,'Nampa');
UPDATE public.organizations SET business_type='shop', is_public=true WHERE id='0a000000-0000-0000-0000-000000000001';
UPDATE public.actors SET specialties=ARRAY['exhaust'], certifications=ARRAY['ASE A1'] WHERE id='a0000000-0000-0000-0000-0000000000f1';
INSERT INTO public.actor_capabilities(actor_id,capability_type,complexity_tier,evidence_count,first_demonstrated,last_demonstrated,notes) VALUES
 ('a0000000-0000-0000-0000-0000000000f1','fabrication','advanced',3,'2025-06-01','2026-01-03','hand entered');
INSERT INTO public.organization_contributors(organization_id,user_id,role,status) VALUES
 ('0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006','technician','active');
INSERT INTO public.user_tools(id,user_id,category,total_quantity,total_spent) VALUES
 ('70000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000006','wrenches',3,999.99),
 ('70000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000006','wrenches',1,111.11);
INSERT INTO public.vehicle_images(id,vehicle_id,taken_at,is_external,user_id,vision_gate_status) VALUES
 ('b0000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','2026-01-03 10:00',false,'00000000-0000-0000-0000-000000000006','approved'),
 ('b0000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','2026-01-03 11:00',false,'00000000-0000-0000-0000-000000000006','approved'),
 ('b0000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000005','2026-01-04 10:00',false,'00000000-0000-0000-0000-000000000006','approved'),
 ('b0000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000002','2026-01-05 10:00',false,'00000000-0000-0000-0000-000000000006','pending');
INSERT INTO public.vehicle_observations(id,vehicle_id,kind,source_id,observed_at,structured_data) VALUES
 ('e0000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','condition','90000000-0000-0000-0000-000000000001','2026-01-03',
  '{"analysis_kind":"image_deep_byok","image_id":"b0000000-0000-0000-0000-000000000001","workshop_signals":{"tools_visible":["torque wrench","floor jack"]}}'),
 ('e0000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','condition','90000000-0000-0000-0000-000000000001','2026-01-03',
  '{"analysis_kind":"image_deep_byok","image_id":"b0000000-0000-0000-0000-000000000002","workshop_signals":{"tools_visible":[{"label":"Torque Wrench"}]}}'),
 ('e0000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000005','condition','90000000-0000-0000-0000-000000000001','2026-01-04',
  '{"analysis_kind":"image_deep_byok","image_id":"b0000000-0000-0000-0000-000000000003","workshop_signals":{"tools_visible":["secret lift"]}}'),
 ('e0000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000002','condition','90000000-0000-0000-0000-000000000001','2026-01-05',
  '{"analysis_kind":"image_deep_byok","image_id":"b0000000-0000-0000-0000-000000000004","workshop_signals":{"tools_visible":["unapproved frame tool"]}}');
INSERT INTO public.work_sessions(id,user_id,vehicle_id,session_date,duration_minutes,image_count,owner_confirmed_at) VALUES
 ('60000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000006','40000000-0000-0000-0000-000000000002','2026-01-04',60,2,'2026-01-05'),
 ('60000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000006','40000000-0000-0000-0000-000000000005','2026-01-06',120,1,'2026-01-07');
INSERT INTO public.work_order_line_items(id,work_order_id,status,actor_id) VALUES
 ('50000000-0000-0000-0000-00000000000e','30000000-0000-0000-0000-00000000000e','pending','a0000000-0000-0000-0000-0000000000f1');

\ir ../migrations/20261019140000_provider_profile_read.sql

CREATE FUNCTION public.t_provider_pii(j jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT j::text ~ '(Tech Legal Name|tech@example|5550166|5550177|5550199|Private Ln|Private Painter|Fixture Performer|Fixture Customer|Other Customer|999\.99|111\.11|total_spent|purchase_price|"amount"|"email"|"phone"|"address"|full_name|secret lift|hand entered)' $$;
GRANT EXECUTE ON FUNCTION public.t_provider_pii(jsonb) TO anon, authenticated;

SELECT t_assert(has_function_privilege('anon','public.provider_profile_read(uuid,uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.provider_profile_read(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.provider_job_ids(uuid,uuid)','EXECUTE')
  AND (SELECT prosecdef AND 'search_path=pg_catalog, public' = ANY (proconfig) FROM pg_proc WHERE proname='provider_profile_read'),
  'provider_profile_read: definer, pinned search_path, anon and authenticated; job helper closed');

-- 1. A visitor reads a public provider.
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
CREATE TEMP TABLE pv AS SELECT provider_profile_read('00000000-0000-0000-0000-000000000006') j;
SELECT t_assert((SELECT j @> '{"viewer":{"context":"visitor","money_visible":false},
  "subject":{"kind":"user","profile_id":"00000000-0000-0000-0000-000000000006","handle":"fixture_tech","city":"Boise","state":"ID"},
  "claims":{"basis":"stated_by_account","account":{"role":"mechanic","expertise_areas":["welding"]},"actor_records":[{"specialties":["exhaust"],"certifications":["ASE A1"]}]},
  "capabilities":{"items":[{"capability_type":"fabrication","evidence_count":3,"first_demonstrated":"2025-06-01","last_demonstrated":"2026-01-03","basis_ids_recorded":0}]},
  "identity_bridge":{"state":"evidenced","rung":"work_evidence"},
  "contact":{"action":"contact_via_nuke","available":false},"money":"not_reported"}' FROM pv), 'visitor: subject by handle, claims apart from capabilities, bridge, contact placeholder');
SELECT t_assert((SELECT jsonb_array_length(j#>'{capabilities,items}') = 1 AND (j->'capabilities')::text !~ '(welding|exhaust|ASE|mechanic)' FROM pv),
  'self-claims never appear under capabilities');
SELECT t_assert((SELECT j#>'{tools,seen_in_frame}' @> '{"occurrences":3,"frames_analyzed":2,"frames_with_tools":2,"images_scanned":2,"images_eligible":2,"top_labels":[{"label":"torque wrench","occurrences":2}]}' FROM pv),
  'visitor: sightings from approved photos on public vehicles only, as occurrences');
SELECT t_assert((SELECT j#>'{tools,claimed_owned,user_tools}' = '[{"category":"wrenches","records":2,"units":4}]' AND j#>>'{tools,co_signed,supporting_attestations}' = '0' FROM pv),
  'visitor: claimed tools by category without values; co-signs counted');
SELECT t_assert((SELECT j->'facilities' @> '[{"relation_kind":"member","name":"Fixture Shop","role":"technician","city":"Boise","relation":{"weight":0.5,"state":"live"},"actor_profile":{"reader":"actor_profile_read","kind":"organization"}}]' FROM pv),
  'visitor: facilities with relation weight and organization pointer');
SELECT t_assert((SELECT j#>'{work_record,days}' @> '{"signed_work_days":1,"days_with_capture":2,"capture_span_hours":{"value":2.5,"label":"capture span from photo timestamps; not labor time"}}'
  AND j#>'{work_record,jobs}' @> '{"jobs":1,"by_role":{"performer":1},"completion":{"recorded":1}}' FROM pv), 'visitor: public work days and jobs only, capture span labelled');
SELECT t_assert((SELECT NOT t_provider_pii(j) FROM pv), 'visitor: no personal information, private-vehicle sightings or money');
CREATE TEMP TABLE pa AS SELECT provider_profile_read(NULL, 'a0000000-0000-0000-0000-0000000000f2') j;
SELECT t_assert((SELECT j @> '{"subject":{"kind":"actor","actor_type":"painter","display":{"kind":"actor","label":"unnamed party","role":"painter"},"city":null},
  "tools":{"seen_in_frame":{"state":"not_assessed"}},"identity_bridge":{"state":"none"},"work_record":{"jobs":{"jobs":0}}}' AND NOT t_provider_pii(j) FROM pa),
  'visitor: an unbridged actor is an unnamed party with a role');
SELECT t_assert((SELECT j @> '{"subject":{"display":{"kind":"user","handle":"fixture_tech"}},"capabilities":{"items":[{"capability_type":"fabrication"}]},"work_record":{"jobs":{"jobs":1}}}'
  FROM (SELECT provider_profile_read(NULL, 'a0000000-0000-0000-0000-0000000000f1') j) x), 'visitor: a bridged actor appears by the public handle');
SELECT t_assert((SELECT j @> '{"subject":{"handle":null,"label":"unnamed party","city":"Nampa"},"work_record":{"jobs":{"jobs":1,"by_role":{"shop_owner":1}}}}'
  FROM (SELECT provider_profile_read('00000000-0000-0000-0000-000000000004') j) x), 'visitor: a shop owner without a handle is unnamed; shop jobs counted');
SELECT t_assert(t_refused($q$SELECT provider_profile_read('00000000-0000-0000-0000-000000000002')$q$), 'visitor: private profile refused');
SELECT t_assert(t_refused($q$SELECT provider_profile_read('00000000-0000-0000-0000-000000000009')$q$), 'visitor: account without a profile refused');
SELECT t_assert(t_refused($q$SELECT provider_profile_read(NULL, 'a0000000-0000-0000-0000-0000000000ff')$q$), 'visitor: unknown actor refused');
SELECT t_assert(t_refused($q$SELECT provider_profile_read('00000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-0000000000f1')$q$)
  AND t_refused('SELECT provider_profile_read()'), 'exactly one subject');
RESET ROLE;

-- 2. The subject and a slot holder see private-vehicle work; the subject sees their private profile.
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000006');
CREATE TEMP TABLE ps AS SELECT provider_profile_read('00000000-0000-0000-0000-000000000006') j;
SELECT t_assert((SELECT j @> '{"viewer":{"context":"self"},"tools":{"seen_in_frame":{"occurrences":4,"images_eligible":3}},
  "work_record":{"days":{"signed_work_days":2,"capture_span_hours":{"value":4.5}},"jobs":{"jobs":2}}}' FROM ps), 'self: own private-vehicle photos, days and jobs counted');
SELECT t_assert((SELECT j::text !~ '(Tech Legal Name|tech@example|5550166|Private Ln|999\.99)' FROM ps), 'self: the public profile reader still carries no contact or money');
SELECT t_as('00000000-0000-0000-0000-000000000007');
SELECT t_assert((SELECT provider_profile_read('00000000-0000-0000-0000-000000000006') @> '{"viewer":{"context":"visitor"},"work_record":{"jobs":{"jobs":2}},"tools":{"seen_in_frame":{"occurrences":3}}}'),
  'slot holder on the private vehicle sees that job; photos stay public-only');
SELECT t_as('00000000-0000-0000-0000-000000000002');
SELECT t_assert((SELECT provider_profile_read('00000000-0000-0000-0000-000000000002') @> '{"viewer":{"context":"self"},"subject":{"handle":"second_customer"}}'),
  'self: a private profile is readable by its owner');
RESET ROLE;
