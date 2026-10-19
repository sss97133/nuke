-- Disposable PG17 only. Proves 20261019181500_contact_broker.sql: brokered in-app contact with no contact fields;
-- routing to a work order's customer without revealing them; org and evidenced-actor recipients; threads readable only
-- by the parties (not strangers, not admins); rate limit; the open readers offer the action to signed-in non-subjects.
-- Fixture and prior state: the open-requirements contract chain (its earlier contracts run first).
\set ON_ERROR_STOP on
\ir test_open_requirements_read.sql

-- Bring provider_profile_read to its live (cold-start) definition: the user_org_relations sources it reads.
CREATE TABLE public.organization_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid,
  taken_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.timeline_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid, event_date date);
CREATE TABLE public.contractor_work_contributions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
  contractor_user_id uuid, work_date date);
CREATE FUNCTION public.org_site_photos(p_org_id uuid, p_user_id uuid, p_from timestamptz, p_to timestamptz, p_radius_m double precision DEFAULT 150)
RETURNS TABLE(image_id uuid, vehicle_id uuid, taken_at timestamptz, shared_with integer, vehicle_linked boolean)
LANGUAGE sql STABLE AS $$ SELECT NULL::uuid, NULL::uuid, NULL::timestamptz, NULL::integer, NULL::boolean WHERE false $$;
CREATE FUNCTION public.relation_weight(p_last timestamptz, p_at timestamptz DEFAULT now(), p_half_life interval DEFAULT '06:00:00')
RETURNS double precision LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN p_last IS NULL OR p_at IS NULL OR p_last > p_at THEN 0::double precision
    WHEN extract(epoch FROM (p_at - p_last)) / extract(epoch FROM p_half_life) > 50 THEN 0::double precision
    ELSE power(2::double precision, -extract(epoch FROM (p_at - p_last)) / extract(epoch FROM p_half_life)) END $$;
CREATE FUNCTION public.relation_state(p_weight double precision) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN p_weight >= 0.5 THEN 'live' WHEN p_weight >= 0.0625 THEN 'stalling' ELSE 'dormant' END $$;
\ir ../migrations/20261019160000_provider_profile_read_cold_start.sql

\ir ../migrations/20261019181500_contact_broker.sql

