-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_readers_1 -f this-file.sql
-- Proves 20261125160500_definer_readers_visibility.sql: get_image_deep_analysis and intake_live_state (SECURITY
-- DEFINER, executable by anon) return a row about a photo only where the photo is shown (gallery-eligible, not
-- sensitive, on a public undeleted vehicle), to its uploader, or to a caller tied to its vehicle; and name a vehicle
-- only where it is public and undeleted or the caller is tied. service_role keeps every row.
-- The fixture mirrors production as read on 2026-11-25 (information_schema.columns, pg_constraint, a subset of pg_policies,
-- role_table_grants, pg_get_functiondef): the columns these bodies and their helpers touch with their types, NOT NULLs,
-- defaults, checks and foreign keys; the live bodies of vehicle_image_gallery_eligible(vehicle_images_public),
-- vehicle_image_privacy_withheld, image_stage_custody_external, vehicle_viewer_tied, vehicle_user_has_access, and of the
-- two readers before the change (every one of these prosrc sha256 is asserted equal to production's; the tie helpers are the
-- plpgsql bodies #3900 deployed). The BaT listing lookup of a
-- pending bat_import photo is stubbed false; no seed row reaches it. postgres owns the readers and bypasses RLS, as in
-- production (there BYPASSRLS, here the superuser running this file).
-- Mutation note: drop the shown/uploader/tied test from get_image_deep_analysis and 'after: anon reads no analysis of
-- an unfiled, private, deleted, ineligible, sensitive or plate-withheld photo' fails; drop it from the feed and
-- 'after: anon feed is the shown photo only' fails; drop the vehicle test from fleet and 'after: anon fleet is car A
-- only' fails; drop is_sensitive from branch (a) and the sensitive_a case of the first assertion fails.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- auth.uid() and auth.role() read the request's claims, as production's do.
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- Signs in as a user id ('' = anon, 'service' = service_role), as PostgREST sets the claims.
CREATE FUNCTION public.t_claims(p_uid text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', CASE WHEN p_uid = '' THEN '{"role":"anon"}'
     WHEN p_uid = 'service' THEN '{"role":"service_role"}'
     ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, false) $$;

CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TYPE public.content_approval_status AS ENUM ('pending', 'auto_approved', 'approved', 'rejected');
CREATE TYPE public.content_redaction_level AS ENUM ('none', 'details_hidden', 'full_blur');

CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), uploaded_by uuid DEFAULT auth.uid(),
  make text, model text, year integer, is_public boolean DEFAULT true, deleted_at timestamptz,
  user_id uuid, owner_id uuid, created_by_user_id uuid);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  user_id uuid,
  image_url text NOT NULL,
  created_at timestamptz DEFAULT now(),
  exif_data jsonb,
  taken_at timestamptz,
  source text DEFAULT 'user_upload',
  is_external boolean DEFAULT false,
  is_sensitive boolean NOT NULL DEFAULT false,
  ai_scan_metadata jsonb DEFAULT '{}'::jsonb,
  is_approved boolean DEFAULT true,
  verification_status text DEFAULT 'approved',
  approval_status public.content_approval_status NOT NULL DEFAULT 'pending',
  redaction_level public.content_redaction_level NOT NULL DEFAULT 'none',
  is_document boolean DEFAULT false,
  is_duplicate boolean DEFAULT false,
  documented_by_user_id uuid,
  last_rerun_at timestamptz,
  image_vehicle_match_status text,
  vision_gate_status public.vision_gate_status DEFAULT 'pending',
  is_superseded boolean DEFAULT false,
  CONSTRAINT vehicle_images_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  CONSTRAINT vehicle_images_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT vehicle_images_documented_by_user_id_fkey FOREIGN KEY (documented_by_user_id) REFERENCES auth.users(id),
  CONSTRAINT vehicle_images_url_scheme_check CHECK ((image_url IS NULL) OR (image_url = '') OR (image_url ~ '^https?://') OR (image_url ~~ 'data:image/%')),
  CONSTRAINT vehicle_images_verification_status_check CHECK (verification_status = ANY (ARRAY['pending', 'approved', 'rejected'])));
CREATE TABLE public.image_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicles(id),
  confidence_basis jsonb NOT NULL DEFAULT '{}'::jsonb, observed_by text NOT NULL, agent_version text,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT image_observations_check CHECK ((vehicle_id IS NOT NULL) OR (observed_by IS NOT NULL)));
CREATE TABLE public.work_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  session_date date NOT NULL, image_count integer NOT NULL DEFAULT 0, work_description text,
  created_at timestamptz DEFAULT now(), title text);
