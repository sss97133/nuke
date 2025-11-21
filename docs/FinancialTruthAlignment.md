## Financial Alignment Plan – VIFF ➜ Valuations ➜ Financial Products

### Why financials broke
- `ValuationEngine` scrapes receipts, timeline events, and `vehicle_images` ad hoc, so it frequently runs with incomplete or contradictory data.
- Financial UI (`VisualValuationBreakdown`, `FinancialProducts`) isn’t tied to image-derived facts, so it guesses at values and confidence.
- There is no gating—scripts run even when VIN, purchase price, or odometer evidence is missing, producing “shotty” outputs.

---

### Target Architecture

```
VIFF (Facts + Confidence)
        │
        ├── Evidence Builder (new) → vehicle_valuations_components
        │           │
        │           └── VisualValuationBreakdown UI (truth-only)
        │
        └── Financial Readiness Engine
                     │
                     ├── FinancialProducts (financing, insurance)
                     └── Commerce CTAs (listings, offers)
```

---

### Data Contracts

1. **`vehicle_valuations_components` (existing)**
   - Expand columns: `fact_id`, `fact_confidence`, `evidence_urls`, `component_condition`, `valuation_source` (`viff`, `manual`, `legacy_engine`).
   - Enforce `NOT NULL fact_id` for any component created by AI; manual overrides can store `NULL` but must include `created_by`.

2. **`vehicle_valuations`**
   - Add `evidence_score` (0-100) sourced from VIFF coverage.
   - Add `required_evidence` jsonb (list of blockers, e.g., `vin_photo_missing`).
   - Add `source_run_id` referencing `vehicle_fact_runs`.

3. **`financial_readiness_snapshots` (new)**
   - Stores the evaluation used by `FinancialProducts`:
     - `vehicle_id`, `valuation_id`, `readiness_score`, `missing_items` array, `last_checked_at`.
   - Allows UI to show “This vehicle is ready for financing” or “Upload odometer photo”.

---

### Flow

1. **Fact ingestion**
   - VIFF generates `vehicle_image_facts` + `image_fact_confidence`.
   - When confidence for `fact_type in ('component','document','damage')` passes thresholds, trigger stored procedure `promote_facts_to_components(vehicle_id uuid)`.

2. **Evidence Builder (new service)**
   - Inputs: high-confidence facts + linked receipts/labor events.
   - Outputs:
     - `vehicle_valuations_components` rows describing each documented part/damage, including `fact_id`, `estimated_value`, `supporting_receipts`.
     - Aggregated metrics (documented investments, deductions for damage).
   - Implementation options:
     - Supabase SQL function + `net.http_post` to `vehicle-image-analyst`, or
     - Edge Function invoked by cron to recompute if new facts arrive.

3. **Truth-based valuation**
   - Replace direct `ValuationEngine.calculateValuation` usage with:
     - `useValuationIntel` hook calling RPC `get_vehicle_truth_based_valuation(vehicle_id uuid)`, which simply selects latest `vehicle_valuations` row (populated by Evidence Builder).
     - `ValuationEngine` remains only as fallback/backfill tool when VIFF data absent; UI labels it “Legacy (no photo evidence)” and blocks FinancialProducts.

4. **Financial readiness**
   - Procedure `evaluate_financial_readiness(vehicle_id uuid)`:
     1. Validate required facts: VIN proven, odometer within 90 days, title photo, purchase price, receipts for >50% of investments, no unresolved damage.
     2. Compute `readiness_score` (0-100) with weighted components.
     3. Store snapshot + emit event `financial_readiness_updated`.
   - `FinancialProducts` subscribes to this state; if score < 70, show blockers instead of arbitrary offers.

5. **UI updates**
   - `VisualValuationBreakdown` reads `vehicle_valuations_components` joined with `image_fact_links` to show exact photo evidence and guardrail question references.
   - Each value row includes:
     - Component name.
     - `fact_confidence` badge.
     - Buttons: “View photos”, “View receipts”, “Send to buyer”.
   - Narrative + 5W summary pulled from `vehicle_fact_runs` output.

6. **FinancialProducts integration**
   - Adds `props`:
     ```ts
     interface FinancialProductsProps {
       vehicleId: string;
       readinessScore: number;
       missingItems: string[];
       valuation: { estimatedValue: number; confidence: number; purchaseFloor: number };
     }
     ```
   - Module disables actions until readiness ≥ 70 and highlights missing evidence (clicking opens Evidence Drawer filters).

---

### Required Backend Work

1. **Migrations**
   - Modify `vehicle_valuations` & `vehicle_valuations_components` as noted.
   - Create `financial_readiness_snapshots` table.
   - Provide shims for resets.

2. **Stored Procedures / Functions**
   - `promote_facts_to_components(vehicle_id uuid)` – merges VIFF facts with receipts/labor to update valuation components.
   - `evaluate_financial_readiness(vehicle_id uuid)` – calculates readiness and writes snapshot.
   - `get_vehicle_truth_based_valuation(vehicle_id uuid)` – returns combined valuation + readiness payload for frontend.

3. **Edge Functions**
   - Update `vehicle-expert-agent` to rely on VIFF data:
     - Pull high-confidence facts.
     - Score each component.
     - Write valuations + readiness snapshot.
   - Add tests verifying that missing required evidence prevents valuations from updating.

4. **Instrumentation**
   - Log `valuation_run` events with:
     - Input fact counts.
     - Confidence distribution.
     - Reasons when valuations skipped (lack of VIN, etc.).
   - Add dashboard query to check mismatches between facts and valuations.

---

### Frontend Changes

1. **Hooks**
   - `useValuationIntel(vehicleId)` returns `{ valuation, readiness, blockers }`.
   - `useFinancialActions(vehicleId)` determines which CTAs to enable.

2. **Components**
   - `VisualValuationBreakdown` rewrite:
     - Accepts `valuation` object (no internal Supabase queries).
     - Each component card references `fact_id` so clicking opens Fact Explorer scoped to that evidence.
   - `FinancialProducts` displays readiness progress, not random APR numbers.

3. **Error handling**
   - When valuations unavailable, show actionable message with button “Capture VIN photo” or “Upload odometer” that opens Evidence Drawer pre-filtered.

---

### Deployment / Verification

1. Deploy schema + functions (`vercel --prod --force --yes` to keep production-first workflow once code lands).
2. Run backfill script to migrate existing `vehicle_valuations*` rows:
   - Map each legacy line item to placeholder `fact_id = NULL` but mark `valuation_source='legacy'`.
   - Encourage users to re-upload photos so VIFF data replaces placeholders over time.
3. Validate production by:
   - Uploading a photo → verifying `vehicle_facts_updated` event.
   - Ensuring valuations/financial modules stay disabled until confidence threshold hit.
   - Checking `FinancialProducts` now reads real data and quotes align with facts.

Once this alignment ships, the finance stack stops “shooting out arbitrary numbers” because every calculation is backed by VIFF facts, enforced guardrails, and explicit readiness gates.

