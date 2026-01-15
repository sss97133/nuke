# ROI Backend Audit - Investment Summary

## Current Implementation Status

### ✅ What's Working

**Backend Function**: `get_vehicle_roi_summary(p_vehicle_id UUID)`
- **Location**: `supabase/migrations/20251214000030_roi_primitives.sql`
- **Status**: Deployed and functional
- **Returns**: JSONB with `spend`, `value`, and `roi` objects

### 📊 Data Sources

#### 1. **Spend (Attributed Costs)**
- **Table**: `spend_attributions`
- **Source**: Receipts → `attribute_receipt_to_work()` RPC
- **Categories Tracked**:
  - `parts` - Parts purchases
  - `labor` - Labor costs
  - `materials` - Materials
  - `tax` - Tax
  - `shipping` - Shipping costs
  - `overhead` - Overhead
  - `tools` - Tool costs
  - `fee` - Fees (generic)
  - `refund` - Refunds
  - `other` - Other costs

**Current Query**:
```sql
SELECT COALESCE(SUM(amount_cents), 0)
FROM spend_attributions
WHERE vehicle_id = p_vehicle_id
  AND direction = 'outflow'
```

#### 2. **Value (Current & Historical)**
- **Current Value**: `vehicles.current_value` (primary) or last `vehicle_price_history` entry
- **30d Ago Value**: `vehicle_price_history.as_of <= NOW() - INTERVAL '30 days'`
- **Delta**: `current_value - value_30d_ago`

#### 3. **ROI Calculation**
```sql
roi_30d = (value_delta_30d / attributed_spend_usd)
```
- Only calculated if `spend > 0` AND `value_delta_30d IS NOT NULL`

#### 4. **Event Value Impact**
- **Source**: `timeline_events.value_impact`
- Sum of all value impact estimates from timeline events

---

## ⚠️ Missing Cost Factors

### Currently NOT Tracked in `spend_attributions`:

1. **Consignment Fees**
   - Should be: `spend_category = 'fee'` with `metadata->>'fee_type' = 'consignment'`
   - **Action**: Create attribution when consignment relationship is established

2. **Photography Costs**
   - Should be: `spend_category = 'fee'` or `'overhead'` with `metadata->>'service' = 'photography'`
   - **Action**: Track when images are uploaded/processed (could auto-create from image upload events)

3. **Listing Fees**
   - Should be: `spend_category = 'fee'` with `metadata->>'fee_type' = 'listing'`
   - **Action**: Track when `vehicle_listings` are created (BaT, Cars & Bids, etc.)

4. **Storage Costs**
   - Should be: `spend_category = 'overhead'` with `metadata->>'cost_type' = 'storage'`
   - **Action**: Monthly attribution based on vehicle ownership period

5. **Platform Costs (AI Analysis, etc.)**
   - Currently: Only image analysis costs are tracked (in `gpt_usage_logs`)
   - **Action**: Link `gpt_usage_logs` to `spend_attributions` for vehicle-specific AI costs

---

## 🔧 Recommended Fixes

### 1. **Auto-Create Attributions for Common Costs**

```sql
-- Example: Auto-track listing fees when auction is created
CREATE OR REPLACE FUNCTION auto_attribute_listing_fee()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sale_type IN ('auction', 'live_auction') THEN
    INSERT INTO spend_attributions (
      vehicle_id,
      direction,
      amount_cents,
      spend_category,
      metadata
    ) VALUES (
      NEW.vehicle_id,
      'outflow',
      5000, -- $50 default listing fee (should be configurable)
      'fee',
      jsonb_build_object('fee_type', 'listing', 'listing_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 2. **Link Image Processing Costs**

```sql
-- Link GPT usage to vehicle via image analysis
UPDATE spend_attributions sa
SET vehicle_id = vi.vehicle_id
FROM vehicle_images vi
WHERE sa.metadata->>'source' = 'gpt_usage'
  AND sa.metadata->>'image_id' = vi.id::text;
```

### 3. **Monthly Storage Attribution**

```sql
-- Create monthly storage cost attribution
CREATE OR REPLACE FUNCTION attribute_monthly_storage(p_vehicle_id UUID, p_month DATE)
RETURNS UUID AS $$
DECLARE
  v_storage_rate_cents BIGINT := 5000; -- $50/month default
  v_attribution_id UUID;
BEGIN
  INSERT INTO spend_attributions (
    vehicle_id,
    direction,
    amount_cents,
    spend_category,
    metadata,
    created_by
  ) VALUES (
    p_vehicle_id,
    'outflow',
    v_storage_rate_cents,
    'overhead',
    jsonb_build_object('cost_type', 'storage', 'month', p_month),
    (SELECT user_id FROM vehicles WHERE id = p_vehicle_id)
  )
  RETURNING id INTO v_attribution_id;
  RETURN v_attribution_id;
END;
$$ LANGUAGE plpgsql;
```

---

## 📈 Current ROI Calculation Logic

```sql
-- From get_vehicle_roi_summary:
roi_30d = CASE
  WHEN v_spend_usd IS NULL OR v_spend_usd <= 0 OR v_value_delta_30d IS NULL 
    THEN NULL
  ELSE (v_value_delta_30d / v_spend_usd)
END;
```

**Issues**:
- Only calculates if `spend > 0` (won't show ROI if no costs attributed yet)
- Requires 30d price history (won't work for new vehicles)
- Doesn't account for time-weighted costs (older costs should matter less)

---

## ✅ Verification Checklist

- [x] Backend function exists and is callable
- [x] `spend_attributions` table exists with proper RLS
- [x] Receipt attribution workflow exists (`attribute_receipt_to_work`)
- [ ] Consignment fees are tracked
- [ ] Photography costs are tracked
- [ ] Listing fees are tracked
- [ ] Storage costs are tracked
- [ ] AI/Platform costs are linked to vehicles
- [ ] ROI calculation handles edge cases (zero spend, no history)

---

## 🎯 Next Steps

1. **Immediate**: Verify ROI function works for vehicles with receipts
2. **Short-term**: Add auto-attribution triggers for listing fees, photography
3. **Medium-term**: Link GPT usage logs to vehicle spend
4. **Long-term**: Implement time-weighted ROI (older costs depreciate)

---

## 💡 Key Insight

**"There are always costs"** - Even if a vehicle has no receipts yet, there are implicit costs:
- Time spent creating the profile
- Platform resources (storage, bandwidth)
- Photography/listing preparation
- Opportunity cost of capital

**Recommendation**: Add a "minimum cost basis" estimate (e.g., $100-500) for vehicles with zero attributed spend, so ROI calculations can run even for new vehicles.
