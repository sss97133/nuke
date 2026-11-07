-- library_inventory: one row per (user, device-library asset). Metadata only, no bytes.
--
-- Why: on 2026-11-07 the server held 29,749 owner image rows against a ~80,000-photo camera roll, and
-- nothing could say which assets were never offered (docs: library-coverage audit). The app scanned one
-- day back on first run and kept a persisted backfill queue only for assets handed over after site
-- confirmation. This table is the durable per-origin denominator the upload drain works from.
--
-- What it is not: it does not upload anything, classify anything or decide privacy. The drain still runs
-- every asset through the app's on-device gates (site gate, Apple-camera check, contributor firewall,
-- owner triage) before any byte leaves the phone. drain_state records what those gates concluded.
--
-- Privacy: location is stored coarsened to 2 decimals (~1.1 km) plus the on-device gate verdict; exact
-- coordinates of off-site photos never leave the phone, matching Config.swift's shop-gate rule.
-- Existing privacy-hold rows in vehicle_images are not read, changed or released here.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.library_inventory (
  user_id            uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  asset_local_id     text        NOT NULL,            -- PHAsset.localIdentifier
  -- what the device said about the asset (testimony; refreshed, never invented)
  creation_date      timestamptz,
  media_type         text        NOT NULL DEFAULT 'image',
  media_subtypes     integer     NOT NULL DEFAULT 0,  -- PHAssetMediaSubtype bitmask as reported
  source_type        text,                            -- user_library | cloud_shared | itunes_synced
  is_screenshot      boolean     NOT NULL DEFAULT false,
  pixel_width        integer,
  pixel_height       integer,
  has_location       boolean     NOT NULL DEFAULT false,
  loc_lat_coarse     numeric(6,2),
  loc_lon_coarse     numeric(7,2),
  gate_verdict       text        NOT NULL DEFAULT 'unknown'
                     CHECK (gate_verdict IN ('at_site','off_site','no_location','screenshot','not_library','unknown')),
  content_sha256     text,                            -- only when already known; never forces a read
  -- origin
  origin_source      text        NOT NULL DEFAULT 'ios_photokit',
  origin_device_id   text,
  origin_scope       text        NOT NULL DEFAULT 'full' CHECK (origin_scope IN ('full','limited')),
  inventory_run_id   uuid,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  -- drain
  drain_state        text        NOT NULL DEFAULT 'pending'
                     CHECK (drain_state IN ('pending','uploaded','already_on_server','held_private',
                                            'off_site','not_own_camera','deduped','gave_up')),
  drain_attempts     integer     NOT NULL DEFAULT 0,
  drain_reason       text,
  drained_at         timestamptz,
  PRIMARY KEY (user_id, asset_local_id)
);

COMMENT ON TABLE public.library_inventory IS
  'Per-user inventory of every accessible device-library asset (metadata only), written by the capture app; the upload drain pulls pending rows through library_inventory_next_batch. Not testimony of content: gate_verdict and drain_state are the app''s own on-device conclusions.';
COMMENT ON COLUMN public.library_inventory.loc_lat_coarse IS 'Latitude rounded to 2 decimals (~1.1 km). Exact coordinates stay on the phone.';
COMMENT ON COLUMN public.library_inventory.drain_state IS 'pending until the app''s per-asset path concludes; terminal states are the app''s outcome names (held_private rows are never re-queued).';
COMMENT ON COLUMN public.library_inventory.origin_scope IS 'Photos authorization when enumerated: limited means the inventory is a subset of the camera roll.';

ALTER TABLE public.library_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS library_inventory_owner_select ON public.library_inventory;
CREATE POLICY library_inventory_owner_select ON public.library_inventory
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- Writes go through the SECURITY INVOKER functions below; RLS still scopes them to the caller.
DROP POLICY IF EXISTS library_inventory_owner_insert ON public.library_inventory;
CREATE POLICY library_inventory_owner_insert ON public.library_inventory
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS library_inventory_owner_update ON public.library_inventory;
CREATE POLICY library_inventory_owner_update ON public.library_inventory
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.library_inventory FROM anon, public;
GRANT SELECT, INSERT, UPDATE ON public.library_inventory TO authenticated;
GRANT ALL ON public.library_inventory TO service_role;

-- The drain asks for pending, gate-eligible rows: fewest attempts first, then oldest photo first.
CREATE INDEX IF NOT EXISTS library_inventory_drain_idx
  ON public.library_inventory (user_id, drain_attempts, creation_date, asset_local_id)
  WHERE drain_state = 'pending' AND gate_verdict = 'at_site';
CREATE INDEX IF NOT EXISTS library_inventory_state_idx
  ON public.library_inventory (user_id, drain_state);

