-- Disposable PG17 only. Proves 20261019160000_provider_profile_read_cold_start.sql keeps provider_profile_read's
-- output: every section except the rewritten photo scan and facilities is identical to the previous reader, the scan
-- returns the same counts with its window stated, and facilities derive relation weight from the same sources over
-- 14 days. Fixture and prior state: the provider job-record contract chain.
\set ON_ERROR_STOP on
\ir test_provider_job_record_read.sql

-- The user_org_relations sources and the relation helpers, as live.
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
  SELECT CASE
    WHEN p_last IS NULL OR p_at IS NULL OR p_last > p_at THEN 0::double precision
    WHEN extract(epoch FROM (p_at - p_last)) / extract(epoch FROM p_half_life) > 50 THEN 0::double precision
    ELSE power(2::double precision, -extract(epoch FROM (p_at - p_last)) / extract(epoch FROM p_half_life)) END $$;
CREATE FUNCTION public.relation_state(p_weight double precision) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN p_weight >= 0.5 THEN 'live' WHEN p_weight >= 0.0625 THEN 'stalling' ELSE 'dormant' END $$;
INSERT INTO public.organization_images(organization_id,user_id,taken_at) VALUES
 ('0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006', now() - interval '3 hours'),
 ('0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006', now() - interval '40 days');
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
CREATE TEMP TABLE before_anon AS SELECT provider_profile_read('00000000-0000-0000-0000-000000000006') j;
CREATE TEMP TABLE before_actor AS SELECT provider_profile_read(NULL, 'a0000000-0000-0000-0000-0000000000f1') j;
RESET ROLE;
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000006');
CREATE TEMP TABLE before_self AS SELECT provider_profile_read('00000000-0000-0000-0000-000000000006') j;
GRANT SELECT ON before_self TO PUBLIC;
RESET ROLE;
GRANT SELECT ON before_anon, before_actor TO PUBLIC;

\ir ../migrations/20261019160000_provider_profile_read_cold_start.sql

CREATE FUNCTION public.t_stable_part(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('viewer', j->'viewer', 'subject', j->'subject', 'claims', j->'claims', 'capabilities', j->'capabilities',
    'claimed_owned', j#>'{tools,claimed_owned}', 'co_signed', j#>'{tools,co_signed}', 'identity_bridge', j->'identity_bridge',
    'work_record', j->'work_record', 'contact', j->'contact', 'money', j->'money') $$;
CREATE FUNCTION public.t_scan_counts(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT (j#>'{tools,seen_in_frame}') - 'eligible_window' - 'basis' $$;
GRANT EXECUTE ON FUNCTION public.t_stable_part(jsonb), public.t_scan_counts(jsonb) TO anon, authenticated;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
CREATE TEMP TABLE after_anon AS SELECT provider_profile_read('00000000-0000-0000-0000-000000000006') j;
SELECT t_assert((SELECT t_stable_part(a.j) = t_stable_part(b.j) FROM after_anon a, before_anon b), 'visitor: every section but scan and facilities unchanged');
SELECT t_assert((SELECT t_scan_counts(a.j) = t_scan_counts(b.j) FROM after_anon a, before_anon b), 'visitor: same sightings, frames, labels and eligible count');
SELECT t_assert((SELECT j#>'{tools,seen_in_frame,eligible_window}' @> '{"recent_photos":4,"cap":5000}' FROM after_anon), 'visitor: eligible window stated');
SELECT t_assert((SELECT j->'facilities' @> '[{"relation_kind":"member","name":"Fixture Shop","role":"technician","membership_status":"active","city":"Boise","relation":{"state":"live","window_days":14},"actor_profile":{"kind":"organization"}}]'
  AND (j#>>'{facilities,0,relation,weight}')::float8 BETWEEN 0.70 AND 0.71 FROM after_anon), 'visitor: relation weight from a contribution 3 hours ago (40-day-old one outside the window)');
SELECT t_assert((SELECT NOT t_provider_pii(j) FROM after_anon), 'visitor: still no personal information or money');
SELECT t_assert((SELECT t_stable_part(a.j) = t_stable_part(b.j) FROM (SELECT provider_profile_read(NULL, 'a0000000-0000-0000-0000-0000000000f1') j) a, before_actor b),
  'actor subject unchanged');
SELECT t_assert(t_refused($q$SELECT provider_profile_read('00000000-0000-0000-0000-000000000002')$q$), 'visitor: private profile still refused');
RESET ROLE;
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000006');
SELECT t_assert((SELECT t_stable_part(a.j) = t_stable_part(b.j) AND t_scan_counts(a.j) = t_scan_counts(b.j)
  FROM (SELECT provider_profile_read('00000000-0000-0000-0000-000000000006') j) a, before_self b), 'self: unchanged, private-vehicle photo still counted');
RESET ROLE;
SELECT t_assert((SELECT prosecdef AND 'search_path=pg_catalog, public' = ANY (proconfig) AND has_function_privilege('anon', oid, 'EXECUTE')
  AND prosrc !~ 'user_org_relations\(' FROM pg_proc WHERE proname = 'provider_profile_read'), 'definer, pinned search_path, anon; no per-call user_org_relations');
