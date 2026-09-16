-- ============================================================
-- account_link_claims — the canonical identity-claim table
-- ============================================================
-- CONNECTION_COCKPIT.md T1 item 9 ("the phonebook moment").
--
-- WHY (verified against prod 2026-06-11):
--   * mcp-connector (DEPLOYED, unchangeable tonight) writes claims to
--     `account_link_claims` in handleLinkAccount / handleVerifyAccountLink /
--     handleListLinkedAccounts — the table does NOT exist in prod, so the
--     entire MCP link_account flow 500s.
--   * The web flow (`ClaimExternalIdentity.tsx` → RPC
--     `request_external_identity_claim`, which EXISTS in prod) inserts into
--     `external_identity_claims` — that table ALSO does not exist in prod.
--   * 569,795 rows in external_identities (563,984 BaT handles) are one
--     CREATE TABLE away from claimable. Only the tables are missing.
--
-- DESIGN: ONE canonical table (account_link_claims, the shape the deployed
-- MCP connector expects) plus a compatibility VIEW named
-- `external_identity_claims` with INSTEAD OF triggers, so the existing
-- prod RPCs (request_external_identity_claim / approve_external_identity_claim)
-- work UNMODIFIED and both paths land claims in the same canonical table.
--
-- STRICTLY ADDITIVE: creates 1 table, 1 view, 2 trigger functions, indexes,
-- RLS policies on the NEW table only. No existing object is altered/dropped.

-- ------------------------------------------------------------
-- 1) Canonical table
-- ------------------------------------------------------------
-- Column superset:
--   MCP path uses: id, user_id, platform, handle, external_identity_id,
--                  status, verification_method, claim_confidence, proof_url,
--                  created_at, updated_at
--                  (upsert onConflict: user_id,platform,handle)
--   Web RPC path uses (via compat view): external_identity_id,
--                  requested_by_user_id, proof_type, proof_url, notes,
--                  status, reviewed_by_user_id, reviewed_at
CREATE TABLE IF NOT EXISTS public.account_link_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  external_identity_id UUID REFERENCES public.external_identities(id) ON DELETE SET NULL,

  -- union of both flows' vocabularies:
  -- MCP: pending / pending_review / verified / rejected / expired
  -- web RPC: pending / approved / rejected / expired
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','pending_review','verified','approved','rejected','expired')),

  verification_method TEXT,            -- MCP: email_match | profile_url_proof | manual_review
  claim_confidence INTEGER DEFAULT 0 CHECK (claim_confidence >= 0 AND claim_confidence <= 100),
  proof_type TEXT,                     -- web RPC: profile_link | screenshot | oauth | other
  proof_url TEXT,
  notes TEXT,
  reviewed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- required by mcp-connector's upsert({ onConflict: "user_id,platform,handle" })
  CONSTRAINT account_link_claims_user_platform_handle_key UNIQUE (user_id, platform, handle)
);

CREATE INDEX IF NOT EXISTS idx_account_link_claims_user ON public.account_link_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_account_link_claims_identity ON public.account_link_claims(external_identity_id) WHERE external_identity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_account_link_claims_open ON public.account_link_claims(status) WHERE status IN ('pending','pending_review');

COMMENT ON TABLE public.account_link_claims IS
  'Canonical identity-claim requests (MCP link_account + web claim flow via external_identity_claims compat view). CONNECTION_COCKPIT T1-9.';

