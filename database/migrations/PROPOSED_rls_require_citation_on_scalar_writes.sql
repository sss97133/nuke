-- =============================================================================
-- PROPOSED — DO NOT APPLY WITHOUT REVIEW
-- RLS: Require citation on scalar writes to identity / ownership / title columns
-- =============================================================================
-- The gap (what happened to Skylar's K5):
--   On 2026-04-28 an automated A/R sweep overwrote vehicles.owner_name on
--   vehicle e08bf694-970f-4cbe-8a74-8715158a0f2e (Skylar's 1977 K5 Blazer) from
--   the legitimate owner to "Scott (li3go)". As of 2026-05-17 the row still
--   reads owner_name='Scott (li3go)', ownership_verified=false,
--   ownership_verification_id=null. No citation, no audit row, no proof. The
--   existing RLS policy `vehicles_simple_update_policy` gates only WHO
--   (auth.uid IN uploaded_by/user_id/owner_id) — its WITH_CHECK is NULL. It
--   does not gate WHAT columns may move or under WHICH conditions. Documented
--   rules ("ownership changes require title-proof") live in migration
--   comments (supabase/migrations/20250128_title_transfer_protection_system.sql,
--   20251212000018_ownership_effective_date_from_title.sql) and in
--   .claude/rules/agent-trust-invariants.md but are not enforced by RLS.
--   vehicle_observations is the row-level success case (is_superseded /
--   superseded_by — testimony is never deleted). Scalar columns on vehicles
--   have no equivalent protection.
--
-- The fix approach:
--   1. Strip UPDATE grants on the eight high-risk scalar columns from anon
--      and authenticated. Force writes through a SECURITY DEFINER RPC that
--      validates citation evidence and writes an audit row.
--   2. Replace `vehicles_simple_update_policy` with two policies:
--        a. vehicles_safe_columns_update — anyone in (uploaded_by/user_id/owner_id)
--           can UPDATE all columns EXCEPT the eight high-risk ones (enforced
--           by lack of column-level UPDATE grant — see step 1).
--        b. vehicles_title_columns_update — UPDATE on the eight columns is
--           allowed only when the request carries a citation header
--           (`x-citation-source` AND `x-citation-method` in
--           current_setting('request.headers', true)) OR when the writer is
--           service_role (so the new RPC can persist the change after it has
--           validated the citation). The RPC is the only blessed path.
--   3. Add CHECK constraint: ownership_verified=true implies
--      ownership_verification_id IS NOT NULL (no "verified by vibes" state).
--   4. Add ownership_change_audit table receiving every write to the eight
--      columns with the citation header values, supersession-style (no
--      deletes, no updates after insert).
--
-- Why headers, not a claim_id FK:
--   Supabase PostgREST exposes request headers via
--   current_setting('request.headers', true) as JSON. This lets RLS see the
--   citation metadata without a schema migration on every caller. A future
--   tightening can require an actual ownership_verifications row id in
--   x-citation-verification-id and JOIN-validate it — this migration is
--   step 1 of that staircase.
--
-- Rollback:
--   Run the ROLLBACK block at the bottom of this file. It restores the
--   prior `vehicles_simple_update_policy` exactly (USING clause copied from
--   pg_policies on 2026-05-17) and re-grants UPDATE on the eight columns to
--   anon and authenticated. Audit rows in ownership_change_audit are
--   testimony per .claude/rules/agent-trust-invariants.md and MUST NOT be
--   deleted by rollback.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Audit table — testimony, supersession-style, never deleted
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ownership_change_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  column_name TEXT NOT NULL CHECK (column_name IN (
    'owner_name','user_id','owner_id','title_status','title_transfer_date',
    'ownership_verified','ownership_verification_id','ownership_verified_at'
  )),
  old_value TEXT,
  new_value TEXT,
  changed_by UUID,                            -- auth.uid() at write time
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  citation_source TEXT,                       -- x-citation-source header
  citation_method TEXT,                       -- x-citation-method header
  citation_verification_id UUID               -- x-citation-verification-id header
    REFERENCES public.ownership_verifications(id) ON DELETE RESTRICT,
  citation_url TEXT,                          -- x-citation-url header
  request_headers JSONB,                      -- full headers snapshot for forensics
  is_superseded BOOLEAN NOT NULL DEFAULT false,
  superseded_by UUID REFERENCES public.ownership_change_audit(id)
);

CREATE INDEX IF NOT EXISTS idx_ownership_change_audit_vehicle
  ON public.ownership_change_audit(vehicle_id, changed_at DESC);

ALTER TABLE public.ownership_change_audit ENABLE ROW LEVEL SECURITY;

-- Read: vehicle owners + admins
CREATE POLICY ownership_change_audit_read ON public.ownership_change_audit
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = ownership_change_audit.vehicle_id
        AND (v.uploaded_by = auth.uid() OR v.user_id = auth.uid() OR v.owner_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.user_id = auth.uid() AND au.is_active = true
    )
  );