CREATE TABLE public.photo_extracted_fields (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  field_name text NOT NULL, value text NOT NULL, source text NOT NULL DEFAULT 'classifier_v2',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (image_id, field_name, source));
CREATE TABLE public.image_privacy_rules (field_name text NOT NULL, min_alnum integer NOT NULL CHECK (min_alnum >= 1),
  applies_to text NOT NULL CHECK (applies_to = 'custody'), enabled boolean NOT NULL DEFAULT true,
  reason text NOT NULL CHECK (btrim(reason) <> ''), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (field_name, applies_to));
CREATE TABLE public.admin_users (user_id uuid REFERENCES auth.users(id), is_active boolean);
CREATE TABLE public.ownership_verifications (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid REFERENCES auth.users(id), status text);
CREATE TABLE public.vehicle_user_permissions (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid REFERENCES auth.users(id), is_active boolean, role text, granted_by uuid);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid REFERENCES auth.users(id), status text, role text);
CREATE TABLE public.organization_vehicles (organization_id uuid, vehicle_id uuid REFERENCES public.vehicles(id), relationship_type text, status text, linked_by_user_id uuid);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid REFERENCES auth.users(id), status text, role text);

-- vehicle_images_public: production projects vehicle_images 1:1 (security_invoker); these are the columns read here.
CREATE VIEW public.vehicle_images_public WITH (security_invoker = true) AS
  SELECT id, vehicle_id, user_id, image_url, source, is_document, is_duplicate, is_superseded, is_sensitive,
         image_vehicle_match_status, vision_gate_status, is_external, is_approved, approval_status, verification_status,
         redaction_level, taken_at, ai_scan_metadata
  FROM public.vehicle_images;

CREATE FUNCTION public.bat_pending_image_listing_by_id(p_image_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO '' AS $$ SELECT false $$;

-- Live bodies, 2026-11-25.
CREATE OR REPLACE FUNCTION public.image_stage_custody_external(p_is_external boolean, p_user_id uuid, p_source text, p_exif jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select case
    when p_is_external is not true then false
    -- the owner's own cached Photos preview (20261115182056): is_external records that the original is not held, not
    -- that the photo is someone else's
    when p_user_id is not null and p_source = 'iphoto'
         and p_exif -> 'source_rendition' ->> 'contract' = 'photos_cached_preview_v1' then false
    else true
  end $function$;

CREATE OR REPLACE FUNCTION public.vehicle_viewer_tied(p_vehicle_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- vehicle_viewer_tie_plpgsql_v1: the reviewed SQL body, unchanged.
  RETURN (
  SELECT CASE
           WHEN (SELECT auth.role()) = 'service_role' THEN true
           WHEN (SELECT auth.uid()) IS NULL THEN false
           ELSE coalesce((SELECT (SELECT auth.uid()) IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by)
                            FROM public.vehicles v WHERE v.id = p_vehicle_id), false)
                OR coalesce(public.vehicle_user_has_access(p_vehicle_id, (SELECT auth.uid())), false)
         END
);
END
$function$
;

CREATE OR REPLACE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- vehicle_viewer_tie_plpgsql_v1: the reviewed SQL body, unchanged.
  RETURN (
  SELECT p_user_id IS NOT NULL AND p_vehicle_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.vehicles v
      WHERE v.id = p_vehicle_id AND p_user_id IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = p_user_id AND au.is_active)
    OR EXISTS (SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = p_vehicle_id AND ov.user_id = p_user_id AND ov.status = 'approved')
    OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup JOIN public.vehicles v ON v.id = vup.vehicle_id
      WHERE vup.vehicle_id = p_vehicle_id AND vup.user_id = p_user_id AND coalesce(vup.is_active, true)
        AND vup.role = ANY (ARRAY['owner', 'co_owner', 'mechanic', 'appraiser', 'moderator', 'contributor', 'photographer',
          'dealer_rep', 'sales_agent', 'restorer', 'consigner', 'board_member'])
        AND vup.granted_by <> vup.user_id AND vup.granted_by IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc
      WHERE vc.vehicle_id = p_vehicle_id AND vc.user_id = p_user_id AND coalesce(vc.status, 'active') = 'active'
        AND vc.role = ANY (ARRAY['owner', 'co_owner', 'restorer', 'moderator', 'consigner', 'mechanic', 'appraiser',
          'photographer', 'sales_agent']))
    OR EXISTS (SELECT 1 FROM public.organization_vehicles ov JOIN public.vehicles v ON v.id = ov.vehicle_id
      JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
      WHERE ov.vehicle_id = p_vehicle_id AND ov.relationship_type IN ('owner', 'consigner') AND ov.status = 'active'
        AND (ov.linked_by_user_id IS NULL OR ov.linked_by_user_id IN (v.user_id, v.owner_id))
        AND oc.user_id = p_user_id AND oc.status = 'active'
        AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee')))
);
END
$function$
;

CREATE OR REPLACE FUNCTION public.vehicle_image_privacy_withheld(p_image_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER COST 50
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE
    WHEN (SELECT auth.role()) = 'service_role' THEN false
    -- no viewer: a direct database session (cron, a job's trigger, a stored fold) carries no request claims and is not
    -- PostgREST's authenticator
    WHEN (SELECT auth.role()) IS NULL AND session_user <> 'authenticator' THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.photo_extracted_fields f
      JOIN public.image_privacy_rules r
        ON r.field_name = f.field_name AND r.enabled AND r.applies_to = 'custody'
      JOIN public.vehicle_images i ON i.id = f.image_id
      WHERE f.image_id = p_image_id
        AND length(regexp_replace(upper(f.value), '[^A-Z0-9]', '', 'g')) >= r.min_alnum
        AND NOT public.image_stage_custody_external(i.is_external, i.user_id, i.source, i.exif_data)
        AND i.user_id IS DISTINCT FROM (SELECT auth.uid())
        AND NOT public.vehicle_viewer_tied(i.vehicle_id))
  END
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images_public)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    coalesce(($1).is_document,false)=false
    AND coalesce(($1).is_duplicate,false)=false
    AND coalesce(($1).is_superseded,false)=false
    AND nullif(btrim(($1).image_url),'') IS NOT NULL
    AND ($1).image_url NOT LIKE 'file://%'
    AND (($1).source IS NULL OR ($1).source <> 'e2e_test')
    AND coalesce(($1).image_vehicle_match_status,'') NOT IN ('mismatch','unrelated')
    AND CASE
      WHEN ($1).vision_gate_status IS NULL OR ($1).vision_gate_status::text='approved' THEN true
      WHEN ($1).vision_gate_status::text='pending' THEN
        coalesce(($1).is_sensitive,false)=false
        AND (
          (
            coalesce(($1).source='bat_import',false)
            AND ($1).is_external IS TRUE
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text IN ('approved','auto_approved'),false)
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://(www\.)?bringatrailer\.com/wp-content/uploads/'
            AND public.bat_pending_image_listing_by_id(($1).id)
          )
          OR (
            -- listing capture: a photo taken from a public web listing by an extractor, never an upload
            coalesce(($1).source='bat_import',false)=false
            AND ($1).is_external IS TRUE
            AND ($1).user_id IS NULL
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text,'') <> 'rejected'
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://'
          )
        )
      ELSE false
    END
    -- privacy rule rows (image_privacy_rules): a custody photo with a keyed private reading, for a viewer who is
    -- neither its uploader nor tied to its vehicle
    AND NOT public.vehicle_image_privacy_withheld(($1).id);