-- ------------------------------------------------------------
-- 2) RLS: owner-read, owner-insert, service-role everything.
--    (mcp-connector writes with the service key; the web RPC is
--    SECURITY DEFINER and bypasses RLS as table owner.)
--    NO owner-update policy on purpose: users must not be able to
--    self-promote a claim to status='verified'.
-- ------------------------------------------------------------
ALTER TABLE public.account_link_claims ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='account_link_claims' AND policyname='alc_select_own') THEN
    CREATE POLICY alc_select_own ON public.account_link_claims
      FOR SELECT USING (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='account_link_claims' AND policyname='alc_insert_own') THEN
    CREATE POLICY alc_insert_own ON public.account_link_claims
      FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='account_link_claims' AND policyname='alc_service_role_all') THEN
    CREATE POLICY alc_service_role_all ON public.account_link_claims
      FOR ALL USING ((SELECT auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((SELECT auth.jwt() ->> 'role') = 'service_role');
  END IF;
END $$;

GRANT SELECT, INSERT ON public.account_link_claims TO authenticated;
GRANT ALL ON public.account_link_claims TO service_role;

-- ------------------------------------------------------------
-- 3) Compatibility surface for the EXISTING prod RPCs:
--    a view named external_identity_claims with the column names the
--    RPCs expect, writing through to account_link_claims.
--    Created only if no relation of that name exists (in a fresh
--    environment the 20251214 migration creates it as a real table;
--    in prod it is absent — verified 2026-06-11).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.external_identity_claims_compat_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_platform TEXT;
  v_handle TEXT;
  v_id UUID;
BEGIN
  SELECT platform, handle INTO v_platform, v_handle
  FROM external_identities WHERE id = NEW.external_identity_id;
  IF v_platform IS NULL THEN
    RAISE EXCEPTION 'external identity % not found', NEW.external_identity_id;
  END IF;

  INSERT INTO account_link_claims AS alc
    (user_id, platform, handle, external_identity_id, status, proof_type, proof_url, notes)
  VALUES
    (NEW.requested_by_user_id, v_platform, v_handle, NEW.external_identity_id,
     COALESCE(NEW.status, 'pending'), NEW.proof_type, NEW.proof_url, NEW.notes)
  ON CONFLICT (user_id, platform, handle) DO UPDATE SET
    external_identity_id = COALESCE(alc.external_identity_id, EXCLUDED.external_identity_id),
    proof_type = COALESCE(EXCLUDED.proof_type, alc.proof_type),
    proof_url  = COALESCE(EXCLUDED.proof_url,  alc.proof_url),
    notes      = COALESCE(EXCLUDED.notes,      alc.notes),
    -- a re-request never downgrades an already-decided claim
    status     = CASE WHEN alc.status IN ('verified','approved') THEN alc.status
                      ELSE COALESCE(EXCLUDED.status, 'pending') END,
    updated_at = NOW()
  RETURNING id INTO v_id;

  NEW.id := v_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.external_identity_claims_compat_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE account_link_claims SET
    status = NEW.status,
    proof_type = NEW.proof_type,
    proof_url = NEW.proof_url,
    notes = NEW.notes,
    reviewed_by_user_id = NEW.reviewed_by_user_id,
    reviewed_at = NEW.reviewed_at,
    updated_at = COALESCE(NEW.updated_at, NOW())
  WHERE id = OLD.id;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.external_identity_claims') IS NULL THEN
    EXECUTE $v$
      CREATE VIEW public.external_identity_claims
      WITH (security_invoker = true) AS
      SELECT id,
             external_identity_id,
             user_id AS requested_by_user_id,
             proof_type,
             proof_url,
             notes,
             status,
             reviewed_by_user_id,
             reviewed_at,
             created_at,
             updated_at
      FROM public.account_link_claims
    $v$;
    EXECUTE 'CREATE TRIGGER external_identity_claims_compat_ins
             INSTEAD OF INSERT ON public.external_identity_claims
             FOR EACH ROW EXECUTE FUNCTION public.external_identity_claims_compat_insert()';
    EXECUTE 'CREATE TRIGGER external_identity_claims_compat_upd
             INSTEAD OF UPDATE ON public.external_identity_claims
             FOR EACH ROW EXECUTE FUNCTION public.external_identity_claims_compat_update()';
    EXECUTE 'GRANT SELECT ON public.external_identity_claims TO authenticated';
    EXECUTE 'GRANT ALL ON public.external_identity_claims TO service_role';
    EXECUTE $c$COMMENT ON VIEW public.external_identity_claims IS
      'Compatibility view over account_link_claims for the pre-existing request/approve_external_identity_claim RPCs. Both claim flows land in one canonical table.'$c$;
  END IF;
END $$;
