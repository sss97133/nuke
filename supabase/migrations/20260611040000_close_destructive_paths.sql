-- ============================================================================
-- Source Data Reorg campaign, step 2: close the destructive paths.
-- docs/plans/2026-06-11_source-data-reorg-campaign.md (step 2)
--
-- (a) Revoke DELETE on vehicle_images from client roles.
--     vehicle_images is testimony — "testimony is never deleted"
--     (.claude/rules/agent-trust-invariants.md). The inbox UI exposed a raw
--     .delete() (personalPhotoLibraryService.deletePhotos), now replaced by
--     organization_status='ignored'. This revoke closes the path at the DB
--     layer for every current and future client. service_role retains DELETE
--     for sanctioned admin/merge tooling.
--
-- (b) Drop the legacy 4-arg auto_match_image_to_vehicles overload.
--     Prod had two overloads (pg_proc verified 2026-06-10):
--       legacy : (p_image_id uuid, p_max_gps_distance_meters integer,
--                 p_max_date_difference_days integer, p_min_confidence real)
--                — GPS/date/FILENAME-LIKE scorer (year/make/model substring in
--                filename = 20% weight), gated on organization_status =
--                'unorganized'. Filename matching is inference, not evidence.
--       current: (p_image_id uuid, p_latitude double precision, p_longitude
--                 double precision, p_taken_at timestamptz, p_user_id uuid)
--                — the ambiguity-guard version (20260610011000), KEPT.
--     Caller grep before drop (2026-06-10): the only 4-arg caller was
--     nuke_frontend/src/services/imageUploadService.ts:762, migrated to the
--     5-arg overload in the same commit. photo-pipeline-orchestrator and all
--     other callers already use the 5-arg version.
-- ============================================================================

-- (a) DELETE was granted to anon, authenticated, service_role, postgres
--     (information_schema.role_table_grants, verified 2026-06-10).
REVOKE DELETE ON public.vehicle_images FROM authenticated;
REVOKE DELETE ON public.vehicle_images FROM anon;

-- (b) Exact signature verified against pg_proc before drop (oid 16933).
DROP FUNCTION IF EXISTS public.auto_match_image_to_vehicles(uuid, integer, integer, real);

COMMENT ON FUNCTION public.auto_match_image_to_vehicles(uuid, double precision, double precision, timestamp with time zone, uuid) IS
  'GPS-proximity vehicle matcher with shared-location ambiguity guard (caps confidence at 0.5 when 2+ vehicles score within 0.15 — see 20260610011000). Sole surviving overload: the legacy 4-arg filename-LIKE scorer was dropped by 20260611040000_close_destructive_paths (source-data-reorg step 2).';