$function$;

-- The two readers as production holds them before the migration (pg_get_functiondef, 2026-11-25).
CREATE OR REPLACE FUNCTION public.get_image_deep_analysis(p_image_id uuid)
 RETURNS TABLE(image_id uuid, narrative text, intent text, intent_confidence numeric, scene_type text, build_phase text, place_hint text, confidence numeric, agent_model text, agent_notes text, analyzed_at timestamp with time zone, paint_state text, rust_severity text, completeness text, damage_callouts jsonb, components jsonb, open_questions jsonb, needs_review boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT vi.id,b->>'narrative_one_line',b->>'intent',nullif(b->>'intent_confidence','')::numeric,
  b->>'scene_type',b->>'build_phase_guess',b->'presence'->>'place_hint',nullif(b->>'confidence','')::numeric,
  b->>'agent_model',b->>'agent_notes',nullif(b->>'analyzed_at','')::timestamptz,
  b->'state_observations'->>'paint_state',b->'state_observations'->>'rust_severity',
  b->'state_observations'->>'completeness',b->'state_observations'->'damage_callouts',
  b->'components_seen',b->'open_questions',nullif(b->>'needs_review','')::boolean
 FROM public.vehicle_images vi
 CROSS JOIN LATERAL(SELECT vi.ai_scan_metadata->'byok_deep_analysis' AS b) j
 WHERE vi.id=p_image_id AND vi.ai_scan_metadata ? 'byok_deep_analysis'
   AND (coalesce(b->>'prompt_version','')<>'reviewed_image_analysis_v1' OR EXISTS(
     SELECT 1 FROM public.image_observations io WHERE io.image_id=vi.id AND io.is_active
       AND io.observed_by='caller-byok' AND io.agent_version='reviewed_image_analysis_v1'
       AND io.confidence_basis#>>'{reviewed_image_analysis_v1,observation_id}'=b->>'observation_id'
       AND io.confidence_basis#>>'{reviewed_image_analysis_v1,image_url}'=vi.image_url
       AND io.confidence_basis#>>'{reviewed_image_analysis_v1,vehicle_id}'=vi.vehicle_id::text));
$function$
;

CREATE OR REPLACE FUNCTION public.intake_live_state(p_feed_limit integer DEFAULT 24, p_sessions_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select jsonb_build_object(
  'server_time', now(),

  -- per-vehicle burn progress (approved-analyzed / approved-total)
  'fleet', coalesce((
    select jsonb_agg(jsonb_build_object(
        'vehicle_id', f.vehicle_id,
        'vehicle_name', nullif(trim(concat_ws(' ', v.year::text, v.make, v.model)), ''),
        'total', f.total,
        'analyzed', f.analyzed,
        'last_analyzed_at', f.last_analyzed_at
      ) order by f.total desc)
    from (
      select vi.vehicle_id,
             count(*)::int as total,
             (count(*) filter (where vi.ai_scan_metadata ? 'byok_deep_analysis'))::int as analyzed,
             max(vi.last_rerun_at) as last_analyzed_at
      from vehicle_images vi
      where vi.source = 'user_upload'
        and vi.vision_gate_status = 'approved'
        and vi.vehicle_id is not null
      group by vi.vehicle_id
    ) f
    left join vehicles v on v.id = f.vehicle_id
  ), '[]'::jsonb),

  -- frames analyzed in the last 30 minutes (ETA rate basis)
  'analyzed_last_30m', (
    select count(*)::int
    from vehicle_images vi
    where vi.source = 'user_upload'
      and vi.vision_gate_status = 'approved'
      and vi.last_rerun_at >= now() - interval '30 minutes'
  ),

  -- most recently analyzed frames, newest first
  'feed', coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'vehicle_id', t.vehicle_id,
        'vehicle_name', nullif(trim(concat_ws(' ', v.year::text, v.make, v.model)), ''),
        'image_url', t.image_url,
        'taken_at', t.taken_at,
        'analyzed_at', t.last_rerun_at,
        'line', t.bda ->> 'narrative_one_line',
        'scene_type', t.bda ->> 'scene_type',
        'build_phase', t.bda ->> 'build_phase_guess',
        'intent', t.bda ->> 'intent',
        'confidence', t.bda ->> 'confidence'
      ) order by t.last_rerun_at desc, t.id)
    from (
      select vi.id, vi.vehicle_id, vi.image_url, vi.taken_at, vi.last_rerun_at,
             vi.ai_scan_metadata -> 'byok_deep_analysis' as bda
      from vehicle_images vi
      where vi.source = 'user_upload'
        and vi.vision_gate_status = 'approved'
        and vi.last_rerun_at is not null
      order by vi.last_rerun_at desc, vi.id
      limit p_feed_limit
    ) t
    left join vehicles v on v.id = t.vehicle_id
  ), '[]'::jsonb),

  -- work_session rollups created today (America/Los_Angeles day)
  'sessions_today', coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'vehicle_id', s.vehicle_id,
        'vehicle_name', nullif(trim(concat_ws(' ', v.year::text, v.make, v.model)), ''),
        'session_date', s.session_date,
        'title', s.title,
        'image_count', s.image_count,
        'summary', left(coalesce(s.work_description, ''), 220),
        'created_at', s.created_at
      ) order by s.created_at desc)
    from (
      select ws.id, ws.vehicle_id, ws.session_date, ws.title, ws.image_count,
             ws.work_description, ws.created_at
      from work_sessions ws
      where (ws.created_at at time zone 'America/Los_Angeles')::date
          = (now() at time zone 'America/Los_Angeles')::date
      order by ws.created_at desc
      limit p_sessions_limit
    ) s
    left join vehicles v on v.id = s.vehicle_id
  ), '[]'::jsonb)
);
$function$
;

