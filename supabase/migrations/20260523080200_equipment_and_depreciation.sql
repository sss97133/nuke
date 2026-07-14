-- 20260523080200_equipment_and_depreciation.sql
--
-- Equipment ledger + per-photo equipment-usage atoms.
-- Per docs/library/reference/encyclopedia/05-image-as-butterfly-node.md (How it depreciates assets),
-- every tool visible in a photo decrements its useful-life-remaining. Equipment depreciation feeds
-- the overhead_floor in the shop's labor-rate equation.
--
-- Skylar's $85/hr claimed rate would split into ~$15/hr equipment recovery + $50/hr labor +
-- $20/hr other overhead — but only when this ledger is populated.

CREATE TABLE IF NOT EXISTS public.equipment (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                     UUID,  -- references organizations(id) but no FK to avoid coupling
  name                        TEXT NOT NULL,
  category                    TEXT,  -- 'lift', 'welder', 'paint_booth', 'compressor', 'hand_tool', 'diagnostic', ...
  manufacturer                TEXT,
  model                       TEXT,
  serial_number               TEXT,
  purchase_date               DATE,
  purchase_cost               NUMERIC(10,2),
  est_useful_life_hours       NUMERIC(10,1),  -- e.g. 10000 hours for a 2-post lift
  est_useful_life_years       NUMERIC(5,1),   -- alt unit
  hours_used_observed         NUMERIC(10,1) DEFAULT 0,  -- accumulated from photo evidence × est minutes_per_use
  hours_used_last_computed_at TIMESTAMPTZ,
  current_value_computed      NUMERIC(10,2) GENERATED ALWAYS AS (
    GREATEST(0,
      COALESCE(purchase_cost, 0) * (1 - COALESCE(hours_used_observed, 0) / NULLIF(est_useful_life_hours, 0))
    )
  ) STORED,
  status                      TEXT DEFAULT 'in_service' CHECK (status IN ('in_service','retired','for_sale','broken','sold')),
  notes                       TEXT,
  source                      TEXT,  -- 'manual_entry', 'photo_cascade_inferred', 'receipt_ocr'
  created_at                  TIMESTAMPTZ DEFAULT now(),
  updated_at                  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_shop ON public.equipment(shop_id);
CREATE INDEX IF NOT EXISTS idx_equipment_category ON public.equipment(category);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON public.equipment(status);

-- Per-photo equipment-visible evidence (the cascade atom)
CREATE TABLE IF NOT EXISTS public.equipment_usage_evidence (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id                UUID REFERENCES public.equipment(id) ON DELETE CASCADE,
  derived_from_image_id       UUID,  -- references vehicle_images(id), nullable for non-vehicle photos
  vehicle_id                  UUID,  -- the vehicle being worked on with this equipment (if any)
  technician_id               UUID,  -- the technician using it (if visible)
  observed_at                 TIMESTAMPTZ NOT NULL,
  use_context                 TEXT,  -- 'mounted_on_lift', 'welding_session', 'paint_application', ...
  estimated_use_minutes       INT DEFAULT 60,  -- conservative: photo presence = ~1hr use
  visible_state               TEXT,  -- 'in_use', 'idle', 'stored'
  notes                       TEXT,
  source_method               TEXT,
  confidence                  NUMERIC(3,2),
  created_at                  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (equipment_id, derived_from_image_id)
);

CREATE INDEX IF NOT EXISTS idx_eu_evidence_equipment ON public.equipment_usage_evidence(equipment_id);
CREATE INDEX IF NOT EXISTS idx_eu_evidence_observed ON public.equipment_usage_evidence(observed_at DESC);

-- Consumables (gloves, brake cleaner, zip ties, etc.) — inventory decrements
CREATE TABLE IF NOT EXISTS public.consumables (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                     UUID,
  name                        TEXT NOT NULL,
  category                    TEXT,  -- 'ppe', 'cleaning', 'fastener', 'adhesive', 'lubricant', ...
  unit_of_measure             TEXT,  -- 'pair', 'each', 'oz', 'tube'
  reorder_level               INT,
  current_stock_estimate      INT,  -- decrements from photo-evidence consumption events
  cost_per_unit               NUMERIC(8,2),
  preferred_vendor_id         UUID,  -- references organizations(id), nullable
  notes                       TEXT,
  created_at                  TIMESTAMPTZ DEFAULT now(),
  updated_at                  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consumables_shop ON public.consumables(shop_id);

GRANT SELECT ON public.equipment TO anon, authenticated;
GRANT SELECT ON public.equipment_usage_evidence TO anon, authenticated;
GRANT SELECT ON public.consumables TO anon, authenticated;

COMMENT ON TABLE public.equipment IS 'Shop equipment ledger. current_value_computed depreciates from purchase_cost × (1 - hours_used_observed / est_useful_life_hours). hours_used_observed is accumulated from equipment_usage_evidence rows (photo-derived). See encyclopedia chapter 05 "How it depreciates assets".';

COMMENT ON TABLE public.equipment_usage_evidence IS 'Per-photo equipment-visible atoms. The cascade target for "tool X is visible in photo Y → +1 use-evidence". Aggregated to update equipment.hours_used_observed.';

COMMENT ON TABLE public.consumables IS 'Consumable inventory. Photo cascade decrements current_stock_estimate (e.g. each nitrile glove pair observed = -1).';
