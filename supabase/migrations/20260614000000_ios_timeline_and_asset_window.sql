-- iOS UI pass — two RPCs backing the BarcodeTimeline fix (#3) and the
-- VehicleDetailView ASSET window (#1). Drift-repair capture of SQL applied to
-- prod 2026-06-14.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- #3 ROOT CAUSE (measured, not guessed):
--   get_user_contribution_days RETURNS TABLE(day,kind,n) — a SETOF. PostgREST
--   silently caps SETOF/row responses at db-max-rows = 1000. For user
--   0b9f107a (Skylar) the function emits 2,666 (day,kind) rows across 1,511
--   distinct days; the wire response is truncated to the most-recent 1000 rows
--   (prod was patched to ORDER BY ... DESC so at least RECENT days survive —
--   the repo migration still says ASC; this is the drift). Net effect in the
--   app: BarcodeTimeline.buildWeekCols takes earliest(day)→today, but
--   "earliest" is the truncation boundary (2024-01-06), NOT Skylar's real
--   first day. ~980 real work-days older than the cap are silently dropped, so
--   the barcode starts at an arbitrary wall and the maker's full arc never
--   shows. This is the SAME db-max-rows class of bug the web profile already
--   hit (the per-day GROUP BY replaced three 1000-capped wide selects, but the
--   GROUP BY result itself re-breaches 1000 once distinct-days × kinds > 1000).
--
--   FIX: return ONE jsonb scalar (an array under a wrapper). A scalar/jsonb
--   return is NOT subject to db-max-rows row capping (same trick
--   get_user_day_receipt / get_user_sync_status already use), so the FULL day
--   set crosses the wire in one row. Pre-pivoted to one object per day
--   (photos/events/work) so the client never re-aggregates and the payload is
--   ~1,511 small objects, not 2,666 (day,kind) rows.
--
--   day = COALESCE(taken_at, created_at)::date — capture time, not upload time
--   (taken_at-based, matching the web fix and tenet 3 "motion is a derivative
--   of REAL work days"). day >= 2000-01-01 floors bogus-EXIF camera-reset
--   dates (1970/1980) exactly as the original RPC did.

CREATE OR REPLACE FUNCTION public.get_user_contribution_calendar(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH per_day AS (
    -- Photos: capture time when EXIF has it, upload time otherwise.
    SELECT COALESCE(vi.taken_at, vi.created_at)::date AS day,
           'photo'::text AS kind, count(*)::int AS n
    FROM public.vehicle_images vi
    WHERE vi.user_id = p_user_id
      AND COALESCE(vi.taken_at, vi.created_at)::date >= DATE '2000-01-01'
    GROUP BY 1

    UNION ALL

    SELECT vte.event_date AS day, 'event'::text AS kind, count(*)::int AS n
    FROM public.vehicle_timeline_events vte
    WHERE vte.user_id = p_user_id
      AND vte.event_date >= DATE '2000-01-01'
    GROUP BY 1

    UNION ALL

    SELECT ws.session_date AS day, 'work'::text AS kind, count(*)::int AS n
    FROM public.work_sessions ws
    WHERE ws.user_id = p_user_id
      AND ws.session_date >= DATE '2000-01-01'
    GROUP BY 1
  ),
  pivoted AS (
    SELECT day,
           COALESCE(sum(n) FILTER (WHERE kind = 'photo'), 0)::int AS photos,
           COALESCE(sum(n) FILTER (WHERE kind = 'event'), 0)::int AS events,
           COALESCE(sum(n) FILTER (WHERE kind = 'work'),  0)::int AS work
    FROM per_day
    GROUP BY day
  )
  -- One scalar jsonb array — bypasses db-max-rows. Ascending by day so the
  -- client's earliest()→today span is the REAL first day, not a cap artifact.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'),
                         'photos', photos, 'events', events, 'work', work)
      ORDER BY day ASC
    ),
    '[]'::jsonb
  )
  FROM pivoted;
$$;

COMMENT ON FUNCTION public.get_user_contribution_calendar(uuid) IS
  'Per-day contribution calendar (photos/events/work) as a single jsonb array, '
  'bypassing the db-max-rows 1000-row cap that truncated get_user_contribution_days '
  'for heavy users. taken_at-based; day >= 2000-01-01 floors bogus EXIF.';

-- ─────────────────────────────────────────────────────────────────────────────
-- #1 — the ASSET window for VehicleDetailView. Skylar's REAL relationship to a
-- vehicle: is it his, what role, is the title verified, since when. Mirrors the
-- exact tables the web reads (NOT a parallel data layer):
--   • vehicle_user_permissions(role, is_active, granted_at) — the relationship
--     + "since when". role ∈ owner|co_owner|contributor|… (active grants only)
--   • ownership_verifications(status, verification_type, approved_at) — the
--     title-verified rung. 'approved' + type/category 'title' = title-verified.
--
-- HONESTY LAW (tenet 5 / C0): this returns the relationship ONLY when an ACTIVE
-- permission row exists for (caller, vehicle). No row → null → the app shows
-- nothing (it does NOT claim ownership of a vehicle that isn't the viewer's,
-- e.g. the sold K2500). The verified flag is true ONLY on an 'approved' title
-- verification — an 'expired'/'pending'/'rejected' row never reads as verified.
-- Anon callers (auth.uid() IS NULL) get null — the asset window is a personal
-- relationship, not a public claim.

CREATE OR REPLACE FUNCTION public.get_user_vehicle_relationship(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  perm AS (
    SELECT p.role, p.granted_at
    FROM public.vehicle_user_permissions p, me
    WHERE me.uid IS NOT NULL
      AND p.vehicle_id = p_vehicle_id
      AND p.user_id = me.uid
      AND COALESCE(p.is_active, true) = true
      AND p.revoked_at IS NULL
    ORDER BY (p.role = 'owner') DESC, p.granted_at ASC NULLS LAST
    LIMIT 1
  ),
  ver AS (
    SELECT v.status, v.approved_at
    FROM public.ownership_verifications v, me
    WHERE me.uid IS NOT NULL
      AND v.vehicle_id = p_vehicle_id
      AND v.user_id = me.uid
      AND (v.verification_type = 'title' OR v.verification_category = 'title_document')
    ORDER BY (v.status = 'approved') DESC, v.approved_at DESC NULLS LAST
    LIMIT 1
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM perm) THEN NULL  -- not the viewer's vehicle
    ELSE jsonb_build_object(
      'role',            (SELECT role FROM perm),
      'since',           (SELECT to_char(granted_at, 'YYYY-MM-DD') FROM perm),
      'title_verified',  COALESCE((SELECT status = 'approved' FROM ver), false),
      'verification_status', (SELECT status FROM ver),     -- e.g. expired / pending (honest)
      'verified_at',     (SELECT to_char(approved_at, 'YYYY-MM-DD') FROM ver
                          WHERE (SELECT status FROM ver) = 'approved')
    )
  END;
$$;

COMMENT ON FUNCTION public.get_user_vehicle_relationship(uuid) IS
  'The signed-in viewer''s ASSET relationship to a vehicle (role, since, '
  'title-verified) from vehicle_user_permissions + ownership_verifications. '
  'NULL when the vehicle is not the viewer''s — never claims false ownership.';

GRANT EXECUTE ON FUNCTION public.get_user_contribution_calendar(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_vehicle_relationship(uuid) TO anon, authenticated;