CREATE FUNCTION public.t_contact_pii(j jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT j::text ~ '(second_customer|Other Customer|example\.com|5550|"email"|"phone"|"address"|full_name|Private Painter|Fixture Performer)' $$;
GRANT EXECUTE ON FUNCTION public.t_contact_pii(jsonb) TO anon, authenticated;

SELECT t_assert(NOT has_table_privilege('anon','public.contact_requests','SELECT') AND NOT has_table_privilege('authenticated','public.contact_requests','SELECT')
  AND NOT has_table_privilege('authenticated','public.contact_messages','SELECT') AND NOT has_table_privilege('authenticated','public.contact_messages','INSERT'),
  'contact tables have no anon/authenticated privileges');
SELECT t_assert((SELECT bool_and(prosecdef AND has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
    AND prosrc !~* '(net\.http|http_post|pg_net|send_email|resend\.|twilio|functions/v1)') AND count(*) = 6
  FROM pg_proc WHERE proname IN ('request_contact','respond_contact_request','withdraw_contact_request','post_contact_message','my_contact_requests','contact_thread_read')),
  'six definer functions, authenticated only, no outbound sending');
SELECT t_assert((SELECT count(*) FROM information_schema.columns WHERE table_name IN ('contact_requests','contact_messages')
  AND column_name ~ '(email|phone|address)') = 0, 'no contact-field columns');

-- 1. Anonymous callers cannot contact; readers offer nothing to them.
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT t_assert(t_refused($q$SELECT request_contact('requirement','81000000-0000-0000-0000-000000000001','hello')$q$)
  AND t_refused('SELECT my_contact_requests()'), 'anon cannot request or read');
SELECT t_assert((SELECT provider_profile_read('00000000-0000-0000-0000-000000000006') @> '{"contact":{"action":"contact_via_nuke","available":false}}')
  AND (SELECT work_order_statement_read('30000000-0000-0000-0000-00000000000d') @> '{"contact":{"available":false}}')
  AND (SELECT open_requirements_read() @> '{"contact":{"available":false}}'), 'anon: contact action not available');
RESET ROLE;

-- 2. A signed-in stranger reaches a requirement's customer without learning who they are.
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000003');
SELECT t_assert((SELECT provider_profile_read('00000000-0000-0000-0000-000000000006') @> '{"contact":{"available":true,"request":{"writer":"request_contact","context_kind":"profile","recipient_user_id":"00000000-0000-0000-0000-000000000006"}}}')
  AND (SELECT work_order_statement_read('30000000-0000-0000-0000-00000000000d') @> '{"contact":{"available":true,"request":{"context_kind":"work_order"}}}')
  AND (SELECT open_requirements_read() @> '{"contact":{"available":true,"request":{"context_kind":"requirement"}}}'), 'signed-in non-subject: contact available in all three readers');
SELECT t_assert((SELECT provider_profile_read(NULL, 'a0000000-0000-0000-0000-0000000000f2') @> '{"contact":{"available":false}}')
  AND (SELECT provider_profile_read(NULL, 'a0000000-0000-0000-0000-0000000000f1') @> '{"contact":{"available":true}}'), 'actor contact only through an evidenced link');
CREATE TEMP TABLE kb_c1 AS SELECT request_contact('requirement','81000000-0000-0000-0000-000000000001','I have a TIG welder and can do the flanges') j;
GRANT SELECT ON kb_c1 TO PUBLIC;
SELECT t_assert((SELECT j @> '{"status":"pending","recipient":{"kind":"user","label":"unnamed party"},"delivery":"in_app"}' AND NOT t_contact_pii(j) FROM kb_c1),
  'requirement contact routes to the customer as an unnamed party (private profile)');
SELECT t_assert(t_refused($q$SELECT request_contact('requirement','81000000-0000-0000-0000-000000000001','again')$q$), 'duplicate pending request refused');
SELECT t_assert(t_refused($q$SELECT request_contact('work_order','30000000-0000-0000-0000-00000000000e','private job')$q$), 'private-vehicle context refused for a stranger');
SELECT t_assert(t_refused($q$SELECT request_contact('profile','a0000000-0000-0000-0000-0000000000f2','hi',NULL,'a0000000-0000-0000-0000-0000000000f2')$q$), 'unlinked actor unreachable');
SELECT t_assert(t_refused($q$SELECT post_contact_message((SELECT (j->>'request_id')::uuid FROM kb_c1),'early')$q$), 'no thread before acceptance');
SELECT t_assert(t_refused($q$SELECT respond_contact_request((SELECT (j->>'request_id')::uuid FROM kb_c1), true)$q$), 'requester cannot accept their own request');
CREATE TEMP TABLE kb_c2 AS SELECT request_contact('work_order','30000000-0000-0000-0000-00000000000d','Question for the shop',NULL,NULL,'0a000000-0000-0000-0000-000000000001') j;
CREATE TEMP TABLE kb_c3 AS SELECT request_contact('profile','a0000000-0000-0000-0000-0000000000f1','Saw your exhaust work',NULL,'a0000000-0000-0000-0000-0000000000f1') j;
GRANT SELECT ON kb_c2, kb_c3 TO PUBLIC;
SELECT t_assert((SELECT j @> '{"recipient":{"kind":"organization","name":"Fixture Shop"}}' FROM kb_c2) AND (SELECT j @> '{"recipient":{"kind":"user","handle":"fixture_tech"}}' FROM kb_c3),
  'organization and evidenced-actor recipients');
RESET ROLE;

-- 3. The customer accepts; the thread is visible to the two parties only.
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000002');
CREATE TEMP TABLE kb_m2 AS SELECT my_contact_requests() j;
SELECT t_assert((SELECT j @> '{"incoming":[{"direction":"incoming","counterpart":{"kind":"user","label":"unnamed party"},"context":{"kind":"requirement"},"status":"pending","actions":["respond_contact_request"]}],"outgoing":[]}'
  AND NOT t_contact_pii(j) FROM kb_m2), 'customer sees the incoming request; requester shown as unnamed party');
SELECT respond_contact_request((SELECT (j->>'request_id')::uuid FROM kb_c1), true);
SELECT post_contact_message((SELECT (j->>'request_id')::uuid FROM kb_c1), 'Yes, can you come Tuesday?');
RESET ROLE;
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000003');
SELECT post_contact_message((SELECT (j->>'request_id')::uuid FROM kb_c1), 'Tuesday works.');
CREATE TEMP TABLE kb_t3 AS SELECT contact_thread_read((SELECT (j->>'request_id')::uuid FROM kb_c1)) j;
SELECT t_assert((SELECT j @> '{"can_post":true,"request":{"status":"accepted","direction":"outgoing"},"messages":[{"body":"Yes, can you come Tuesday?","author":{"kind":"user","label":"unnamed party"}},{"body":"Tuesday works.","author":{"kind":"you"}}]}'
  AND NOT t_contact_pii(j) FROM kb_t3), 'requester reads the thread; counterpart unnamed');
SELECT t_assert(t_refused($q$SELECT withdraw_contact_request((SELECT (j->>'request_id')::uuid FROM kb_c1))$q$), 'an accepted request cannot be withdrawn');
SELECT withdraw_contact_request((SELECT (j->>'request_id')::uuid FROM kb_c3));
RESET ROLE;
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000005');
SELECT t_assert(t_refused($q$SELECT contact_thread_read((SELECT (j->>'request_id')::uuid FROM kb_c1))$q$)
  AND t_refused($q$SELECT post_contact_message((SELECT (j->>'request_id')::uuid FROM kb_c1),'admin here')$q$), 'an admin is a stranger to the thread');
SELECT t_assert((SELECT j @> '{"incoming":[],"outgoing":[]}' FROM (SELECT my_contact_requests() j) x), 'a stranger sees no requests');
SELECT t_as('00000000-0000-0000-0000-000000000006');
SELECT t_assert(t_refused($q$SELECT contact_thread_read((SELECT (j->>'request_id')::uuid FROM kb_c1))$q$), 'another provider cannot read the thread');
SELECT t_assert((SELECT jsonb_array_length(j->'incoming') = 2 AND j->'incoming' @> '[{"recipient_kind":"organization","status":"pending"},{"recipient_kind":"actor","status":"withdrawn"}]'
  FROM (SELECT my_contact_requests() j) x), 'org member and bridged actor account see their incoming requests');
SELECT t_assert(t_refused($q$SELECT request_contact('work_order','30000000-0000-0000-0000-00000000000d','self',NULL,NULL,'0a000000-0000-0000-0000-000000000001')$q$), 'members cannot contact their own organization');
SELECT t_as('00000000-0000-0000-0000-000000000004');
SELECT respond_contact_request((SELECT (j->>'request_id')::uuid FROM kb_c2), false);
SELECT t_assert((SELECT j->'incoming' @> '[{"recipient_kind":"organization","status":"declined"}]' FROM (SELECT my_contact_requests() j) x), 'an org owner declines for the organization');
SELECT t_as('00000000-0000-0000-0000-000000000002');
SELECT t_assert((SELECT work_order_statement_read('30000000-0000-0000-0000-00000000000d') @> '{"contact":{"available":false}}'), 'a party to the work order is not offered contact with itself');
RESET ROLE;

-- 4. Rate limit: ten requests per requester per rolling day.
INSERT INTO public.contact_requests(requester_user_id, recipient_user_id, context_kind, context_id, message, created_at)
  SELECT '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000006', 'profile', gen_random_uuid(), 'filler', clock_timestamp()
  FROM generate_series(1, 7);
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000003');
SELECT t_assert((SELECT j @> '{"limits":{"requests_per_day":10,"requests_sent_last_day":10}}' FROM (SELECT my_contact_requests() j) x), 'limits reported');
SELECT t_assert(t_refused($q$SELECT request_contact('profile','00000000-0000-0000-0000-000000000001','one more')$q$), 'eleventh request in a day refused');
RESET ROLE;
