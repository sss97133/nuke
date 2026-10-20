-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- work_order_provider_place_read: the shop card (rating, hours, public business place), accepted providers and recorded
-- assignment people with city-level bands, the work site, and the progress tracker over the job path.
\ir test_job_loop_replay.sql

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid) TO anon, authenticated, service_role;
-- Live columns the reader reads that the replay fixture omits.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_public boolean, ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS entity_type text, ADD COLUMN IF NOT EXISTS business_type text, ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS average_project_rating numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS total_reviews integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hours_of_operation jsonb DEFAULT '{}'::jsonb, ADD COLUMN IF NOT EXISTS address text, ADD COLUMN IF NOT EXISTS zip_code text,
  ADD COLUMN IF NOT EXISTS phone text, ADD COLUMN IF NOT EXISTS latitude numeric, ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;
UPDATE organizations SET business_name = 'Fixture Garage', is_public = true, entity_type = 'garage', business_type = 'garage',
  logo_url = 'https://example.invalid/logo.png', average_project_rating = 0, total_reviews = 0, hours_of_operation = '{"mon-fri":"8am-5pm","sun":"closed"}',
  address = '1 Fixture Way', zip_code = '89501', phone = '+15550199', latitude = 39.52, longitude = -119.81, city = 'Reno', state = 'NV',
  updated_at = '2026-05-23T20:05:23Z'
WHERE id = '20000000-0000-0000-0000-000000000001';
UPDATE vehicles SET is_public = true, city = 'Reno', state = 'NV' WHERE id = '40000000-0000-0000-0000-000000000001';
INSERT INTO city_geocode_lookup(city,state,latitude,longitude,sample_size) VALUES ('Sparks','NV',39.5349,-119.7527,90);
-- Recorded assignments: the replay's helper row names a technician with no record; add a lead whose record names a public account.
INSERT INTO technicians(id,user_id) VALUES ('70000000-0000-0000-0000-0000000000ab','10000000-0000-0000-0000-00000000000b');
INSERT INTO work_order_assignments(work_order_id,technician_id,role,status,payout_type) VALUES
 ('30000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-0000000000ab','lead','pending','flat');
INSERT INTO profiles(id,username,is_public,full_name) VALUES ('10000000-0000-0000-0000-00000000000b','fixture_lead',true,'Fixture Lead Person')
 ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, is_public = true, full_name = EXCLUDED.full_name;
INSERT INTO profiles(id,username,is_public) VALUES ('10000000-0000-0000-0000-00000000000f','fixture_tech',true)
 ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, is_public = true;
-- An accepted provider: technician 0f offers on the skill requirement and the customer 0c accepts.
ALTER TABLE work_order_line_items DROP CONSTRAINT work_order_line_items_task_type_check;
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,status) VALUES
 ('51000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'fabricate','Headers','pending');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data) VALUES
 ('55000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-02','requirement_interpretation_v1',
  jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','requirement','work_order_id','30000000-0000-0000-0000-000000000001',
   'line_item_id','51000000-0000-0000-0000-000000000001','requirement_kind','skill','description','TIG welding','quantity',NULL,'unit',NULL)));
SET ROLE service_role;
SELECT project_work_order_resource_observation('55000000-0000-0000-0000-000000000001');
RESET ROLE;
INSERT INTO account_link_claims(user_id,platform,handle,actor_id,status,verification_method) VALUES
 ('10000000-0000-0000-0000-00000000000f','nuke_actor','60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','pending','self_claim');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT offer_on_requirement('55000000-0000-0000-0000-000000000001',NULL,NULL,NULL,NULL) AS o1 \gset