-- No UPDATE policy → no UPDATE allowed (testimony invariant).
-- No DELETE policy → no DELETE allowed (testimony invariant).
-- INSERT only via the SECURITY DEFINER RPC below.

-- -----------------------------------------------------------------------------
-- 2. Helper: extract citation evidence from PostgREST headers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_has_citation()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_headers JSONB;
BEGIN
  -- current_setting returns the JSON string PostgREST stuffs into the GUC.
  -- 'true' second arg = missing_ok (returns NULL instead of erroring).
  v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  IF v_headers IS NULL THEN
    RETURN false;
  END IF;
  -- Both source AND method must be present and non-empty.
  -- Either a verification_id OR a citation_url must also be present.
  RETURN
    coalesce(btrim(v_headers->>'x-citation-source'), '') <> ''
    AND coalesce(btrim(v_headers->>'x-citation-method'), '') <> ''
    AND (
      coalesce(btrim(v_headers->>'x-citation-verification-id'), '') <> ''
      OR coalesce(btrim(v_headers->>'x-citation-url'), '') <> ''
    );
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.request_has_citation IS
  'Returns true iff the PostgREST request carries x-citation-source, x-citation-method, and either x-citation-verification-id or x-citation-url. Used by RLS policies on vehicles high-risk columns.';

-- -----------------------------------------------------------------------------
-- 3. Strip column-level UPDATE grants on the eight high-risk columns
--    from anon and authenticated. Writes must go through the RPC.
--    service_role retains UPDATE so the RPC (and admin paths) still work.
-- -----------------------------------------------------------------------------
REVOKE UPDATE (owner_name, user_id, owner_id,
               title_status, title_transfer_date,
               ownership_verified, ownership_verification_id,
               ownership_verified_at)
  ON public.vehicles FROM anon, authenticated;

-- Note: INSERT grant is intentionally retained so vehicle creation still works.
-- The audit + citation requirement applies to UPDATE only, since the K5
-- incident was an UPDATE overwrite. Tightening INSERT can be a separate
-- migration once we understand which intake paths legitimately set
-- ownership_verified at insert time.

-- -----------------------------------------------------------------------------
-- 4. Replace vehicles_simple_update_policy with citation-aware policies
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS vehicles_simple_update_policy ON public.vehicles;

-- 4a. Safe columns (everything except the eight). Same auth.uid gate as before.
--     Column-level enforcement is via the REVOKE above — RLS gate just
--     mirrors the prior owner-check so behavior on safe columns is unchanged.
CREATE POLICY vehicles_safe_columns_update ON public.vehicles
  FOR UPDATE
  USING (
    auth.uid() = uploaded_by
    OR auth.uid() = user_id
    OR auth.uid() = owner_id
  )
  WITH CHECK (
    auth.uid() = uploaded_by
    OR auth.uid() = user_id
    OR auth.uid() = owner_id
  );

-- 4b. Citation-required service path. service_role can write the eight
--     columns ONLY when a citation header is present in the request. This
--     forces the RPC (or any future write path) to set the headers before
--     touching identity/ownership/title state.
CREATE POLICY vehicles_cited_service_update ON public.vehicles
  FOR UPDATE
  TO service_role
  USING (public.request_has_citation())
  WITH CHECK (public.request_has_citation());