-- Upsert a page of enumerated assets. Refreshes device-reported facts and last_seen_at; leaves
-- drain_state, attempts and first_seen_at alone. gate_verdict is refreshed only while still pending, so
-- a later site confirmation re-opens off-site rows without touching settled ones.
CREATE OR REPLACE FUNCTION public.library_inventory_upsert(p_rows jsonb, p_run_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'p_rows must be an array of at most 500 rows';
  END IF;
  INSERT INTO public.library_inventory AS li (
    user_id, asset_local_id, creation_date, media_type, media_subtypes, source_type, is_screenshot,
    pixel_width, pixel_height, has_location, loc_lat_coarse, loc_lon_coarse, gate_verdict,
    content_sha256, origin_device_id, origin_scope, inventory_run_id)
  SELECT auth.uid(), r.asset_local_id, r.creation_date, COALESCE(r.media_type,'image'),
         COALESCE(r.media_subtypes,0), r.source_type, COALESCE(r.is_screenshot,false),
         r.pixel_width, r.pixel_height, COALESCE(r.has_location,false),
         round(r.loc_lat_coarse::numeric,2), round(r.loc_lon_coarse::numeric,2),
         COALESCE(r.gate_verdict,'unknown'), r.content_sha256, r.origin_device_id,
         COALESCE(r.origin_scope,'full'), p_run_id
  FROM jsonb_to_recordset(p_rows) AS r(
    asset_local_id text, creation_date timestamptz, media_type text, media_subtypes integer,
    source_type text, is_screenshot boolean, pixel_width integer, pixel_height integer,
    has_location boolean, loc_lat_coarse numeric, loc_lon_coarse numeric, gate_verdict text,
    content_sha256 text, origin_device_id text, origin_scope text)
  WHERE r.asset_local_id IS NOT NULL AND r.asset_local_id <> ''
  ON CONFLICT (user_id, asset_local_id) DO UPDATE SET
    creation_date    = EXCLUDED.creation_date,
    media_subtypes   = EXCLUDED.media_subtypes,
    source_type      = EXCLUDED.source_type,
    is_screenshot    = EXCLUDED.is_screenshot,
    pixel_width      = EXCLUDED.pixel_width,
    pixel_height     = EXCLUDED.pixel_height,
    has_location     = EXCLUDED.has_location,
    loc_lat_coarse   = EXCLUDED.loc_lat_coarse,
    loc_lon_coarse   = EXCLUDED.loc_lon_coarse,
    gate_verdict     = CASE WHEN li.drain_state = 'pending' THEN EXCLUDED.gate_verdict ELSE li.gate_verdict END,
    content_sha256   = COALESCE(EXCLUDED.content_sha256, li.content_sha256),
    origin_device_id = EXCLUDED.origin_device_id,
    origin_scope     = EXCLUDED.origin_scope,
    inventory_run_id = EXCLUDED.inventory_run_id,
    last_seen_at     = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- The next page of work for the drain: pending, gate-eligible, fewest attempts first.
CREATE OR REPLACE FUNCTION public.library_inventory_next_batch(p_limit integer DEFAULT 50, p_max_attempts integer DEFAULT 3)
RETURNS TABLE (asset_local_id text)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT li.asset_local_id FROM public.library_inventory li
  WHERE li.user_id = auth.uid() AND li.drain_state = 'pending' AND li.gate_verdict = 'at_site'
    AND li.drain_attempts < p_max_attempts
  ORDER BY li.drain_attempts, li.creation_date NULLS LAST, li.asset_local_id
  LIMIT LEAST(GREATEST(p_limit,1), 500);
$$;

-- Record the app's per-asset outcomes: [{asset_local_id, state, reason?}]. 'retry' bumps attempts and
-- leaves the row pending; every other state is terminal. Terminal rows are never moved back by this call.
CREATE OR REPLACE FUNCTION public.library_inventory_record_outcomes(p_outcomes jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  IF jsonb_typeof(p_outcomes) <> 'array' OR jsonb_array_length(p_outcomes) > 500 THEN
    RAISE EXCEPTION 'p_outcomes must be an array of at most 500 rows';
  END IF;
  UPDATE public.library_inventory li SET
    drain_state    = CASE WHEN o.state = 'retry' THEN 'pending' ELSE o.state END,
    drain_attempts = li.drain_attempts + CASE WHEN o.state = 'retry' THEN 1 ELSE 0 END,
    drain_reason   = o.reason,
    drained_at     = CASE WHEN o.state = 'retry' THEN li.drained_at ELSE now() END
  FROM jsonb_to_recordset(p_outcomes) AS o(asset_local_id text, state text, reason text)
  WHERE li.user_id = auth.uid() AND li.asset_local_id = o.asset_local_id
    AND li.drain_state = 'pending'
    AND o.state IN ('retry','uploaded','already_on_server','held_private','off_site','not_own_camera','deduped','gave_up');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Rows whose asset already has a vehicle_images row (the app stamps exif_data.uuid = localIdentifier) are
-- settled without reading a byte. Read-only on vehicle_images; privacy-held rows count as "on server".
CREATE OR REPLACE FUNCTION public.library_inventory_mark_already_on_server()
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '25s'
AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  UPDATE public.library_inventory li SET
    drain_state = 'already_on_server', drain_reason = 'vehicle_images.exif_data.uuid', drained_at = now()
  WHERE li.user_id = auth.uid() AND li.drain_state = 'pending'
    AND EXISTS (SELECT 1 FROM public.vehicle_images vi
                WHERE vi.user_id = li.user_id AND vi.exif_data ->> 'uuid' = li.asset_local_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Progress for the owner: the denominator beside every state.
CREATE OR REPLACE VIEW public.library_inventory_progress WITH (security_invoker = true) AS
SELECT user_id, drain_state, gate_verdict, origin_scope, count(*) AS assets,
       min(creation_date) AS oldest_asset, max(last_seen_at) AS last_seen_at
FROM public.library_inventory GROUP BY user_id, drain_state, gate_verdict, origin_scope;

GRANT SELECT ON public.library_inventory_progress TO authenticated;
REVOKE ALL ON FUNCTION public.library_inventory_upsert(jsonb, uuid), public.library_inventory_next_batch(integer, integer),
  public.library_inventory_record_outcomes(jsonb), public.library_inventory_mark_already_on_server() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.library_inventory_upsert(jsonb, uuid), public.library_inventory_next_batch(integer, integer),
  public.library_inventory_record_outcomes(jsonb), public.library_inventory_mark_already_on_server() TO authenticated, service_role;