-- Live grants (pg_proc.proacl, role_table_grants, 2026-11-25): both readers executable by PUBLIC, anon, authenticated,
-- service_role; anon holds column grants on vehicle_images (no exif_data); neither role holds table SELECT on vehicles.
GRANT EXECUTE ON FUNCTION public.get_image_deep_analysis(uuid), public.intake_live_state(integer, integer)
  TO anon, authenticated, service_role;
GRANT SELECT (id, is_public, deleted_at, user_id, owner_id, uploaded_by, created_by_user_id) ON public.vehicles TO anon, authenticated;
GRANT SELECT (id, vehicle_id, user_id, documented_by_user_id, image_url, source, is_document, is_duplicate, is_superseded, is_sensitive,
  image_vehicle_match_status, vision_gate_status, is_external, is_approved, approval_status, verification_status, redaction_level,
  taken_at, ai_scan_metadata, last_rerun_at)
  ON public.vehicle_images TO anon;
GRANT SELECT ON public.vehicle_images TO authenticated;
GRANT SELECT ON public.vehicle_images_public, public.image_privacy_rules TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- A subset of the live SELECT policies (pg_policies, 2026-11-25): vehicles' two, two of vehicle_images' five, one of
-- work_sessions' four, image_privacy_rules' one. The readers run as their owner and bypass every one, so the policies
-- are inert here; they are kept so that a reader changed to run as invoker would meet them.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING ((is_public = true) OR (auth.role() = 'service_role'::text));
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT USING ((is_public = false) AND ((SELECT auth.uid()) IS NOT NULL)
  AND (((SELECT auth.uid()) = user_id) OR ((SELECT auth.uid()) = owner_id) OR ((SELECT auth.uid()) = uploaded_by)
    OR vehicle_user_has_access(id, (SELECT auth.uid()))));
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view images for public vehicles" ON public.vehicle_images FOR SELECT USING ((COALESCE(is_sensitive, false) = false)
  AND (COALESCE(is_superseded, false) = false) AND ((vision_gate_status IS NULL) OR (vision_gate_status <> ALL (ARRAY['rejected_personal'::vision_gate_status,
  'rejected_misattributed'::vision_gate_status, 'review_needed'::vision_gate_status])))
  AND (EXISTS (SELECT 1 FROM vehicles v WHERE ((v.id = vehicle_images.vehicle_id) AND (v.is_public = true)))));
