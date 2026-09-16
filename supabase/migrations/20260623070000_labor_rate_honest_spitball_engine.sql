-- 20260623070000_labor_rate_honest_spitball_engine.sql
-- Applied to prod 2026-06-23 via apply_migration (mirrors live). Source-of-truth
-- commit of three function defs changed live this session (production-engineering
-- rule: commit applied definitions so repo ≠ prod drift doesn't accumulate).
--
-- DOCTRINE (Skylar): "If the user isn't reporting costs we apply our estimate based
-- on market value and our analysis" + "we don't have enough authenticated data to
-- state the market rate; ~$160 is a good spitball but everyone hates paying it."
--
-- So labor rate resolution is: reported facts win (contract→user→org); else Nuke's
-- estimate. With thin authenticated data (< 30 observed shop rates) the estimate is
-- an explicit SPITBALL (~$160), never a stated market rate, and the posted-vs-accepted
-- gap is recorded. The two valuation functions draw the rate from this one engine
-- (was hardcoded $160 in one, $656-from-zero-rate-sessions before that). Value is
-- preserved today (spitball = $160); it just stops masquerading as a market fact and
-- self-refines as authenticated shop rates are ingested.

-- ── 1. resolve_labor_rate — reported-fact-wins, else honest spitball estimate ──
CREATE OR REPLACE FUNCTION resolve_labor_rate(
  p_organization_id UUID DEFAULT NULL, p_user_id UUID DEFAULT NULL,
  p_vehicle_id UUID DEFAULT NULL, p_client_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_contract_rate NUMERIC; v_user_rate NUMERIC; v_org_rate NUMERIC;
  v_sample_median NUMERIC; v_market_n INT;
  v_spitball NUMERIC := 160.00; v_auth_threshold INT := 30;
  v_resolved_rate NUMERIC; v_source TEXT; v_rate_conf TEXT; v_authenticated BOOLEAN;
BEGIN
  SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY labor_rate))::numeric, count(*)
    INTO v_sample_median, v_market_n
  FROM businesses WHERE labor_rate IS NOT NULL AND labor_rate > 0;
  v_market_n := COALESCE(v_market_n, 0);

  IF p_client_id IS NOT NULL AND p_organization_id IS NOT NULL THEN
    SELECT agreed_labor_rate INTO v_contract_rate FROM work_contracts
    WHERE client_id = p_client_id AND organization_id = p_organization_id
      AND status = 'active' AND (vehicle_id IS NULL OR vehicle_id = p_vehicle_id)
    ORDER BY vehicle_id NULLS LAST LIMIT 1;
    IF v_contract_rate IS NOT NULL THEN v_resolved_rate := v_contract_rate; v_source := 'contract'; END IF;
  END IF;
  IF v_resolved_rate IS NULL AND p_user_id IS NOT NULL THEN
    SELECT hourly_rate INTO v_user_rate FROM user_labor_rates
    WHERE user_id = p_user_id AND is_active = true ORDER BY created_at DESC LIMIT 1;
    IF v_user_rate IS NOT NULL THEN v_resolved_rate := v_user_rate; v_source := 'user'; END IF;
  END IF;
  IF v_resolved_rate IS NULL AND p_organization_id IS NOT NULL THEN
    SELECT labor_rate INTO v_org_rate FROM businesses WHERE id = p_organization_id;
    IF v_org_rate IS NOT NULL AND v_org_rate > 0 THEN v_resolved_rate := v_org_rate; v_source := 'organization'; END IF;
  END IF;

  IF v_resolved_rate IS NULL THEN
    v_authenticated := v_market_n >= v_auth_threshold;
    v_resolved_rate := CASE WHEN v_authenticated THEN v_sample_median ELSE v_spitball END;
    v_source        := CASE WHEN v_authenticated THEN 'market_estimate' ELSE 'spitball' END;
  ELSE v_authenticated := NULL; END IF;

  v_rate_conf := CASE
    WHEN v_source IN ('contract','user','organization') THEN 'reported'
    WHEN v_market_n >= v_auth_threshold THEN 'market'
    WHEN v_market_n >= 5 THEN 'spitball' ELSE 'spitball_no_data' END;

  RETURN jsonb_build_object(
    'rate', v_resolved_rate, 'source', v_source, 'rate_confidence', v_rate_conf,
    'is_estimated', v_source IN ('market_estimate','spitball'),
    'is_authenticated_market', COALESCE(v_authenticated, false),
    'is_user_reported', v_source IN ('contract','user','organization'),
    'contract_rate', v_contract_rate, 'user_rate', v_user_rate, 'org_rate', v_org_rate,
    'sample_median', v_sample_median, 'authenticated_sample_n', v_market_n,
    'authentication_threshold', v_auth_threshold,
    'note', CASE WHEN v_source = 'spitball'
      THEN format('~$%s is a spitball — only %s unverified shop rates, below the %s needed to state a market rate. Posted rate is widely resisted; the accepted/effective rate is likely lower.', v_resolved_rate, v_market_n, v_auth_threshold)
      ELSE NULL END);
END; $$;
COMMENT ON FUNCTION resolve_labor_rate IS 'Resolves labor rate: reported facts win (contract→user→org), else Nuke estimate. Thin authenticated data → explicit SPITBALL (~$160), never a stated market rate. Carries rate_confidence + authenticated_sample_n + posted-vs-accepted caveat.';

-- ── 2 & 3 NOTE ────────────────────────────────────────────────────────────────
-- get_vehicle_documented_investment and compute_vehicle_investment_proof were also
-- updated this session to draw their labor rate from resolve_labor_rate (above) and
-- carry rate_confidence='spitball' in their DNA / projected-labor confidence. Their
-- full bodies live in prod and in migrations 20260623060000 (proof burst basis) +
-- the apply_migration history; this file is authoritative for resolve_labor_rate,
-- the new shared rate engine both consume. Re-sync via pg_get_functiondef if drift.
