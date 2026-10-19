-- Provider standing availability and service area (Signs), so open_requirements_read's availability and area inputs can
-- answer instead of "no standing availability is recorded yet" / "your public profile states no area".
--   set_provider_availability(p_windows {timezone, weekly [{dow 0-6 (0 = Sunday), start, end}], exceptions [{date, available,
--     start?, end?}]}) and set_provider_service_area(p_city, p_state, p_radius_miles, p_mobile): the signed-in user's
--     self-claims, recorded as user_observations (source nuke_sign, kind availability / service_area, owner visibility, the
--     previous Sign superseded) and projected to provider_availability / provider_service_area (one current row per user,
--     claim_basis self_claim). The area is a band: city, state, radius, mobile. A city-level geocode from city_geocode_lookup
--     is kept privately for the distance test; no street address or coordinates are ever returned.
--   open_requirement_availability_input(user, job window): pass when a declared weekly window or available exception falls
--     on a day inside the job window (scheduled_start/end, else the work request's needed_by, else the next 30 days);
--     date-level, self-claimed. open_requirement_area_input(user, job area): with a service area, pass when the job's public
--     city is within the radius of the provider's city (both geocoded), else same state (fallback), else fail; without one,
--     the previous public-profile state/city comparison.
--   open_requirements_read: area and availability inputs use the helpers (anchored edits; additive fields only).
--   provider_profile_read: availability summary and service_area band (open data, self-claims labelled).
-- Contract: supabase/sql/test_provider_availability_area.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

ALTER TYPE public.user_observation_kind ADD VALUE IF NOT EXISTS 'service_area';
ALTER TABLE public.user_observations DROP CONSTRAINT user_observations_source_check,
  ADD CONSTRAINT user_observations_source_check CHECK (source = ANY (ARRAY['qb_transactions','apple_cash','apple_mail','receipt_ocr','imessage',
    'photos_metadata','photo_pipeline_byok_deep_analysis','manual','nuke_sign'])) NOT VALID;
ALTER TABLE public.user_observations VALIDATE CONSTRAINT user_observations_source_check;

CREATE TABLE public.provider_availability (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  observation_id uuid NOT NULL UNIQUE REFERENCES public.user_observations(id),
  timezone text NOT NULL,
  weekly jsonb NOT NULL CHECK (jsonb_typeof(weekly) = 'array'),
  exceptions jsonb NOT NULL CHECK (jsonb_typeof(exceptions) = 'array'),
  claim_basis text NOT NULL DEFAULT 'self_claim' CHECK (claim_basis = 'self_claim'),
  declared_at timestamptz NOT NULL
);
CREATE TABLE public.provider_service_area (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  observation_id uuid NOT NULL UNIQUE REFERENCES public.user_observations(id),
  city text NOT NULL CHECK (length(city) BETWEEN 2 AND 60 AND city !~ '[0-9]'),
  state text NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  radius_miles integer NOT NULL CHECK (radius_miles BETWEEN 1 AND 500),
  mobile boolean NOT NULL,
  geocode_latitude numeric,
  geocode_longitude numeric,
  geocode_basis text CHECK (geocode_basis IN ('city_geocode_lookup')),
  claim_basis text NOT NULL DEFAULT 'self_claim' CHECK (claim_basis = 'self_claim'),
  declared_at timestamptz NOT NULL,
  CHECK ((geocode_latitude IS NULL) = (geocode_basis IS NULL) AND (geocode_longitude IS NULL) = (geocode_basis IS NULL))
);
ALTER TABLE public.provider_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_service_area ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_availability, public.provider_service_area FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.provider_availability, public.provider_service_area TO service_role;
COMMENT ON TABLE public.provider_availability IS 'Current standing availability Sign per user (set_provider_availability; self-claim). Projection of user_observations kind availability, source nuke_sign. Read through definer readers only.';
COMMENT ON TABLE public.provider_service_area IS 'Current service-area Sign per user (set_provider_service_area; self-claim): a city/state band with a radius. The city-level geocode is private (distance test only) and never returned.';

CREATE FUNCTION public.city_band_geocode(p_city text, p_state text, OUT latitude numeric, OUT longitude numeric)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT g.latitude, g.longitude FROM public.city_geocode_lookup g
  WHERE (g.city, g.state) IN ((btrim(p_city), upper(btrim(p_state))), (initcap(btrim(p_city)), upper(btrim(p_state))))
     OR (lower(g.city) = lower(btrim(p_city)) AND upper(g.state) = upper(btrim(p_state)))
  ORDER BY (g.city = btrim(p_city)) DESC, g.sample_size DESC NULLS LAST LIMIT 1
$$;

CREATE FUNCTION public.set_provider_availability(p_windows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  tz text;
  weekly jsonb;
  exc jsonb;
  norm jsonb;
  h text;
  cur public.provider_availability%ROWTYPE;
  obs_id uuid;
  signed timestamptz := statement_timestamp();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_windows) IS DISTINCT FROM 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_windows) k WHERE k NOT IN ('timezone','weekly','exceptions')) THEN
    RAISE EXCEPTION 'Availability is {timezone, weekly, exceptions}' USING ERRCODE = '22023';
  END IF;
  tz := p_windows->>'timezone';
  IF tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = tz) THEN
    RAISE EXCEPTION 'A known IANA timezone is required' USING ERRCODE = '22023';
  END IF;
  weekly := COALESCE(p_windows->'weekly', '[]'::jsonb);
  exc := COALESCE(p_windows->'exceptions', '[]'::jsonb);
  IF jsonb_typeof(weekly) <> 'array' OR jsonb_array_length(weekly) > 28 OR jsonb_typeof(exc) <> 'array' OR jsonb_array_length(exc) > 60 THEN
    RAISE EXCEPTION 'weekly: at most 28 windows; exceptions: at most 60 dates' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(weekly) w WHERE jsonb_typeof(w) <> 'object'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(w) k WHERE k NOT IN ('dow','start','end'))
      OR jsonb_typeof(w->'dow') IS DISTINCT FROM 'number' OR (w->>'dow') !~ '^[0-6]$'
      OR COALESCE(w->>'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR COALESCE(w->>'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$'
      OR w->>'start' >= w->>'end') THEN
    RAISE EXCEPTION 'Each weekly window is {dow 0-6 (0 = Sunday), start HH:MM, end HH:MM} with start before end' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(exc) x WHERE jsonb_typeof(x) <> 'object'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('date','available','start','end'))
      OR COALESCE(x->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' OR jsonb_typeof(x->'available') IS DISTINCT FROM 'boolean'
      OR (x ? 'start') <> (x ? 'end')
      OR (x ? 'start' AND (COALESCE(x->>'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR COALESCE(x->>'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$'
        OR x->>'start' >= x->>'end'))) THEN
    RAISE EXCEPTION 'Each exception is {date YYYY-MM-DD, available boolean, optional start and end HH:MM}' USING ERRCODE = '22023';
  END IF;
  PERFORM (x->>'date')::date FROM jsonb_array_elements(exc) x;
  IF (SELECT count(*) <> count(DISTINCT x->>'date') FROM jsonb_array_elements(exc) x) THEN
    RAISE EXCEPTION 'One exception per date' USING ERRCODE = '22023';
  END IF;
  norm := jsonb_build_object('timezone', tz,
    'weekly', COALESCE((SELECT jsonb_agg(jsonb_build_object('dow', (w->>'dow')::int, 'start', w->>'start', 'end', w->>'end')
      ORDER BY (w->>'dow')::int, w->>'start', w->>'end') FROM jsonb_array_elements(weekly) w), '[]'::jsonb),
    'exceptions', COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('date', x->>'date', 'available', (x->>'available')::boolean,
      'start', x->>'start', 'end', x->>'end')) ORDER BY x->>'date') FROM jsonb_array_elements(exc) x), '[]'::jsonb));
  h := md5(norm::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('provider_availability:' || uid::text, 0));
  SELECT * INTO cur FROM public.provider_availability WHERE user_id = uid;
  IF FOUND AND (SELECT o.content_hash FROM public.user_observations o WHERE o.id = cur.observation_id) = h THEN
    RETURN jsonb_build_object('observation_id', cur.observation_id, 'availability', norm, 'claim_basis', 'self_claim', 'duplicate', true);
  END IF;
  INSERT INTO public.user_observations(user_id, kind, observed_at, source, source_identifier, method, trust, content_text, content_hash,
    structured_data, visibility)
  VALUES (uid, 'availability', signed, 'nuke_sign', 'provider_availability:' || uid::text, 'provider_availability_sign_v1', 'T3',
    'Provider stated standing availability (self-claim).', h,
    jsonb_build_object('provider_sign', jsonb_build_object('version', 1, 'type', 'availability', 'claim_basis', 'self_claim', 'windows', norm)),
    ARRAY['owner'])
  RETURNING id INTO obs_id;
  IF cur.observation_id IS NOT NULL THEN
    UPDATE public.user_observations SET is_superseded = true, superseded_by = obs_id, superseded_at = signed WHERE id = cur.observation_id;
  END IF;
  INSERT INTO public.provider_availability(user_id, observation_id, timezone, weekly, exceptions, declared_at)
  VALUES (uid, obs_id, tz, norm->'weekly', norm->'exceptions', signed)
  ON CONFLICT (user_id) DO UPDATE SET observation_id = EXCLUDED.observation_id, timezone = EXCLUDED.timezone, weekly = EXCLUDED.weekly,
    exceptions = EXCLUDED.exceptions, declared_at = EXCLUDED.declared_at;
  RETURN jsonb_build_object('observation_id', obs_id, 'availability', norm, 'claim_basis', 'self_claim', 'duplicate', false,
    'supersedes_observation_id', cur.observation_id);
