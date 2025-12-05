-- ============================================
-- FLUID LABOR RATE SYSTEM
-- ============================================
-- Supports parallel calculations: reported rate vs. calculated rate
-- Adapts when user provides their rate
-- Enables "what if" scenarios with pluggable variables

-- ============================================
-- 1. FUNCTION: Resolve Labor Rate (Priority Order)
-- ============================================
CREATE OR REPLACE FUNCTION resolve_labor_rate(
  p_organization_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_vehicle_id UUID DEFAULT NULL,
  p_client_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_rate JSONB;
  v_contract_rate NUMERIC;
  v_user_rate NUMERIC;
  v_org_rate NUMERIC;
  v_system_default NUMERIC := 125.00; -- Market average fallback
  v_resolved_rate NUMERIC;
  v_source TEXT;
BEGIN
  -- Priority 1: Contract rate (highest priority)
  IF p_client_id IS NOT NULL AND p_organization_id IS NOT NULL THEN
    SELECT agreed_labor_rate INTO v_contract_rate
    FROM work_contracts
    WHERE client_id = p_client_id
      AND organization_id = p_organization_id
      AND status = 'active'
      AND (vehicle_id IS NULL OR vehicle_id = p_vehicle_id)
    ORDER BY vehicle_id NULLS LAST -- Vehicle-specific contracts first
    LIMIT 1;
    
    IF v_contract_rate IS NOT NULL THEN
      v_resolved_rate := v_contract_rate;
      v_source := 'contract';
    END IF;
  END IF;
  
  -- Priority 2: User labor rate (technician-level)
  IF v_resolved_rate IS NULL AND p_user_id IS NOT NULL THEN
    SELECT hourly_rate INTO v_user_rate
    FROM user_labor_rates
    WHERE user_id = p_user_id
      AND is_active = true
    ORDER BY created_at DESC
    LIMIT 1;
    
    IF v_user_rate IS NOT NULL THEN
      v_resolved_rate := v_user_rate;
      v_source := 'user';
    END IF;
  END IF;
  
  -- Priority 3: Organization rate (shop-level)
  IF v_resolved_rate IS NULL AND p_organization_id IS NOT NULL THEN
    SELECT labor_rate INTO v_org_rate
    FROM businesses
    WHERE id = p_organization_id;
    
    IF v_org_rate IS NOT NULL AND v_org_rate > 0 THEN
      v_resolved_rate := v_org_rate;
      v_source := 'organization';
    END IF;
  END IF;
  
  -- Priority 4: System default (market average)
  IF v_resolved_rate IS NULL THEN
    v_resolved_rate := v_system_default;
    v_source := 'system_default';
  END IF;
  
  -- Return resolved rate with metadata
  RETURN jsonb_build_object(
    'rate', v_resolved_rate,
    'source', v_source,
    'is_estimated', v_source = 'system_default',
    'is_user_reported', v_source IN ('contract', 'user', 'organization'),
    'contract_rate', v_contract_rate,
    'user_rate', v_user_rate,
    'org_rate', v_org_rate,
    'system_default', v_system_default
  );
END;
$$;

COMMENT ON FUNCTION resolve_labor_rate IS 'Resolves labor rate using priority: contract → user → org → system default. Returns rate with source metadata.';

-- ============================================
-- 2. FUNCTION: Calculate Labor Cost with Variables
-- ============================================
CREATE OR REPLACE FUNCTION calculate_labor_cost_fluid(
  p_hours NUMERIC,
  p_base_rate NUMERIC DEFAULT NULL,
  p_organization_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_vehicle_id UUID DEFAULT NULL,
  p_client_id UUID DEFAULT NULL,
  p_difficulty_multiplier NUMERIC DEFAULT 1.0,
  p_location_multiplier NUMERIC DEFAULT 1.0,
  p_time_multiplier NUMERIC DEFAULT 1.0,
  p_skill_multiplier NUMERIC DEFAULT 1.0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_rate_info JSONB;
  v_base_rate NUMERIC;
  v_reported_rate NUMERIC;
  v_calculated_rate NUMERIC;
  v_final_rate NUMERIC;
  v_base_cost NUMERIC;
  v_adjusted_cost NUMERIC;
  v_calculations JSONB;
BEGIN
  -- Resolve base rate
  v_rate_info := resolve_labor_rate(
    p_organization_id,
    p_user_id,
    p_vehicle_id,
    p_client_id
  );
  
  v_base_rate := COALESCE(p_base_rate, (v_rate_info->>'rate')::NUMERIC);
  v_reported_rate := v_base_rate;
  
  -- Calculate adjusted rate with multipliers
  v_calculated_rate := v_base_rate * p_difficulty_multiplier * p_location_multiplier * p_time_multiplier * p_skill_multiplier;
  
  -- Use reported rate if available, otherwise use calculated
  v_final_rate := CASE 
    WHEN (v_rate_info->>'is_user_reported')::BOOLEAN THEN v_reported_rate
    ELSE v_calculated_rate
  END;
  
  -- Calculate costs
  v_base_cost := p_hours * v_reported_rate;
  v_adjusted_cost := p_hours * v_final_rate;
  
  -- Build calculation breakdown
  v_calculations := jsonb_build_object(
    'hours', p_hours,
    'reported_rate', v_reported_rate,
    'calculated_rate', v_calculated_rate,
    'final_rate', v_final_rate,
    'rate_source', v_rate_info->>'source',
    'multipliers', jsonb_build_object(
      'difficulty', p_difficulty_multiplier,
      'location', p_location_multiplier,
      'time', p_time_multiplier,
      'skill', p_skill_multiplier,
      'total', p_difficulty_multiplier * p_location_multiplier * p_time_multiplier * p_skill_multiplier
    ),
    'costs', jsonb_build_object(
      'base_cost', v_base_cost,
      'adjusted_cost', v_adjusted_cost,
      'difference', v_adjusted_cost - v_base_cost,
      'percent_change', CASE WHEN v_base_cost > 0 THEN ((v_adjusted_cost - v_base_cost) / v_base_cost * 100) ELSE 0 END
    ),
    'is_estimated', (v_rate_info->>'is_estimated')::BOOLEAN,
    'is_user_reported', (v_rate_info->>'is_user_reported')::BOOLEAN
  );
  
  RETURN v_calculations;
END;
$$;

COMMENT ON FUNCTION calculate_labor_cost_fluid IS 'Calculates labor cost with fluid variables. Supports "what if" scenarios by plugging in different multipliers. Returns both reported and calculated costs.';

-- ============================================
-- 3. ENHANCE work_order_labor TABLE
-- ============================================
-- Add columns to store both reported and calculated rates
ALTER TABLE work_order_labor
ADD COLUMN IF NOT EXISTS reported_rate NUMERIC,
ADD COLUMN IF NOT EXISTS calculated_rate NUMERIC,
ADD COLUMN IF NOT EXISTS rate_source TEXT,
ADD COLUMN IF NOT EXISTS difficulty_multiplier NUMERIC DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS location_multiplier NUMERIC DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS time_multiplier NUMERIC DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS skill_multiplier NUMERIC DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS calculation_metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN work_order_labor.reported_rate IS 'Rate reported by organization/user (if available)';
COMMENT ON COLUMN work_order_labor.calculated_rate IS 'Rate calculated by system with multipliers';
COMMENT ON COLUMN work_order_labor.rate_source IS 'Source of rate: contract, user, organization, system_default';
COMMENT ON COLUMN work_order_labor.calculation_metadata IS 'Full calculation breakdown for "what if" scenarios';

-- ============================================
-- 4. VIEW: Labor Rate Comparison
-- ============================================
CREATE OR REPLACE VIEW labor_rate_comparison AS
SELECT 
  wol.id,
  wol.timeline_event_id,
  wol.task_name,
  wol.hours,
  wol.hourly_rate as current_rate,
  wol.reported_rate,
  wol.calculated_rate,
  wol.rate_source,
  CASE 
    WHEN wol.reported_rate IS NOT NULL THEN wol.reported_rate * wol.hours
    ELSE wol.hourly_rate * wol.hours
  END as reported_cost,
  CASE 
    WHEN wol.calculated_rate IS NOT NULL THEN wol.calculated_rate * wol.hours
    ELSE wol.hourly_rate * wol.hours
  END as calculated_cost,
  CASE 
    WHEN wol.reported_rate IS NOT NULL AND wol.calculated_rate IS NOT NULL 
    THEN (wol.calculated_rate - wol.reported_rate) * wol.hours
    ELSE NULL
  END as cost_difference,
  wol.calculation_metadata,
  te.vehicle_id,
  te.organization_id,
  te.event_date
FROM work_order_labor wol
JOIN timeline_events te ON te.id = wol.timeline_event_id;

COMMENT ON VIEW labor_rate_comparison IS 'Shows parallel calculations: reported rate vs. calculated rate for comparison and analytics';

-- ============================================
-- 5. FUNCTION: Update Labor Rate When Org Rate Changes
-- ============================================
CREATE OR REPLACE FUNCTION update_labor_rates_on_org_change()
RETURNS TRIGGER AS $$
BEGIN
  -- When organization labor_rate changes, update all related work_order_labor records
  -- that don't have a reported_rate yet (use calculated rates)
  IF TG_OP = 'UPDATE' AND OLD.labor_rate IS DISTINCT FROM NEW.labor_rate THEN
    UPDATE work_order_labor wol
    SET 
      hourly_rate = NEW.labor_rate,
      calculated_rate = NEW.labor_rate * 
        COALESCE(wol.difficulty_multiplier, 1.0) * 
        COALESCE(wol.location_multiplier, 1.0) * 
        COALESCE(wol.time_multiplier, 1.0) * 
        COALESCE(wol.skill_multiplier, 1.0),
      rate_source = 'organization',
      calculation_metadata = jsonb_build_object(
        'updated_at', NOW(),
        'previous_rate', OLD.labor_rate,
        'new_rate', NEW.labor_rate,
        'reason', 'organization_rate_updated'
      )
    FROM timeline_events te
    WHERE wol.timeline_event_id = te.id
      AND te.organization_id = NEW.id
      AND wol.reported_rate IS NULL; -- Only update if no user-reported rate
    
    RAISE NOTICE 'Updated labor rates for organization %: % records affected', NEW.id, ROW_COUNT;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trg_update_labor_rates_on_org_change ON businesses;
CREATE TRIGGER trg_update_labor_rates_on_org_change
  AFTER UPDATE OF labor_rate ON businesses
  FOR EACH ROW
  WHEN (OLD.labor_rate IS DISTINCT FROM NEW.labor_rate)
  EXECUTE FUNCTION update_labor_rates_on_org_change();

COMMENT ON FUNCTION update_labor_rates_on_org_change IS 'Automatically updates labor rates when organization rate changes, but preserves user-reported rates';

-- Fix trigger function to use correct table
CREATE OR REPLACE FUNCTION update_labor_rates_on_org_change()
RETURNS TRIGGER AS $$
BEGIN
  -- When organization labor_rate changes, update all related work_order_labor records
  -- that don't have a reported_rate yet (use calculated rates)
  IF TG_OP = 'UPDATE' AND (OLD.labor_rate IS NULL OR NEW.labor_rate IS NULL OR OLD.labor_rate IS DISTINCT FROM NEW.labor_rate) THEN
    UPDATE work_order_labor wol
    SET 
      hourly_rate = NEW.labor_rate,
      calculated_rate = NEW.labor_rate * 
        COALESCE(wol.difficulty_multiplier, 1.0) * 
        COALESCE(wol.location_multiplier, 1.0) * 
        COALESCE(wol.time_multiplier, 1.0) * 
        COALESCE(wol.skill_multiplier, 1.0),
      rate_source = 'organization',
      calculation_metadata = jsonb_build_object(
        'updated_at', NOW(),
        'previous_rate', OLD.labor_rate,
        'new_rate', NEW.labor_rate,
        'reason', 'organization_rate_updated'
      )
    FROM timeline_events te
    WHERE wol.timeline_event_id = te.id
      AND te.organization_id = NEW.id
      AND wol.reported_rate IS NULL; -- Only update if no user-reported rate
    
    RAISE NOTICE 'Updated labor rates for organization %: % records affected', NEW.id, ROW_COUNT;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