SELECT set_provider_service_area('Sparks','NV',25,true);
SELECT set_provider_availability('{"timezone":"America/Los_Angeles","weekly":[{"dow":1,"start":"08:00","end":"17:00"}]}');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_offer(((:'o1'::jsonb)->>'offer_id')::uuid,(:'o1'::jsonb)->>'offer_hash');
RESET ROLE;
CREATE FUNCTION public.ppr(p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_provider_place_read(p_wo) $$;
GRANT EXECUTE ON FUNCTION public.ppr(uuid) TO anon, authenticated;

-- 1. Anonymous visitor on a public vehicle's job, storefront shop.
SET ROLE anon;
SELECT as_user(NULL);
SELECT ppr() AS a1 \gset
SELECT t_assert(t_refused_with($q$SELECT ppr('30000000-0000-0000-0000-0000000000ff')$q$,'Work order unavailable'),'unknown job: unavailable');
SELECT t_assert(t_refused($q$SELECT organization_public_place('20000000-0000-0000-0000-000000000001')$q$)
 AND t_refused($q$SELECT work_order_progress_tracker('{}'::jsonb)$q$),'helpers are internal');
RESET ROLE;
SELECT t_assert((:'a1'::jsonb)->'shop' @> '{"state":"public","name":"Fixture Garage","logo_url":"https://example.invalid/logo.png","entity_type":"garage",
   "rating":{"state":"not_rated"},"hours":{"state":"recorded","as_recorded":{"mon-fri":"8am-5pm","sun":"closed"}},"role_on_job":"work order organization",
   "place":{"precision":"coordinates","storefront":true,"directions":true,"street_address":"1 Fixture Way","zip_code":"89501","city":"Reno","state":"NV",
     "phone":"+15550199","coordinates":{"latitude":39.52,"longitude":-119.81},"record_updated_at":"2026-05-23T20:05:23+00:00"}}'
 AND (:'a1'::jsonb)#>>'{shop,organization_id}' = '20000000-0000-0000-0000-000000000001',
 'storefront shop: name, logo, not rated (zero reviews, default average), hours as recorded, street, pin, phone, record clock');
SELECT t_assert((:'a1'::jsonb)#>'{people,accepted_providers}' @> '[{"person":{"handle":"fixture_tech"},"roles":["technician"],"accepted_offers":1,
   "service_area":{"state":"declared","city":"Sparks","state_code":"NV","radius_miles":25,"mobile":true},
   "availability":{"state":"declared","timezone":"America/Los_Angeles"}}]'
 AND jsonb_array_length((:'a1'::jsonb)#>'{people,accepted_providers}') = 1
 AND NOT ((:'a1'::jsonb)->'people')::text ~* '(latitude|longitude|(^|[^:0-9.])(39\.53|119\.75))',
 'accepted provider by handle with role, self-claimed band and availability; no coordinates for a person');
SELECT t_assert(jsonb_array_length((:'a1'::jsonb)#>'{people,recorded_assignments}') = 2
 AND (:'a1'::jsonb)#>'{people,recorded_assignments}' @> '[{"person":{"label":"unnamed party"},"roles":["helper"],"statuses":{"accepted":1},
     "service_area":{"state":"not_assessed","basis":"the technician record names no account"}},
   {"person":{"handle":"fixture_lead"},"roles":["lead"],"statuses":{"pending":1},"service_area":{"state":"not_declared"}}]'
 AND NOT (:'a1'::jsonb)::text ~ 'Fixture Lead Person',
 'recorded assignment people apart from Signs: account handle or unnamed party, never the technician''s name');
SELECT t_assert((:'a1'::jsonb)->'work_site' @> '{"state":"not_recorded","mobile_service":{"state":"not_established","accepted_providers_declaring_mobile":1}}'
 AND (:'a1'::jsonb)->'vehicle_place' @> '{"city":"Reno","state":"NV","precision":"city"}',
 'work site not recorded (no column, no confirmed reservation); vehicle place at city level');