CREATE POLICY "Users can view their own images" ON public.vehicle_images FOR SELECT USING (((SELECT auth.uid()) = user_id));
ALTER TABLE public.work_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own work sessions" ON public.work_sessions FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
ALTER TABLE public.image_privacy_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY image_privacy_rules_read ON public.image_privacy_rules FOR SELECT TO anon, authenticated USING (true);

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_hash(p regprocedure) RETURNS text LANGUAGE sql AS
$$ SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc WHERE oid = p $$;
-- The photo ids of the fixture, so a caller can ask for each by id as the iOS app does.
CREATE TABLE public.t_ids (id uuid PRIMARY KEY REFERENCES public.vehicle_images(id));
-- What the caller's claims read, as sorted label lists.
CREATE FUNCTION public.t_analysis() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(g.narrative, ',' ORDER BY g.narrative), '')
     FROM public.t_ids i CROSS JOIN LATERAL public.get_image_deep_analysis(i.id) g $$;
CREATE FUNCTION public.t_feed(p_limit int) RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(e ->> 'line', ',' ORDER BY e ->> 'line'), '')
     FROM jsonb_array_elements(public.intake_live_state(p_limit, 30) -> 'feed') e $$;
CREATE FUNCTION public.t_fleet() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(coalesce(e ->> 'vehicle_name', '?'), ',' ORDER BY e ->> 'vehicle_name'), '')
     FROM jsonb_array_elements(public.intake_live_state(30, 30) -> 'fleet') e $$;
CREATE FUNCTION public.t_sessions() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(l, ',' ORDER BY l), '') FROM (
     SELECT coalesce(e ->> 'title', '(hidden)') || ':' || coalesce(e ->> 'vehicle_name', '-') AS l
     FROM jsonb_array_elements(public.intake_live_state(30, 30) -> 'sessions_today') e) s $$;
-- Sessions whose title or summary text reaches the caller.
CREATE FUNCTION public.t_session_text() RETURNS bigint LANGUAGE sql AS
$$ SELECT count(*) FROM jsonb_array_elements(public.intake_live_state(30, 30) -> 'sessions_today') e
   WHERE e ->> 'title' IS NOT NULL OR e ->> 'summary' IS NOT NULL $$;
-- Every vehicle name anywhere in the reply (fleet, feed, sessions).
CREATE FUNCTION public.t_names() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(DISTINCT n, ',' ORDER BY n), '') FROM (
     SELECT e ->> 'vehicle_name' n FROM jsonb_array_elements(public.intake_live_state(30, 30) -> 'fleet') e
     UNION ALL SELECT e ->> 'vehicle_name' FROM jsonb_array_elements(public.intake_live_state(30, 30) -> 'feed') e
     UNION ALL SELECT e ->> 'vehicle_name' FROM jsonb_array_elements(public.intake_live_state(30, 30) -> 'sessions_today') e) s
   WHERE n IS NOT NULL $$;