-- Note on policy interaction: PERMISSIVE policies OR together. The
-- service_role bypasses RLS entirely under the default Supabase config
-- (BYPASSRLS attribute). To make this enforcement bite we ALSO need:
ALTER TABLE public.vehicles FORCE ROW LEVEL SECURITY;
-- FORCE RLS makes service_role obey policies. If any existing service code
-- writes the eight columns without a citation header, it will fail after
-- this migration — that is the intended behavior. Audit which edge
-- functions hit these columns BEFORE applying this migration. Candidates
-- to update first:
--   - approve_title_transfer() (already cites — passes transfer_id)
--   - approve_ownership_verification() (already cites — passes
--     verification_id; call sites must add the header)
--   - any A/R or marketing sweep edge function (these are the offenders)

-- -----------------------------------------------------------------------------
-- 5. Integrity CHECK: no "verified by vibes" state
-- -----------------------------------------------------------------------------
-- ownership_verified=true requires ownership_verification_id to point at a row.
-- This blocks the K5 failure mode at the constraint level too — even if RLS
-- is bypassed (e.g. by a future SECURITY DEFINER that forgets to cite), the
-- DB rejects the inconsistent state.
ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_ownership_verified_requires_verification_id
  CHECK (
    ownership_verified IS NOT TRUE
    OR ownership_verification_id IS NOT NULL
  )
  NOT VALID;