SELECT t_assert((SELECT jsonb_agg(s->>'key') FROM jsonb_array_elements((:'a1'::jsonb)#>'{tracker,steps}') s)
   = '["requested","quoted","accepted","in_progress","done","paid"]'
 AND (:'a1'::jsonb)#>'{tracker,steps}' @> '[{"key":"requested","state":"reached","evidence":"record","job_path_stage":"intake"},
   {"key":"quoted","state":"not_yet"},{"key":"accepted","state":"reached","evidence":"sign","clock_basis":"offer acceptance"},
   {"key":"in_progress","state":"not_yet"},{"key":"done","state":"not_yet"},{"key":"paid","state":"withheld","reports":null}]'
 AND (:'a1'::jsonb)#>>'{tracker,current_step}' = 'accepted'
 AND (:'a1'::jsonb)#>>'{tracker,steps,2,clock}' IS NOT NULL,
 'tracker from the job path: requested by record, accepted by Sign with its clock, paid withheld from a visitor');
SELECT t_assert((:'a1'::jsonb)->'viewer' @> '{"context":"visitor","money_visible":false,"contact_visible":false}'
 AND (:'a1'::jsonb)->'coverage' @> '{"shop":"public","shop_place_precision":"coordinates","accepted_providers":1,"recorded_assignment_people":2,
   "providers_with_service_area":1,"work_site":"not_recorded","tracker_steps":6,"customer_contact":"never_returned"}'
 AND (:'a1'::jsonb)->>'display_title' = 'Exhaust'
 AND NOT (:'a1'::jsonb)::text ~ '(Fixture Customer|15550100|fixture@example)',
 'viewer and coverage stated; no customer name or contact');

-- 2. The same organization typed as a personal collection: city and state only.
UPDATE organizations SET entity_type = 'collection' WHERE id = '20000000-0000-0000-0000-000000000001';
SET ROLE anon;
SELECT as_user(NULL);
SELECT ppr() AS a2 \gset
RESET ROLE;
SELECT t_assert((:'a2'::jsonb)#>'{shop,place}' @> '{"precision":"city","storefront":false,"directions":false,"city":"Reno","state":"NV"}'
 AND (:'a2'::jsonb)#>'{shop,place,street_address}' = 'null' AND (:'a2'::jsonb)#>'{shop,place,coordinates}' = 'null'
 AND (:'a2'::jsonb)#>'{shop,place,phone}' = 'null' AND (:'a2'::jsonb)#>'{shop,place,zip_code}' = 'null'
 AND NOT (:'a2'::jsonb)::text ~ '(1 Fixture Way|(^|[^:0-9.])(39\.52|119\.81)|15550199|(^|[^0-9a-f-])89501([^0-9a-f-]|$))',
 'non-storefront organization: no street address, pin, zip or phone anywhere');

-- 3. A private provider profile: unnamed, band withheld.
UPDATE profiles SET is_public = false WHERE id = '10000000-0000-0000-0000-00000000000f';
SET ROLE anon;
SELECT as_user(NULL);
SELECT ppr() AS a3 \gset
RESET ROLE;
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT ppr() AS f3 \gset
RESET ROLE;
SELECT t_assert((:'a3'::jsonb)#>'{people,accepted_providers,0}' @> '{"person":{"label":"unnamed party"},"service_area":{"state":"withheld"},"availability":{"state":"withheld"}}'
 AND NOT (:'a3'::jsonb)::text ~ '(fixture_tech|Sparks)'
 AND (:'f3'::jsonb)#>'{people,accepted_providers,0}' @> '{"service_area":{"state":"declared","city":"Sparks"}}',
 'private provider profile: unnamed and band withheld from others; the provider sees their own band');

