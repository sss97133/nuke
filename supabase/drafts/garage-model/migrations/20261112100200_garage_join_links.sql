-- DRAFT — NOT APPLIED. Do not move into supabase/migrations without Skylar's approval.
--
-- Garage model, migration 02 (JOIN lane): the join-link functions. The table public.garage_join_links, the member
-- table public.garage_members, garage_role_rank and garage_member_rank come from migration 00
-- (20261112100000_garage_core.sql); this file only adds writers and one anon-callable reader. Flow, abuse notes and
-- what remains: docs/garage-model/JOIN_LINK.md.
--
--   create_garage_join_link   manager+ mints a link; the raw token is returned ONCE, only its sha256 is stored.
--   preview_garage_join_link  anon-callable; garage display name + role offered + validity. Nothing else.
--   redeem_garage_join_link   signed-in; writes a garage_members row (pending, or active when the link says no
--                             approval is needed and the role is <= technician). Idempotent per user. Grants NO
--                             vehicle-level access: visibility is the VISIBILITY lane's rule on garage rank.
--   decide_garage_membership  manager+ approves (optionally with a lower/equal role) or declines a pending row.
--   revoke_garage_join_link   manager+ kills a link. Rows it already produced stay (revoke a person separately).
--
-- Additions beyond CONTRACT.md "Join link API" (additive, defaulted; the contract's calls work unchanged):
--   create_garage_join_link has a 5th argument p_requires_approval boolean DEFAULT true.
--   decide_garage_membership returns (member_id, status, role); revoke_garage_join_link returns boolean.
--
-- Token: 32 bytes taken from two gen_random_uuid() values (the repo's own convention in create_contributor_invite,
-- no pgcrypto dependency; 244 random bits), base64url without padding = 43 characters. Stored as sha256 hex only.
--
-- Error contract (what iOS maps): RAISE messages 'join_link_<reason>' with SQLSTATE P0001 for a bad link, 28000 for
-- no/anonymous session, 42501 for a rank refusal, 22023 for a bad argument.
--
-- Relation to the older doors (none is touched here):
--   business_invite_codes / generate_invite_code / use_invite_code  Telegram-era; redeem into telegram_technicians,
--       never into a membership. Superseded for new invites (SPEC 3.2), left callable, nothing links to them.
--   vehicle_contributor_invites / create_contributor_invite / contributor-intake  the per-vehicle link: stays.
--   web /invite/:token and /supplier-invite/:token  supplier invites (SupplierInvitePage). The garage link lives on
--       /join/:token and never shares a route, a table or a token alphabet length with them.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------------------------------------------
-- Mint.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_garage_join_link(
  p_garage uuid,
  p_role text,
  p_max_uses integer DEFAULT 1,
  p_expires_at timestamptz DEFAULT now() + interval '7 days',
  p_requires_approval boolean DEFAULT true
)
RETURNS TABLE (link_id uuid, token text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_rank  integer;
  v_raw   bytea;
  v_token text;
  v_id    uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'create_garage_join_link requires a signed-in user' USING ERRCODE = '28000'; END IF;
  IF p_role IS NULL OR p_role NOT IN ('manager', 'technician', 'staff', 'photographer', 'customer', 'viewer') THEN
    -- 'owner' lands here too: an owner is made by create_garage, never by a link.
    RAISE EXCEPTION 'join_link_role_not_mintable: %', coalesce(p_role, 'null') USING ERRCODE = '22023';
  END IF;
  IF p_max_uses IS NULL OR p_max_uses < 1 OR p_max_uses > 100 THEN
    RAISE EXCEPTION 'join_link_bad_max_uses: 1..100' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '30 days' THEN
    RAISE EXCEPTION 'join_link_bad_expiry: later than now and within 30 days' USING ERRCODE = '22023';
  END IF;

  v_rank := public.garage_member_rank(p_garage, v_user);   -- 0 unless an ACTIVE member
  IF v_rank < 80 THEN
    RAISE EXCEPTION 'join_link_rank_required: manager or above' USING ERRCODE = '42501';
  END IF;
  IF public.garage_role_rank(p_role) > v_rank THEN
    RAISE EXCEPTION 'join_link_above_own_rank' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.garages g WHERE g.id = p_garage AND g.status = 'active') THEN
    RAISE EXCEPTION 'join_link_garage_closed' USING ERRCODE = '22023';
  END IF;
  -- Abuse ceiling: a garage carries at most 25 live links at once.
  IF (SELECT count(*) FROM public.garage_join_links l
       WHERE l.garage_id = p_garage AND l.revoked_at IS NULL AND l.expires_at > now() AND l.uses_count < l.max_uses) >= 25 THEN
    RAISE EXCEPTION 'join_link_too_many_live_links: revoke one first' USING ERRCODE = '54000';
  END IF;

  v_raw   := decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex');   -- 32 bytes
  v_token := translate(rtrim(encode(v_raw, 'base64'), '='), '+/', '-_');                            -- 43 url-safe chars
  INSERT INTO public.garage_join_links (garage_id, token_hash, role, max_uses, expires_at, requires_approval, created_by)
  VALUES (p_garage, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_role, p_max_uses, p_expires_at,
          coalesce(p_requires_approval, true), v_user)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, v_token;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Preview. Callable by anon, so it returns only what the link itself is about: the garage's display name, the role
-- offered and whether the link is usable. Never members, vehicles, sites, counts, the operator org or the minter.
-- A wrong token and a malformed token both answer 'not_found', so the reason says nothing about other tokens.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_garage_join_link(p_token text)
RETURNS TABLE (garage_name text, role text, valid boolean, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  l public.garage_join_links%ROWTYPE;
  g public.garages%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN QUERY SELECT NULL::text, NULL::text, false, 'not_found'::text; RETURN;
  END IF;
  SELECT * INTO l FROM public.garage_join_links x WHERE x.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, NULL::text, false, 'not_found'::text; RETURN;
  END IF;
  SELECT * INTO g FROM public.garages x WHERE x.id = l.garage_id;
  RETURN QUERY SELECT g.name, l.role,
    (l.revoked_at IS NULL AND l.expires_at > now() AND l.uses_count < l.max_uses AND g.status = 'active'),
    CASE WHEN l.revoked_at IS NOT NULL THEN 'revoked'
         WHEN l.expires_at <= now()    THEN 'expired'
         WHEN l.uses_count >= l.max_uses THEN 'exhausted'
         WHEN g.status <> 'active'     THEN 'garage_closed'
         ELSE 'ok' END;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Redeem. Signed in (a real account, not an anonymous session). Idempotent per user: someone who already holds a
-- live row in the garage gets that row back unchanged (no second use, no role change), even if the link has since
-- been used up. A person a manager removed ('revoked') cannot walk back in on a link; a manager decides.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_garage_join_link(p_token text)
RETURNS TABLE (member_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   uuid := auth.uid();
  l        public.garage_join_links%ROWTYPE;
  g_status text;
  m        public.garage_members%ROWTYPE;
  v_active boolean;
  v_id     uuid;
BEGIN
  IF v_user IS NULL OR coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' THEN
    RAISE EXCEPTION 'redeem_garage_join_link requires a signed-in account' USING ERRCODE = '28000';
  END IF;
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'join_link_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO l FROM public.garage_join_links x
   WHERE x.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   FOR UPDATE;                                  -- serialises concurrent redemptions of one link
  IF NOT FOUND THEN RAISE EXCEPTION 'join_link_not_found' USING ERRCODE = 'P0001'; END IF;

  -- Idempotent path first: already a live member (pending / active / suspended) -> return that row, change nothing.
  SELECT * INTO m FROM public.garage_members x
   WHERE x.garage_id = l.garage_id AND x.user_id = v_user AND x.status IN ('pending', 'active', 'suspended');
  IF FOUND THEN RETURN QUERY SELECT m.id, m.status; RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.garage_members x WHERE x.garage_id = l.garage_id AND x.user_id = v_user AND x.status = 'revoked') THEN
    RAISE EXCEPTION 'join_link_membership_revoked' USING ERRCODE = 'P0001';
  END IF;

  SELECT g.status INTO g_status FROM public.garages g WHERE g.id = l.garage_id;
  IF l.revoked_at IS NOT NULL      THEN RAISE EXCEPTION 'join_link_revoked'   USING ERRCODE = 'P0001'; END IF;
  IF l.expires_at <= now()         THEN RAISE EXCEPTION 'join_link_expired'   USING ERRCODE = 'P0001'; END IF;
  IF l.uses_count >= l.max_uses    THEN RAISE EXCEPTION 'join_link_exhausted' USING ERRCODE = 'P0001'; END IF;
  IF g_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'join_link_garage_closed' USING ERRCODE = 'P0001'; END IF;

  -- Abuse ceiling: a garage holds at most 50 unanswered applications.
  IF (SELECT count(*) FROM public.garage_members x WHERE x.garage_id = l.garage_id AND x.status = 'pending') >= 50 THEN
    RAISE EXCEPTION 'join_link_garage_busy' USING ERRCODE = 'P0001';
  END IF;

  -- Active at once only when the minter waived approval AND the role is technician or lower. A manager link always
  -- waits for a person, whatever the flag says.
  v_active := (NOT l.requires_approval) AND public.garage_role_rank(l.role) <= 50;
  BEGIN
    INSERT INTO public.garage_members (garage_id, user_id, role, status, joined_via_link_id, invited_by, approved_by, approved_at, started_at)
    VALUES (l.garage_id, v_user, l.role, CASE WHEN v_active THEN 'active' ELSE 'pending' END, l.id, l.created_by,
            CASE WHEN v_active THEN l.created_by END, CASE WHEN v_active THEN now() END, CASE WHEN v_active THEN now() END)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Two taps at once (another link, same person): the live-row index decided; return the winner, count no use.
    SELECT x.id INTO v_id FROM public.garage_members x
     WHERE x.garage_id = l.garage_id AND x.user_id = v_user AND x.status IN ('pending', 'active', 'suspended');
    RETURN QUERY SELECT x.id, x.status FROM public.garage_members x WHERE x.id = v_id; RETURN;
  END;
  UPDATE public.garage_join_links SET uses_count = uses_count + 1 WHERE id = l.id;
  RETURN QUERY SELECT x.id, x.status FROM public.garage_members x WHERE x.id = v_id;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Decide. Manager+ approves or declines a PENDING row. The approver cannot hand out a role above their own rank and
-- never 'owner'. A decline closes the row as 'revoked' with ended_at (the original row stays as history).
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_garage_membership(p_member uuid, p_approve boolean, p_role text DEFAULT NULL)
RETURNS TABLE (member_id uuid, status text, role text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  m      public.garage_members%ROWTYPE;
  v_rank integer;
  v_role text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'decide_garage_membership requires a signed-in user' USING ERRCODE = '28000'; END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'join_link_bad_decision' USING ERRCODE = '22023'; END IF;
  SELECT * INTO m FROM public.garage_members x WHERE x.id = p_member FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'join_link_member_not_found' USING ERRCODE = 'P0001'; END IF;
  v_rank := public.garage_member_rank(m.garage_id, v_user);
  IF v_rank < 80 THEN RAISE EXCEPTION 'join_link_rank_required: manager or above' USING ERRCODE = '42501'; END IF;
  IF m.user_id = v_user THEN RAISE EXCEPTION 'join_link_cannot_decide_self' USING ERRCODE = '42501'; END IF;
  IF m.status <> 'pending' THEN RAISE EXCEPTION 'join_link_not_pending' USING ERRCODE = 'P0001'; END IF;

  IF p_approve THEN
    v_role := coalesce(p_role, m.role);
    IF v_role NOT IN ('manager', 'technician', 'staff', 'photographer', 'customer', 'viewer') THEN
      RAISE EXCEPTION 'join_link_role_not_mintable: %', v_role USING ERRCODE = '22023';
    END IF;
    IF public.garage_role_rank(v_role) > v_rank THEN
      RAISE EXCEPTION 'join_link_above_own_rank' USING ERRCODE = '42501';
    END IF;
    UPDATE public.garage_members x
       SET status = 'active', role = v_role, approved_by = v_user, approved_at = now(), started_at = now()
     WHERE x.id = m.id;
  ELSE
    UPDATE public.garage_members x SET status = 'revoked', approved_by = v_user, ended_at = now() WHERE x.id = m.id;
  END IF;
  RETURN QUERY SELECT x.id, x.status, x.role FROM public.garage_members x WHERE x.id = m.id;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Revoke a link. Manager+ of that garage. Idempotent: true when this call revoked it, false when it already was.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_garage_join_link(p_link uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  l      public.garage_join_links%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'revoke_garage_join_link requires a signed-in user' USING ERRCODE = '28000'; END IF;
  SELECT * INTO l FROM public.garage_join_links x WHERE x.id = p_link FOR UPDATE;
  IF NOT FOUND OR public.garage_member_rank(l.garage_id, v_user) < 80 THEN
    -- Same answer for "no such link" and "not yours": a non-manager learns nothing about link ids.
    RAISE EXCEPTION 'join_link_rank_required: manager or above' USING ERRCODE = '42501';
  END IF;
  IF l.revoked_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE public.garage_join_links SET revoked_at = now() WHERE id = l.id;
  RETURN true;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants. Only preview is open to anon.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  public.create_garage_join_link(uuid, text, integer, timestamptz, boolean),
  public.preview_garage_join_link(text), public.redeem_garage_join_link(text),
  public.decide_garage_membership(uuid, boolean, text), public.revoke_garage_join_link(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.create_garage_join_link(uuid, text, integer, timestamptz, boolean),
  public.redeem_garage_join_link(text),
  public.decide_garage_membership(uuid, boolean, text), public.revoke_garage_join_link(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_garage_join_link(text) TO anon, authenticated, service_role;
