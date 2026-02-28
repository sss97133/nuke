-- ============================================================
-- PURCHASE ORDERS — Auto-order parts when invoice is sent
-- Groups parts by supplier, tracks order → ship → deliver
-- ============================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES generated_invoices(id),
  supplier_name text NOT NULL,
  supplier_url text,
  supplier_account_id text,
  supplier_contact_email text,
  supplier_contact_phone text,
  po_number text NOT NULL,
  po_date timestamptz DEFAULT now(),
  subtotal numeric(10,2) DEFAULT 0,
  tax_estimate numeric(10,2) DEFAULT 0,
  shipping_estimate numeric(10,2) DEFAULT 0,
  total_estimate numeric(10,2) DEFAULT 0,
  status text DEFAULT 'pending_approval'
    CHECK (status IN (
      'pending_approval','approved','submitted','confirmed',
      'partial_shipped','shipped','partial_delivered','delivered',
      'installed','cancelled','returned'
    )),
  order_method text DEFAULT 'manual'
    CHECK (order_method IN ('api', 'email', 'browser', 'phone', 'manual')),
  order_confirmation text,
  tracking_numbers text[],
  estimated_delivery date,
  actual_delivery date,
  ship_to_name text,
  ship_to_address text,
  ship_to_phone text,
  auto_ordered boolean DEFAULT false,
  auto_order_trigger text,
  buy_urls text[],
  notes text,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  work_order_part_id uuid REFERENCES work_order_parts(id),
  part_name text NOT NULL,
  part_number text,
  brand text,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(10,2),
  total_price numeric(10,2),
  buy_url text,
  status text DEFAULT 'pending'
    CHECK (status IN ('pending','ordered','backordered','shipped','delivered','installed','returned','cancelled')),
  tracking_number text,
  estimated_delivery date,
  actual_delivery date,
  received_by uuid,
  received_at timestamptz,
  installed_at timestamptz,
  installed_by uuid,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name text NOT NULL UNIQUE,
  supplier_url text,
  account_number text,
  account_email text,
  api_enabled boolean DEFAULT false,
  api_endpoint text,
  api_key_vault_ref text,
  order_method text DEFAULT 'manual'
    CHECK (order_method IN ('api', 'email', 'browser', 'phone', 'manual')),
  default_ship_method text,
  discount_tier text,
  discount_percentage numeric(5,2) DEFAULT 0,
  avg_delivery_days integer,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_work_order ON purchase_orders(work_order_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_name);
CREATE INDEX IF NOT EXISTS idx_poi_po ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_poi_part ON purchase_order_items(work_order_part_id);
CREATE INDEX IF NOT EXISTS idx_poi_status ON purchase_order_items(status);

INSERT INTO supplier_accounts (supplier_name, supplier_url, order_method, avg_delivery_days, notes) VALUES
  ('Summit Racing', 'https://www.summitracing.com', 'browser', 4, 'Primary parts supplier. Free ship >$109. Bilstein, SMP, hood shields.'),
  ('AutoZone', 'https://www.autozone.com', 'browser', 0, 'Window motors, brake parts. Same-day store pickup available.'),
  ('RockAuto', 'https://www.rockauto.com', 'browser', 5, 'Backup supplier. Good prices on Dorman parts.'),
  ('etrailer', 'https://www.etrailer.com', 'browser', 5, 'Carr hoop steps, towing accessories. Free ship >$99.'),
  ('RealTruck', 'https://www.realtruck.com', 'browser', 5, 'Truck accessories. Alternative for hoop steps.')
ON CONFLICT (supplier_name) DO NOTHING;