-- 4. Private vehicle and private organization.
UPDATE vehicles SET is_public = false WHERE id = '40000000-0000-0000-0000-000000000001';
SET ROLE anon;
SELECT as_user(NULL);
SELECT t_assert(t_refused_with('SELECT ppr()','Work order unavailable'),'anon: private vehicle job unavailable');
RESET ROLE;
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT ppr() AS f4 \gset
SELECT as_user('10000000-0000-0000-0000-000000000009');
SELECT t_assert(t_refused_with('SELECT ppr()','Work order unavailable'),'signed-in stranger: private vehicle job unavailable');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT ppr() AS c4 \gset
RESET ROLE;
SELECT t_assert((:'c4'::jsonb)->'viewer' @> '{"money_visible":true}'
 AND (:'c4'::jsonb)#>'{tracker,steps,5}' @> '{"key":"paid","state":"not_yet","basis":"no invoice or payment recorded"}'
 AND (:'c4'::jsonb)->'vehicle_place' @> '{"city":"Reno","precision":"city"}',
 'customer: paid step reads the parties'' accounting stage; vehicle place shown to a party');
SELECT t_assert((:'f4'::jsonb)->'viewer' @> '{"context":"provider","slots":["accepted_provider"],"party":true,"money_visible":false}'
 AND (:'f4'::jsonb)#>'{tracker,steps,5}' @> '{"key":"paid","state":"withheld"}' AND (:'f4'::jsonb)->'vehicle_place' @> '{"city":"Reno"}',
 'accepted provider on a private vehicle''s job: admitted as a party for place and people; payments stay withheld');
UPDATE vehicles SET is_public = true WHERE id = '40000000-0000-0000-0000-000000000001';
UPDATE organizations SET is_public = false, entity_type = 'garage' WHERE id = '20000000-0000-0000-0000-000000000001';
SET ROLE anon;
SELECT as_user(NULL);
SELECT ppr() AS a4 \gset
RESET ROLE;
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT ppr() AS c5 \gset
RESET ROLE;
SELECT t_assert((:'a4'::jsonb)->'shop' @> '{"state":"not_public"}' AND NOT (:'a4'::jsonb)::text ~ 'Fixture Garage'
 AND (:'c5'::jsonb)->'shop' @> '{"state":"private","name":"Fixture Garage","place":{"precision":"none"}}'
 AND NOT (:'c5'::jsonb)::text ~ '(1 Fixture Way|(^|[^:0-9.])39\.52|15550199)',
 'private organization: nothing to visitors, its name only to parties, no place');
UPDATE organizations SET is_public = true WHERE id = '20000000-0000-0000-0000-000000000001';

-- 5. A confirmed facility reservation states the work site.
INSERT INTO equipment(id,name,shop_id) VALUES ('a1000000-0000-0000-0000-000000000001','Fixture lift','20000000-0000-0000-0000-000000000001');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data) VALUES
 ('a2000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000002',now(),'fixture','{}'),
 ('a2000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000002',now(),'fixture','{}');
INSERT INTO facility_reservations(id,work_order_id,asset_id,organization_id,requested_by_user_id,requester_role,window_from,window_until,reservation_hash,requested_at)
VALUES ('a2000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','customer',now() + interval '1 day',now() + interval '2 days',repeat('a',64),now());
INSERT INTO facility_reservation_confirmations(id,reservation_id,reservation_hash,signer_user_id,signer_role,confirmed_at)
VALUES ('a2000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000001',repeat('a',64),'10000000-0000-0000-0000-00000000000e','organization_owner',now());
SET ROLE anon;
SELECT as_user(NULL);
SELECT ppr() AS a5 \gset
RESET ROLE;
SELECT t_assert((:'a5'::jsonb)->'work_site' @> '{"state":"facility_reserved","organization":"Fixture Garage","place":{"precision":"coordinates"},
   "mobile_service":{"state":"not_established"}}' AND (:'a5'::jsonb)#>>'{work_site,window,from}' IS NOT NULL,
 'confirmed facility reservation: the work site is that facility, at its public place');