-- NOT VALID skips the initial full-table scan (171GB DB, hard rule #8).
-- A separate batched VALIDATE CONSTRAINT pass should follow once existing
-- rows are reconciled (the K5 currently has ownership_verified=false so it
-- doesn't violate, but other rows might).

-- -----------------------------------------------------------------------------
-- 6. The blessed write path: SECURITY DEFINER RPC
-- -----------------------------------------------------------------------------
-- Callers (UI, edge functions) invoke this instead of UPDATE-ing the eight
-- columns directly. It validates citation, writes the audit row, then
-- performs the column update using its DEFINER privileges. RLS still
-- applies, and the request_has_citation() gate is satisfied because the
-- caller's PostgREST headers propagate.
CREATE OR REPLACE FUNCTION public.update_vehicle_ownership_columns(
  p_vehicle_id UUID,
  p_changes JSONB,                  -- {column_name: new_value, ...}
  p_citation_source TEXT,           -- mirror of x-citation-source header
  p_citation_method TEXT,           -- mirror of x-citation-method header
  p_citation_verification_id UUID DEFAULT NULL,
  p_citation_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_audit_id UUID;
  v_column TEXT;
  v_new_value TEXT;
  v_old_row public.vehicles%ROWTYPE;
  v_allowed_columns TEXT[] := ARRAY[
    'owner_name','user_id','owner_id','title_status','title_transfer_date',
    'ownership_verified','ownership_verification_id','ownership_verified_at'
  ];
BEGIN
  -- Hard gate: citation evidence required.
  IF coalesce(btrim(p_citation_source), '') = '' OR coalesce(btrim(p_citation_method), '') = '' THEN
    RAISE EXCEPTION 'citation required: x-citation-source and x-citation-method must be non-empty';
  END IF;
  IF p_citation_verification_id IS NULL AND coalesce(btrim(p_citation_url), '') = '' THEN
    RAISE EXCEPTION 'citation required: provide ownership_verification_id or citation_url';
  END IF;

  -- Caller must own the vehicle or be admin (mirrors vehicles_safe_columns_update gate).
  SELECT * INTO v_old_row FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vehicle not found: %', p_vehicle_id;
  END IF;
  IF auth.uid() IS NULL
     OR (auth.uid() <> v_old_row.uploaded_by
         AND auth.uid() <> v_old_row.user_id
         AND auth.uid() <> v_old_row.owner_id
         AND NOT EXISTS (
           SELECT 1 FROM public.admin_users au
           WHERE au.user_id = auth.uid() AND au.is_active = true
         )) THEN
    RAISE EXCEPTION 'not authorized to modify ownership columns on vehicle %', p_vehicle_id;
  END IF;

  -- Iterate the changes JSONB, validate keys, write audit + update.
  FOR v_column, v_new_value IN SELECT * FROM jsonb_each_text(p_changes) LOOP
    IF NOT (v_column = ANY (v_allowed_columns)) THEN
      RAISE EXCEPTION 'column % is not permitted via this RPC', v_column;
    END IF;

    INSERT INTO public.ownership_change_audit (
      vehicle_id, column_name, old_value, new_value,
      changed_by, citation_source, citation_method,
      citation_verification_id, citation_url, request_headers
    ) VALUES (
      p_vehicle_id,
      v_column,
      CASE v_column
        WHEN 'owner_name' THEN v_old_row.owner_name
        WHEN 'user_id' THEN v_old_row.user_id::text
        WHEN 'owner_id' THEN v_old_row.owner_id::text
        WHEN 'title_status' THEN v_old_row.title_status
        WHEN 'title_transfer_date' THEN v_old_row.title_transfer_date::text
        WHEN 'ownership_verified' THEN v_old_row.ownership_verified::text
        WHEN 'ownership_verification_id' THEN v_old_row.ownership_verification_id::text
        WHEN 'ownership_verified_at' THEN v_old_row.ownership_verified_at::text
      END,
      v_new_value,
      auth.uid(),
      p_citation_source,
      p_citation_method,
      p_citation_verification_id,
      p_citation_url,
      nullif(current_setting('request.headers', true), '')::jsonb
    ) RETURNING id INTO v_audit_id;

    -- Apply the change. Dynamic SQL keeps the column list explicit and audited.
    EXECUTE format(
      'UPDATE public.vehicles SET %I = $1::text::%s, updated_at = NOW() WHERE id = $2',
      v_column,
      CASE v_column
        WHEN 'user_id' THEN 'uuid'
        WHEN 'owner_id' THEN 'uuid'
        WHEN 'ownership_verification_id' THEN 'uuid'
        WHEN 'title_transfer_date' THEN 'date'
        WHEN 'ownership_verified' THEN 'boolean'
        WHEN 'ownership_verified_at' THEN 'timestamp'
        ELSE 'text'
      END
    ) USING v_new_value, p_vehicle_id;
  END LOOP;

  RETURN v_audit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_vehicle_ownership_columns FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_vehicle_ownership_columns TO authenticated, service_role;

COMMENT ON FUNCTION public.update_vehicle_ownership_columns IS
  'Blessed write path for the eight high-risk scalar columns on vehicles. Requires citation arguments. Writes an immutable audit row in ownership_change_audit before updating. See PROPOSED_rls_require_citation_on_scalar_writes.sql for rationale.';

COMMIT;

-- =============================================================================
-- ROLLBACK BLOCK — run this to undo the forward migration.
-- DO NOT delete rows from ownership_change_audit. Testimony is permanent
-- (.claude/rules/agent-trust-invariants.md).
-- =============================================================================
-- BEGIN;
--
-- -- 1. Restore prior policy (copied verbatim from pg_policies on 2026-05-17)
-- DROP POLICY IF EXISTS vehicles_cited_service_update ON public.vehicles;
-- DROP POLICY IF EXISTS vehicles_safe_columns_update ON public.vehicles;
-- CREATE POLICY vehicles_simple_update_policy ON public.vehicles
--   FOR UPDATE
--   USING (
--     (SELECT auth.uid()) = uploaded_by
--     OR (SELECT auth.uid()) = user_id
--     OR (SELECT auth.uid()) = owner_id
--   );
--
-- -- 2. Stop forcing RLS on service_role
-- ALTER TABLE public.vehicles NO FORCE ROW LEVEL SECURITY;
--
-- -- 3. Restore column-level UPDATE grants
-- GRANT UPDATE (owner_name, user_id, owner_id,
--               title_status, title_transfer_date,
--               ownership_verified, ownership_verification_id,
--               ownership_verified_at)
--   ON public.vehicles TO anon, authenticated;
--
-- -- 4. Drop the CHECK constraint (keep the audit table — it's testimony)
-- ALTER TABLE public.vehicles
--   DROP CONSTRAINT IF EXISTS vehicles_ownership_verified_requires_verification_id;
--
-- -- 5. Drop the RPC and the citation helper
-- DROP FUNCTION IF EXISTS public.update_vehicle_ownership_columns(UUID, JSONB, TEXT, TEXT, UUID, TEXT);
-- DROP FUNCTION IF EXISTS public.request_has_citation();
--
-- -- DO NOT drop ownership_change_audit. It holds testimony.
-- COMMIT;