GRANT SELECT ON public.t_ids TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_claims(text), public.t_analysis(), public.t_feed(int),
  public.t_fleet(), public.t_sessions(), public.t_session_text(), public.t_names() TO anon, authenticated, service_role;

SELECT t_assert(t_hash('public.get_image_deep_analysis(uuid)') = '3LWE/TnS8lwWQRuopztBD9HARireMredZGpW1BDMsd0='
  AND t_hash('public.intake_live_state(integer,integer)') = 'Sqe+TWsshVt5lgwtN0YjIebdzO6frcvmI5bjZwnBh5M=',
  'fixture: both readers start from the production bodies (prosrc sha256 equal to live, 2026-11-25)');
SELECT t_assert(t_hash('public.vehicle_image_gallery_eligible(vehicle_images_public)') = 'pm28CCn3eFgYdZ0blO9KK5Uy9ppL/Z88v8TqK+CYZ6U='
  AND t_hash('public.vehicle_image_privacy_withheld(uuid)') = 'PWcTwaCCdDm1r1kYu+tmXXuEtek23+RbjOLatWe6k6M='
  AND t_hash('public.image_stage_custody_external(boolean,uuid,text,jsonb)') = 'J6/sgBAco0luoRwBEZDG2gCu2hI3TfACBYU4+N0iJk8='
  AND t_hash('public.vehicle_viewer_tied(uuid)') = '5Tns59kfNm7OzF4MWp/icVPozUfBQqGgUYeQ98nkMlY='
  AND t_hash('public.vehicle_user_has_access(uuid,uuid)') = '3gatrT+MQ7WarLskKQWt3pPykWqFb92AFfAXgYcxVAI=',
  'fixture: the five helpers are the production bodies (prosrc sha256 equal to live after #3900, 2026-11-25)');