-- 6. Tracker cases from synthetic job path stages (the pure helper).
SELECT t_assert(work_order_progress_tracker('{
   "intake":{"state":"recorded","created_at":"2026-02-01T00:00:00Z","inconsistencies":[]},
   "terms":{"state":"partial","current_quote":null,"quote_clock":null,"estimate_recorded":true,"customer_acceptance":"not_established",
     "accepted_providers":0,"assignments_with_accept_clock":0,"inconsistencies":["assignment_accepted_status_without_clock"],
     "retained_testimony":{"claims":3,"by_side":{"client":3},"latest_message_at":"2026-02-24T00:21:07Z","basis":"x"}},
   "execution":{"state":"recorded","start_clock":"2026-02-27T00:00:00Z","start_sign":null,"state_basis":"legacy_start_clock_or_component_events","inconsistencies":[]},
   "completion":{"state":"absent","provider_attestation":null,"state_basis":"no_completion_sign","inconsistencies":["assignment_completed_status_without_clock"],
     "retained_testimony":{"claims":3,"by_side":{"provider":3}}},
   "accounting":{"state":"withheld","basis":"payments and balances between specific parties are shown only to those parties","inconsistencies":[]}}')
 @> '{"current_step":"in_progress","steps":[{"key":"quoted","state":"partial","evidence":"record","conflicting":false},
   {"key":"accepted","state":"status_only","evidence":"status","conflicting":true,"reports":{"claims":3,"by_side":{"client":3}}},
   {"key":"in_progress","state":"reached","evidence":"record","clock":"2026-02-27T00:00:00Z","basis":"legacy_start_clock_or_component_events"},
   {"key":"done","state":"not_yet","conflicting":true,"reports":{"claims":3}},{"key":"paid","state":"withheld"}]}',
 'legacy job: estimate partial, accepted status only and conflicting, testimony beside the step without moving it, paid withheld');
SELECT t_assert(work_order_progress_tracker('{
   "intake":{"state":"recorded"},
   "terms":{"current_quote":{"quote_id":"q"},"quote_clock":"2026-10-01T00:00:00Z","customer_acceptance":"signed","approval_clock":"2026-10-02T00:00:00Z"},
   "execution":{"state":"recorded","start_sign":{"started_at":"2026-10-03T00:00:00Z"}},
   "completion":{"state":"recorded","provider_attestation":{"signed_at":"2026-10-04T00:00:00Z"},"customer_acceptance_sign":{"signed_at":"2026-10-05T00:00:00Z"}},
   "accounting":{"state":"recorded","state_basis":"current_invoice_settled_by_payee_witness","retained_testimony":{"claims":0}}}')
 @> '{"current_step":"paid","steps":[{"key":"quoted","state":"reached","evidence":"sign","clock":"2026-10-01T00:00:00Z"},
   {"key":"accepted","state":"reached","evidence":"sign","clock":"2026-10-02T00:00:00Z","clock_basis":"quote acceptance"},
   {"key":"in_progress","state":"reached","evidence":"sign","clock":"2026-10-03T00:00:00Z"},
   {"key":"done","state":"reached","evidence":"sign","customer_accepted":true,"customer_accepted_at":"2026-10-05T00:00:00Z"},
   {"key":"paid","state":"reached","evidence":"sign","reports":null}]}',
 'signed job: every step by Sign with its clock; zero testimony reports nothing');
SELECT t_assert(work_order_progress_tracker('{"completion":{"state":"status_only"},"accounting":{"state":"partial","invoice":{"issued_at":"2026-10-06T00:00:00Z"}}}')
 @> '{"current_step":"paid","steps":[{"key":"requested","state":"not_yet"},{"key":"done","state":"status_only","evidence":"status"},
   {"key":"paid","state":"partial","evidence":"sign","clock":"2026-10-06T00:00:00Z","clock_basis":"invoice issued"}]}'
 AND work_order_progress_tracker('{}') @> '{"current_step":null}',
 'status-only completion and an open invoice; an empty path reaches nothing');
SELECT t_assert(has_function_privilege('anon','work_order_provider_place_read(uuid)','EXECUTE')
 AND has_function_privilege('authenticated','work_order_provider_place_read(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','organization_public_place(uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','work_order_progress_tracker(jsonb)','EXECUTE'),'reader open; helpers internal');