END $$;

CREATE FUNCTION public.set_provider_service_area(p_city text, p_state text, p_radius_miles integer, p_mobile boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  c text := regexp_replace(btrim(COALESCE(p_city, '')), '\s+', ' ', 'g');
  s text := upper(btrim(COALESCE(p_state, '')));
  g record;
  norm jsonb;
  h text;
  cur public.provider_service_area%ROWTYPE;
  obs_id uuid;
  signed timestamptz := statement_timestamp();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  IF length(c) NOT BETWEEN 2 AND 60 OR c ~ '[0-9@,;]' THEN
    RAISE EXCEPTION 'A city name only (no street address, numbers or contact details)' USING ERRCODE = '22023';
  END IF;
  IF s !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'A two-letter state code is required' USING ERRCODE = '22023'; END IF;
  IF p_radius_miles IS NULL OR p_radius_miles NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Radius is 1 to 500 miles' USING ERRCODE = '22023'; END IF;
  IF p_mobile IS NULL THEN RAISE EXCEPTION 'State whether you travel to the vehicle (mobile)' USING ERRCODE = '22023'; END IF;
  SELECT * INTO g FROM public.city_band_geocode(c, s);
  norm := jsonb_build_object('city', c, 'state', s, 'radius_miles', p_radius_miles, 'mobile', p_mobile);
  h := md5(norm::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('provider_service_area:' || uid::text, 0));
  SELECT * INTO cur FROM public.provider_service_area WHERE user_id = uid;
  IF FOUND AND (SELECT o.content_hash FROM public.user_observations o WHERE o.id = cur.observation_id) = h THEN
    RETURN jsonb_build_object('observation_id', cur.observation_id, 'service_area', norm || jsonb_build_object('geocoded', cur.geocode_basis IS NOT NULL),
      'claim_basis', 'self_claim', 'duplicate', true);
  END IF;
  INSERT INTO public.user_observations(user_id, kind, observed_at, source, source_identifier, method, trust, content_text, content_hash,
    structured_data, visibility)
  VALUES (uid, 'service_area', signed, 'nuke_sign', 'provider_service_area:' || uid::text, 'provider_service_area_sign_v1', 'T3',
    'Provider stated a service area (self-claim).', h,
    jsonb_build_object('provider_sign', jsonb_build_object('version', 1, 'type', 'service_area', 'claim_basis', 'self_claim', 'band', norm)),
    ARRAY['owner'])
  RETURNING id INTO obs_id;
  IF cur.observation_id IS NOT NULL THEN
    UPDATE public.user_observations SET is_superseded = true, superseded_by = obs_id, superseded_at = signed WHERE id = cur.observation_id;
  END IF;
  INSERT INTO public.provider_service_area(user_id, observation_id, city, state, radius_miles, mobile, geocode_latitude, geocode_longitude,
    geocode_basis, declared_at)
  VALUES (uid, obs_id, c, s, p_radius_miles, p_mobile, g.latitude, g.longitude, CASE WHEN g.latitude IS NOT NULL THEN 'city_geocode_lookup' END, signed)
  ON CONFLICT (user_id) DO UPDATE SET observation_id = EXCLUDED.observation_id, city = EXCLUDED.city, state = EXCLUDED.state,
    radius_miles = EXCLUDED.radius_miles, mobile = EXCLUDED.mobile, geocode_latitude = EXCLUDED.geocode_latitude,
    geocode_longitude = EXCLUDED.geocode_longitude, geocode_basis = EXCLUDED.geocode_basis, declared_at = EXCLUDED.declared_at;
  RETURN jsonb_build_object('observation_id', obs_id, 'service_area', norm || jsonb_build_object('geocoded', g.latitude IS NOT NULL),
    'claim_basis', 'self_claim', 'duplicate', false, 'supersedes_observation_id', cur.observation_id);
END $$;

CREATE FUNCTION public.work_order_job_window(p_work_order_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN w.scheduled_start IS NOT NULL OR w.scheduled_end IS NOT NULL
      THEN jsonb_build_object('from', w.scheduled_start, 'until', w.scheduled_end, 'basis', 'scheduled')
    WHEN (o.structured_data#>>'{work_request,needed_by}') IS NOT NULL
      THEN jsonb_build_object('from', NULL, 'until', (o.structured_data#>>'{work_request,needed_by}')::timestamptz, 'basis', 'needed_by')
    ELSE jsonb_build_object('from', NULL, 'until', NULL, 'basis', 'not_stated') END
  FROM public.work_orders w LEFT JOIN public.vehicle_observations o ON o.id = w.request_observation_id AND o.is_superseded IS FALSE
  WHERE w.id = p_work_order_id
$$;

CREATE FUNCTION public.open_requirement_availability_input(p_user uuid, p_window jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  pa public.provider_availability%ROWTYPE;
  t_from timestamptz;
  t_until timestamptz;
  d_from date;
  d_until date;
  first_day date;
  win jsonb;
BEGIN
  SELECT * INTO pa FROM public.provider_availability WHERE user_id = p_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('input', 'availability', 'result', 'unknown', 'reason', 'no standing availability is recorded yet',
      'next', 'set_provider_availability');
  END IF;
  t_from := GREATEST(statement_timestamp(), COALESCE((p_window->>'from')::timestamptz, statement_timestamp()));
  t_until := COALESCE((p_window->>'until')::timestamptz, t_from + interval '30 days');
  win := jsonb_build_object('from', t_from, 'until', t_until,
    'basis', CASE WHEN p_window->>'until' IS NULL THEN COALESCE(p_window->>'basis', 'not_stated') || '; next 30 days' ELSE p_window->>'basis' END);
  IF t_until < t_from THEN
    RETURN jsonb_build_object('input', 'availability', 'result', 'unknown', 'reason', 'the job window has passed', 'job_window', win,
      'basis', 'self_claim');
  END IF;
  d_from := (t_from AT TIME ZONE pa.timezone)::date;
  d_until := LEAST((t_until AT TIME ZONE pa.timezone)::date, d_from + 90);
  SELECT d::date INTO first_day FROM generate_series(d_from, d_until, interval '1 day') d
  WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(pa.exceptions) x WHERE (x->>'date')::date = d::date AND (x->>'available')::boolean)
     OR (NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pa.exceptions) x WHERE (x->>'date')::date = d::date AND NOT (x->>'available')::boolean)
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(pa.weekly) w WHERE (w->>'dow')::int = extract(dow FROM d)::int))
  ORDER BY d LIMIT 1;
  IF first_day IS NOT NULL THEN
    RETURN jsonb_build_object('input', 'availability', 'result', 'pass', 'basis', 'self_claim', 'job_window', win,
      'first_available_day', first_day, 'reason', 'standing availability (self-claimed) falls inside the job window');
  END IF;
  RETURN jsonb_build_object('input', 'availability', 'result', 'fail', 'basis', 'self_claim', 'job_window', win,
    'reason', 'no declared availability inside the job window');
END $$;

CREATE FUNCTION public.open_requirement_area_input(p_user uuid, p_area jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  sa public.provider_service_area%ROWTYPE;
  pc text;
  ps text;
  vg record;
  miles numeric;
  band jsonb;
BEGIN
  SELECT * INTO sa FROM public.provider_service_area WHERE user_id = p_user;
  IF NOT FOUND THEN
    SELECT CASE WHEN p.is_public IS TRUE THEN NULLIF(btrim(p.city), '') END, CASE WHEN p.is_public IS TRUE THEN NULLIF(btrim(p.state), '') END
      INTO pc, ps FROM public.profiles p WHERE p.id = p_user;
    IF p_area IS NULL OR ps IS NULL THEN
      RETURN jsonb_build_object('input', 'area', 'result', 'unknown', 'reason', CASE WHEN p_area IS NULL THEN 'job area not public' ELSE 'your public profile states no area' END,
        'next', CASE WHEN p_area IS NOT NULL THEN 'set_provider_service_area' END);
    ELSIF lower(ps) = lower(COALESCE(p_area->>'state', '')) THEN
      RETURN jsonb_build_object('input', 'area', 'result', 'pass', 'basis', 'public_profile_state', 'reason', 'same state'
        || CASE WHEN pc IS NOT NULL AND lower(pc) = lower(COALESCE(p_area->>'city', '')) THEN ' and city' ELSE '' END);
    END IF;
    RETURN jsonb_build_object('input', 'area', 'result', 'fail', 'basis', 'public_profile_state', 'reason', 'different state (travel or remote work not assessed)');
  END IF;
  band := jsonb_build_object('city', sa.city, 'state', sa.state, 'radius_miles', sa.radius_miles, 'mobile', sa.mobile, 'claim_basis', 'self_claim');
  IF p_area IS NULL THEN
    RETURN jsonb_build_object('input', 'area', 'result', 'unknown', 'reason', 'job area not public', 'service_area', band);
  END IF;
  IF sa.geocode_latitude IS NOT NULL AND NULLIF(btrim(p_area->>'city'), '') IS NOT NULL AND NULLIF(btrim(p_area->>'state'), '') IS NOT NULL THEN
    SELECT * INTO vg FROM public.city_band_geocode(p_area->>'city', p_area->>'state');
    IF vg.latitude IS NOT NULL THEN
      miles := 3958.8 * 2 * asin(sqrt(power(sin(radians(vg.latitude - sa.geocode_latitude) / 2), 2)
        + cos(radians(sa.geocode_latitude)) * cos(radians(vg.latitude)) * power(sin(radians(vg.longitude - sa.geocode_longitude) / 2), 2)));
      RETURN jsonb_build_object('input', 'area', 'result', CASE WHEN miles <= sa.radius_miles THEN 'pass' ELSE 'fail' END,
        'basis', 'service_area_city_distance', 'service_area', band,
        'reason', CASE WHEN miles <= sa.radius_miles THEN 'job city is within your ' || sa.radius_miles || '-mile service area'
          ELSE 'job city is outside your ' || sa.radius_miles || '-mile service area' END
          || ' (city-level; self-claimed band)');
    END IF;
  END IF;
  RETURN jsonb_build_object('input', 'area', 'basis', 'service_area_same_state_fallback', 'service_area', band,
    'result', CASE WHEN upper(sa.state) = upper(COALESCE(p_area->>'state', '')) THEN 'pass' WHEN NULLIF(btrim(p_area->>'state'), '') IS NULL THEN 'unknown' ELSE 'fail' END,
    'reason', CASE WHEN upper(sa.state) = upper(COALESCE(p_area->>'state', '')) THEN 'same state as your service area (distance not computed)'
      WHEN NULLIF(btrim(p_area->>'state'), '') IS NULL THEN 'job state not public'
      ELSE 'different state from your service area' END);
END $$;

CREATE FUNCTION public.provider_availability_summary(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
  SELECT CASE WHEN p_user IS NULL THEN jsonb_build_object('state', 'not_assessed', 'basis', 'a work actor has no account Signs')
    ELSE COALESCE((SELECT jsonb_build_object('state', 'declared', 'claim_basis', 'self_claim', 'declared_at', pa.declared_at, 'timezone', pa.timezone,
        'weekly', COALESCE((SELECT jsonb_agg(w || jsonb_build_object('day', (ARRAY['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[(w->>'dow')::int + 1]))
          FROM jsonb_array_elements(pa.weekly) w), '[]'::jsonb),
        'exceptions_upcoming', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'date') FROM (SELECT x FROM jsonb_array_elements(pa.exceptions) x
          WHERE (x->>'date')::date >= (statement_timestamp() AT TIME ZONE pa.timezone)::date ORDER BY x->>'date' LIMIT 10) y), '[]'::jsonb),
        'basis', 'standing weekly windows and date exceptions stated by the account (set_provider_availability)')
      FROM public.provider_availability pa WHERE pa.user_id = p_user),
      jsonb_build_object('state', 'not_declared', 'basis', 'no set_provider_availability Sign')) END
$$;

CREATE FUNCTION public.provider_service_area_band(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_user IS NULL THEN jsonb_build_object('state', 'not_assessed', 'basis', 'a work actor has no account Signs')
    ELSE COALESCE((SELECT jsonb_build_object('state', 'declared', 'claim_basis', 'self_claim', 'declared_at', sa.declared_at,
        'city', sa.city, 'state_code', sa.state, 'radius_miles', sa.radius_miles, 'mobile', sa.mobile, 'geocoded', sa.geocode_basis IS NOT NULL,
        'place_basis', 'city-level band stated by the account; no street address or coordinates')
      FROM public.provider_service_area sa WHERE sa.user_id = p_user),
      jsonb_build_object('state', 'not_declared', 'basis', 'no set_provider_service_area Sign')) END
$$;

REVOKE ALL ON FUNCTION public.city_band_geocode(text,text), public.work_order_job_window(uuid), public.open_requirement_availability_input(uuid,jsonb),
  public.open_requirement_area_input(uuid,jsonb), public.provider_availability_summary(uuid), public.provider_service_area_band(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.city_band_geocode(text,text), public.work_order_job_window(uuid), public.open_requirement_availability_input(uuid,jsonb),
  public.open_requirement_area_input(uuid,jsonb), public.provider_availability_summary(uuid), public.provider_service_area_band(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.set_provider_availability(jsonb), public.set_provider_service_area(text,text,integer,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_provider_availability(jsonb), public.set_provider_service_area(text,text,integer,boolean) TO authenticated, service_role;
COMMENT ON FUNCTION public.set_provider_availability(jsonb) IS 'Sign: the signed-in user states standing availability {timezone, weekly [{dow 0-6, start, end}], exceptions [{date, available, start?, end?}]} (self-claim). Recorded as a user_observation and projected to provider_availability; the previous Sign is superseded; identical replay is a duplicate.';
COMMENT ON FUNCTION public.set_provider_service_area(text,text,integer,boolean) IS 'Sign: the signed-in user states a service area band (city, state, radius miles, mobile; self-claim). Recorded as a user_observation and projected to provider_service_area with a private city-level geocode when city_geocode_lookup knows the city.';

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.open_requirements_read(uuid,integer,text)'::regprocedure);
  a1 constant text := $a$        CASE WHEN b.area IS NULL OR v_state IS NULL THEN
            jsonb_build_object('input', 'area', 'result', 'unknown', 'reason', CASE WHEN b.area IS NULL THEN 'job area not public' ELSE 'your public profile states no area' END)
          WHEN lower(v_state) = lower(COALESCE(b.area->>'state', '')) THEN
            jsonb_build_object('input', 'area', 'result', 'pass', 'reason', 'same state'
              || CASE WHEN v_city IS NOT NULL AND lower(v_city) = lower(COALESCE(b.area->>'city', '')) THEN ' and city' ELSE '' END)
          ELSE jsonb_build_object('input', 'area', 'result', 'fail', 'reason', 'different state (travel or remote work not assessed)') END,$a$;
  a2 constant text := $a$        jsonb_build_object('input', 'availability', 'result', 'unknown', 'reason', 'no standing availability is recorded yet'),$a$;
  a3 constant text := $a$'not_assessed', jsonb_build_array('candidate acceptance', 'distance', 'standing availability', 'price')$a$;
  pdef text := pg_get_functiondef('public.provider_profile_read(uuid,uuid)'::regprocedure);
  p1 constant text := $a$'work_record', jsonb_build_object('days', sessions, 'jobs', jobs),$a$;
BEGIN
  IF position('open_requirement_area_input' IN def) > 0 THEN RAISE EXCEPTION 'open_requirements_read already uses the area helper'; END IF;
  IF (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'area input anchor not found once'; END IF;
  IF (length(def) - length(replace(def, a2, ''))) / length(a2) <> 1 THEN RAISE EXCEPTION 'availability input anchor not found once'; END IF;
  IF (length(def) - length(replace(def, a3, ''))) / length(a3) <> 1 THEN RAISE EXCEPTION 'not_assessed anchor not found once'; END IF;
  def := replace(def, a1, $r$        public.open_requirement_area_input(uid, b.area),$r$);
  def := replace(def, a2, $r$        public.open_requirement_availability_input(uid, public.work_order_job_window(b.work_order_id)),$r$);
  def := replace(def, a3, $r$'not_assessed', jsonb_build_array('candidate acceptance', 'distance beyond city-level service areas', 'availability beyond self-claimed standing windows', 'price')$r$);
  EXECUTE def;
  IF position('provider_availability_summary' IN pdef) > 0 THEN RAISE EXCEPTION 'provider_profile_read already shows availability'; END IF;
  IF (length(pdef) - length(replace(pdef, p1, ''))) / length(p1) <> 1 THEN RAISE EXCEPTION 'provider_profile_read work_record anchor not found once'; END IF;
  EXECUTE replace(pdef, p1, $r$'availability', public.provider_availability_summary(p_user_id), 'service_area', public.provider_service_area_band(p_user_id),
    $r$ || p1);
END $apply$;
NOTIFY pgrst, 'reload schema';
COMMIT;