-- Users: u1 owns every car; u2 is a stranger; u3 photographs on u1's cars; u4 is a mechanic contributor on A.
-- Cars (make = its letter): A public, B private, C public but deleted.
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'), ('00000000-0000-0000-0000-000000000004');
INSERT INTO public.vehicles (id, make, is_public, deleted_at, user_id, uploaded_by) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'A', true,  NULL,         '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000b', 'B', false, NULL,         '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-00000000000c', 'C', true,  '2026-11-01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.vehicle_contributors VALUES
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'active', 'mechanic');
INSERT INTO public.image_privacy_rules (field_name, min_alnum, applies_to, reason) VALUES ('license_plate', 4, 'custody', 'plate');
-- Photos, all approved user uploads with a deep analysis whose narrative is the label; shown_a is the oldest analysed.
--   shown_a      A, u1                                 -> everyone
--   unfiled_u1   no vehicle, u1                        -> u1
--   private_b    B (private), u1                       -> u1
--   photog_b     B (private), uploaded by u3           -> u3 (uploader), u1 (tied)
--   deleted_c    C (deleted), u1                       -> u1
--   dup_a        A, is_duplicate (gallery-ineligible)  -> u1, u4 (tied)
--   sensitive_a  A, is_sensitive                       -> u1, u4
--   plate_a      A, custody photo (not external) by u3 with a plate reading; the privacy rule withholds it -> u3, u1, u4
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, vision_gate_status, is_duplicate, is_sensitive, is_external,
    ai_scan_metadata, last_rerun_at, taken_at) VALUES
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/1.jpg', 'approved', false, false, false, '{"byok_deep_analysis":{"narrative_one_line":"shown_a"}}', now() - interval '9 hours', now() - interval '10 days'),
  ('10000000-0000-0000-0000-000000000002', NULL,                                   '00000000-0000-0000-0000-000000000001', 'https://x.invalid/2.jpg', 'approved', false, false, false, '{"byok_deep_analysis":{"narrative_one_line":"unfiled_u1"}}', now() - interval '10 minutes', now() - interval '10 days'),
  ('10000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/3.jpg', 'approved', false, false, false, '{"byok_deep_analysis":{"narrative_one_line":"private_b"}}', now() - interval '2 hours', now() - interval '10 days'),
  ('10000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000003', 'https://x.invalid/4.jpg', 'approved', false, false, false, '{"byok_deep_analysis":{"narrative_one_line":"photog_b"}}', now() - interval '3 hours', now() - interval '10 days'),
  ('10000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/5.jpg', 'approved', false, false, false, '{"byok_deep_analysis":{"narrative_one_line":"deleted_c"}}', now() - interval '4 hours', now() - interval '10 days'),
  ('10000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/6.jpg', 'approved', true,  false, false, '{"byok_deep_analysis":{"narrative_one_line":"dup_a"}}', now() - interval '5 hours', now() - interval '10 days'),
  ('10000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/7.jpg', 'approved', false, true,  false, '{"byok_deep_analysis":{"narrative_one_line":"sensitive_a"}}', now() - interval '6 hours', now() - interval '10 days'),
  ('10000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'https://x.invalid/8.jpg', 'approved', false, false, false, '{"byok_deep_analysis":{"narrative_one_line":"plate_a"}}', now() - interval '7 hours', now() - interval '10 days');
INSERT INTO public.photo_extracted_fields (image_id, field_name, value) VALUES ('10000000-0000-0000-0000-000000000008', 'license_plate', 'TEST123');
INSERT INTO public.t_ids SELECT id FROM public.vehicle_images;
-- Sessions today: on A, B and C by u1, and on B by u3 (its author, not tied to B).
INSERT INTO public.work_sessions (user_id, vehicle_id, session_date, title, work_description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', current_date, 's_a', 'x'),
  ('00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', current_date, 's_b', 'x'),
  ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', current_date, 's_c', 'x'),
  ('00000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', current_date, 's_b3', 'x');

-- Before: the defect. Anon reads every analysis by id, a feed and fleet that carry private photos and cars, and
-- every session of the day.
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_analysis() = 'deleted_c,dup_a,photog_b,plate_a,private_b,sensitive_a,shown_a,unfiled_u1',
  'before: anon reads all 8 analyses by id (no caller test in the definer body)');
SELECT t_assert(t_feed(1) = 'unfiled_u1' AND t_fleet() = 'A,B,C' AND t_sessions() = 's_a:A,s_b:B,s_b3:B,s_c:C',
  'before: anon feed leads with an unfiled photo; fleet names B and C; every session is listed');
RESET ROLE;

-- Guard: a drifted live body is never overwritten, and the refusal changes neither function. (psql prints the
-- expected ERROR from the migration's DO block here.)
CREATE OR REPLACE FUNCTION public.intake_live_state(p_feed_limit integer DEFAULT 24, p_sessions_limit integer DEFAULT 30)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ select '{"drift":true}'::jsonb $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261125160500_definer_readers_visibility.sql
\set ON_ERROR_STOP on
RESET statement_timeout; RESET lock_timeout;
SELECT t_assert(position('drift' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.intake_live_state(integer,integer)'::regprocedure)) > 0
  AND t_hash('public.get_image_deep_analysis(uuid)') = '3LWE/TnS8lwWQRuopztBD9HARireMredZGpW1BDMsd0=',
  'guard: refuses a drifted body and leaves both functions as they were');
\ir revert_20261125160500_definer_readers_visibility.sql
SELECT t_assert(t_hash('public.intake_live_state(integer,integer)') = 'Sqe+TWsshVt5lgwtN0YjIebdzO6frcvmI5bjZwnBh5M=',
  'revert: restores the production body of intake_live_state');

\ir ../migrations/20261125160500_definer_readers_visibility.sql
\ir ../migrations/20261125160500_definer_readers_visibility.sql
RESET statement_timeout; RESET lock_timeout;

SELECT t_assert((SELECT bool_and(p.prosecdef) AND bool_and(pg_get_userbyid(p.proowner) = current_user)
    AND bool_and(has_function_privilege('anon', p.oid, 'EXECUTE')) AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    AND string_agg(p.provolatile::text, '' ORDER BY p.proname) = 'vs'
    AND string_agg(p.proconfig::text, '|' ORDER BY p.proname) = '{"search_path=\"\""}|{search_path=public}'
    AND string_agg(pg_get_function_result(p.oid), '|' ORDER BY p.proname) =
      'TABLE(image_id uuid, narrative text, intent text, intent_confidence numeric, scene_type text, build_phase text, place_hint text, confidence numeric, agent_model text, agent_notes text, analyzed_at timestamp with time zone, paint_state text, rust_severity text, completeness text, damage_callouts jsonb, components jsonb, open_questions jsonb, needs_review boolean)|jsonb'
    FROM pg_proc p WHERE p.oid IN ('public.get_image_deep_analysis(uuid)'::regprocedure, 'public.intake_live_state(integer,integer)'::regprocedure)),
  'after (applied twice): both stay SECURITY DEFINER, owned, executable by anon and authenticated, same volatility, search_path and result');

-- Anon.
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_analysis() = 'shown_a',
  'after: anon reads no analysis of an unfiled, private, deleted, ineligible, sensitive or plate-withheld photo');
SELECT t_assert(t_feed(30) = 'shown_a', 'after: anon feed is the shown photo only');
SELECT t_assert(t_feed(1) = 'shown_a', 'after: anon feed tests before LIMIT (limit 1 still finds the older shown photo)');
SELECT t_assert(t_fleet() = 'A', 'after: anon fleet is car A only');
SELECT t_assert(t_sessions() = '(hidden):A' AND t_session_text() = 0,
  'after: anon gets only the public car''s session, with title and summary null (work_sessions RLS gives anon no row)');
SELECT t_assert(jsonb_array_length(public.intake_live_state(-5, -5) -> 'feed') = 0
  AND jsonb_array_length(public.intake_live_state(-5, -5) -> 'sessions_today') = 0,
  'after: a negative limit clamps to 0 (the old body raised LIMIT must not be negative)');
SELECT t_assert(t_names() = 'A', 'after: no non-public or deleted vehicle is named anywhere in the reply to anon');
SELECT t_assert((public.intake_live_state(30, 30) ->> 'analyzed_last_30m')::int = 1, 'after: analyzed_last_30m stays a fleet-wide count');
RESET ROLE;

-- u1: owner of every car and uploader of most photos.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000001');
SELECT t_assert(t_analysis() = 'deleted_c,dup_a,photog_b,plate_a,private_b,sensitive_a,shown_a,unfiled_u1',
  'after: u1 (uploader, tied to A, B, C) reads all 8, its unfiled photo included');
SELECT t_assert(t_feed(30) = 'deleted_c,dup_a,photog_b,plate_a,private_b,sensitive_a,shown_a,unfiled_u1'
  AND t_fleet() = 'A,B,C' AND t_sessions() = 's_a:A,s_b:B,s_b3:B,s_c:C', 'after: u1 sees its whole feed, fleet and sessions');
RESET ROLE;

-- u2: a signed-in stranger reads only what anon reads.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000002');
SELECT t_assert(t_analysis() = 'shown_a' AND t_feed(30) = 'shown_a' AND t_fleet() = 'A' AND t_sessions() = '(hidden):A'
    AND t_session_text() = 0 AND t_names() = 'A',
  'after: u2 (stranger) reads what anon reads, no session text');
RESET ROLE;

-- u3: uploaded photog_b on the private car B and plate_a on A; authored s_b3 on B; not tied to either car.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000003');
SELECT t_assert(t_analysis() = 'photog_b,plate_a,shown_a', 'after: u3 (uploader) reads its own two photos and the shown one');
SELECT t_assert(t_feed(30) = 'photog_b,plate_a,shown_a' AND t_fleet() = 'A' AND t_sessions() = '(hidden):A,s_b3:-' AND t_names() = 'A',
  'after: u3 gets its photos and session on B without B being named');
RESET ROLE;

-- u4: mechanic contributor on A (vehicle_viewer_tied through vehicle_user_has_access).
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000004');
SELECT t_assert(t_analysis() = 'dup_a,plate_a,sensitive_a,shown_a', 'after: u4 (tied to A) reads every analysed photo of A, none of B or C');
RESET ROLE;

-- service_role keeps every row.
SET ROLE service_role; SELECT t_claims('service');
SELECT t_assert(t_analysis() = 'deleted_c,dup_a,photog_b,plate_a,private_b,sensitive_a,shown_a,unfiled_u1' AND t_fleet() = 'A,B,C',
  'after: service_role reads all 8 analyses and the whole fleet');
RESET ROLE;

-- The limits clamp at 100: 120 more shown frames on A, and anon asks for 100,000.
INSERT INTO public.vehicle_images (vehicle_id, user_id, image_url, vision_gate_status, ai_scan_metadata, last_rerun_at)
SELECT 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/c' || g || '.jpg', 'approved',
       '{"byok_deep_analysis":{"narrative_one_line":"clamp"}}', now() - interval '1 day' - g * interval '1 minute'
FROM generate_series(1, 120) g;
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(jsonb_array_length(public.intake_live_state(100000, 100000) -> 'feed') = 100,
  'after: p_feed_limit clamps to 100 (121 shown frames, asked for 100,000)');
RESET ROLE;

-- Revert restores both production bodies.
\ir revert_20261125160500_definer_readers_visibility.sql
SELECT t_assert(t_hash('public.get_image_deep_analysis(uuid)') = '3LWE/TnS8lwWQRuopztBD9HARireMredZGpW1BDMsd0='
  AND t_hash('public.intake_live_state(integer,integer)') = 'Sqe+TWsshVt5lgwtN0YjIebdzO6frcvmI5bjZwnBh5M=',
  'revert: both bodies are production''s again');
SELECT t_assert((SELECT count(*) FROM public.vehicle_images) = 128 AND (SELECT count(*) FROM public.work_sessions) = 4,
  'no row changed by the readers (8 seeded + 120 clamp frames)');
