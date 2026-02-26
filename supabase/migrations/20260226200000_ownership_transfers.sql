-- ============================================================================
-- OWNERSHIP TRANSFERS
-- Tracks the full lifecycle of a vehicle title changing hands.
-- Triggered by an auction end, listing sale, or private deal.
-- Progresses through ordered milestones (agreement → payment → title → done).
-- Each milestone can carry evidence documents and communications.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------

CREATE TYPE transfer_trigger_type AS ENUM (
  'auction',
  'listing',
  'private_sale',
  'inheritance',
  'gift'
);

CREATE TYPE transfer_status AS ENUM (
  'pending',        -- triggered but not yet acknowledged by both parties
  'in_progress',    -- active, milestones being completed
  'completed',      -- title received, ownership confirmed
  'cancelled',      -- deal fell through before completion
  'disputed'        -- flagged by either party
);

CREATE TYPE milestone_type AS ENUM (
  'agreement_reached',
  'contact_exchanged',
  'discussion_complete',
  'contract_drafted',
  'contract_signed_seller',
  'contract_signed_buyer',
  'deposit_triggered',
  'deposit_sent',
  'deposit_received',
  'deposit_confirmed',
  'full_payment_triggered',
  'full_payment_sent',
  'full_payment_received',
  'payment_confirmed',
  'obligations_defined',
  'obligation_met',
  'inspection_scheduled',
  'inspection_live',
  'inspection_completed',
  'insurance_triggered',
  'insurance_confirmed',
  'title_sent',
  'title_in_transit',
  'title_received',
  'shipping_requested',
  'shipping_initiated',
  'vehicle_arrived',
  'transfer_complete'
);

CREATE TYPE milestone_status AS ENUM (
  'pending',
  'in_progress',
  'completed',
  'skipped',
  'blocked',
  'overdue'
);

CREATE TYPE transfer_document_type AS ENUM (
  'contract',
  'title',
  'deposit_confirmation',
  'payment_confirmation',
  'insurance_certificate',
  'inspection_report',
  'bill_of_sale',
  'odometer_disclosure',
  'lien_release',
  'other'
);

CREATE TYPE transfer_document_source AS ENUM (
  'upload',
  'email_parse',
  'ocr',
  'api'
);

CREATE TYPE communication_source AS ENUM (
  'email',
  'sms',
  'platform_message',
  'phone_log'
);

CREATE TYPE communication_direction AS ENUM (
  'inbound',
  'outbound',
  'internal'
);

CREATE TYPE payment_type AS ENUM (
  'deposit',
  'full_payment',
  'escrow_release',
  'refund'
);

CREATE TYPE payment_status AS ENUM (
  'pending',
  'initiated',
  'sent',
  'received',
  'confirmed',
  'failed',
  'reversed'
);

CREATE TYPE payment_method AS ENUM (
  'wire',
  'check',
  'ach',
  'zelle',
  'escrow',
  'crypto',
  'cash',
  'other'
);

CREATE TYPE obligation_party AS ENUM (
  'seller',
  'buyer'
);

CREATE TYPE obligation_status AS ENUM (
  'pending',
  'completed',
  'waived',
  'disputed'
);

CREATE TYPE shipping_status AS ENUM (
  'pending',
  'quoted',
  'booked',
  'picked_up',
  'in_transit',
  'delivered',
  'failed'
);

-- ----------------------------------------------------------------------------
-- ownership_transfers
-- Top-level record for a single title transfer event.
-- ----------------------------------------------------------------------------

CREATE TABLE public.ownership_transfers (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id              uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,

  -- Parties (Nuke users when available, external identities otherwise)
  from_user_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  to_user_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  from_identity_id        uuid REFERENCES public.external_identities(id) ON DELETE SET NULL,
  to_identity_id          uuid REFERENCES public.external_identities(id) ON DELETE SET NULL,

  -- What triggered this transfer
  trigger_type            transfer_trigger_type NOT NULL,
  trigger_id              uuid,       -- auction_events.id or external_listings.id, untyped FK
  trigger_table           text,       -- 'auction_events' | 'external_listings' | null

  -- Financial terms
  agreed_price            numeric(12,2),
  currency                text NOT NULL DEFAULT 'USD',

  -- Status
  status                  transfer_status NOT NULL DEFAULT 'pending',

  -- Key timestamps
  sale_date               timestamptz,      -- when deal was struck
  completed_at            timestamptz,      -- title received = legal transfer done
  cancelled_at            timestamptz,
  stalled_at              timestamptz,      -- set by background job on inactivity
  last_milestone_at       timestamptz,      -- updated whenever a milestone completes

  -- Privacy: public sees only vague status + elapsed time
  public_visibility       text NOT NULL DEFAULT 'vague'
                            CHECK (public_visibility IN ('vague', 'detailed', 'hidden')),

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ownership_transfers IS 'One record per vehicle title transfer event. Tracks the full lifecycle from deal struck to title received.';
COMMENT ON COLUMN public.ownership_transfers.trigger_id IS 'FK to auction_events.id or external_listings.id — table identified by trigger_table column.';
COMMENT ON COLUMN public.ownership_transfers.stalled_at IS 'Set by background job when no milestone activity for 7+ days while status=in_progress.';
COMMENT ON COLUMN public.ownership_transfers.public_visibility IS 'Controls what non-party viewers see: vague=status+elapsed only, detailed=full timeline, hidden=nothing.';

CREATE INDEX idx_ownership_transfers_vehicle ON public.ownership_transfers(vehicle_id);
CREATE INDEX idx_ownership_transfers_from_user ON public.ownership_transfers(from_user_id) WHERE from_user_id IS NOT NULL;
CREATE INDEX idx_ownership_transfers_to_user ON public.ownership_transfers(to_user_id) WHERE to_user_id IS NOT NULL;
CREATE INDEX idx_ownership_transfers_status ON public.ownership_transfers(status) WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX idx_ownership_transfers_trigger ON public.ownership_transfers(trigger_table, trigger_id) WHERE trigger_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- transfer_milestones
-- Ordered progress steps within a transfer.
-- ----------------------------------------------------------------------------

CREATE TABLE public.transfer_milestones (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id             uuid NOT NULL REFERENCES public.ownership_transfers(id) ON DELETE CASCADE,

  sequence                int NOT NULL,           -- render/progress order
  milestone_type          milestone_type NOT NULL,
  status                  milestone_status NOT NULL DEFAULT 'pending',
  required                bool NOT NULL DEFAULT true,

  -- Timing
  deadline_at             timestamptz,            -- from contract or standard practice
  completed_at            timestamptz,
  completed_by_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Evidence
  evidence_id             uuid,                   -- FK to transfer_documents.id (set after insert)

  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (transfer_id, sequence),
  UNIQUE (transfer_id, milestone_type)  -- one of each type per transfer
);

COMMENT ON TABLE public.transfer_milestones IS 'Ordered progress steps for an ownership transfer. Sequence determines display order in the progress bar.';
COMMENT ON COLUMN public.transfer_milestones.required IS 'false = conditional step (e.g. shipping may not apply to local pickup deals).';

CREATE INDEX idx_transfer_milestones_transfer ON public.transfer_milestones(transfer_id);
CREATE INDEX idx_transfer_milestones_status ON public.transfer_milestones(status) WHERE status NOT IN ('completed', 'skipped');
CREATE INDEX idx_transfer_milestones_deadline ON public.transfer_milestones(deadline_at) WHERE deadline_at IS NOT NULL AND status NOT IN ('completed', 'skipped');

-- ----------------------------------------------------------------------------
-- transfer_documents
-- Every document associated with a transfer (contracts, title, receipts, etc.)
-- ----------------------------------------------------------------------------

CREATE TABLE public.transfer_documents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id             uuid NOT NULL REFERENCES public.ownership_transfers(id) ON DELETE CASCADE,
  milestone_id            uuid REFERENCES public.transfer_milestones(id) ON DELETE SET NULL,

  document_type           transfer_document_type NOT NULL,
  source                  transfer_document_source NOT NULL DEFAULT 'upload',

  -- Storage
  url                     text,
  storage_path            text,       -- Supabase storage path

  -- Provenance
  uploaded_by_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ocr_queue_id            uuid,       -- FK to document_ocr_queue.id if being parsed

  -- Verification
  verified                bool NOT NULL DEFAULT false,
  verified_at             timestamptz,
  verified_by_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Extracted fields from OCR / AI parsing
  -- e.g. { "price": 31000, "buyer_name": "DGranholm", "vin": "1GTGK24M1DJ514592", "date": "2026-02-22" }
  metadata                jsonb NOT NULL DEFAULT '{}',

  created_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.transfer_documents IS 'Documents attached to a transfer or specific milestone. Source field tracks how it arrived (upload, email parse, OCR pipeline, API).';
COMMENT ON COLUMN public.transfer_documents.metadata IS 'AI/OCR extracted fields: price, party names, VIN, dates, etc. Schema varies by document_type.';

CREATE INDEX idx_transfer_documents_transfer ON public.transfer_documents(transfer_id);
CREATE INDEX idx_transfer_documents_milestone ON public.transfer_documents(milestone_id) WHERE milestone_id IS NOT NULL;
CREATE INDEX idx_transfer_documents_type ON public.transfer_documents(transfer_id, document_type);

-- Now that transfer_documents exists, add the FK from transfer_milestones.evidence_id
ALTER TABLE public.transfer_milestones
  ADD CONSTRAINT fk_milestone_evidence
  FOREIGN KEY (evidence_id) REFERENCES public.transfer_documents(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- transfer_communications
-- Email threads, texts, platform messages parsed and linked to a transfer.
-- ----------------------------------------------------------------------------

CREATE TABLE public.transfer_communications (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id             uuid NOT NULL REFERENCES public.ownership_transfers(id) ON DELETE CASCADE,

  source                  communication_source NOT NULL,
  direction               communication_direction NOT NULL,

  from_address            text,
  to_address              text,
  subject                 text,
  body_text               text,

  received_at             timestamptz,

  -- AI-extracted signals: { "amount_mentioned": 31000, "intent": "payment_confirmation", "party": "buyer" }
  parsed_events           jsonb NOT NULL DEFAULT '{}',

  -- If this communication directly advances a milestone
  linked_milestone_id     uuid REFERENCES public.transfer_milestones(id) ON DELETE SET NULL,

  created_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.transfer_communications IS 'Emails, texts, and messages parsed and linked to a transfer. parsed_events holds AI-extracted signals (amounts, intent, party names).';

CREATE INDEX idx_transfer_comms_transfer ON public.transfer_communications(transfer_id);
CREATE INDEX idx_transfer_comms_received ON public.transfer_communications(transfer_id, received_at);

-- ----------------------------------------------------------------------------
-- transfer_payments
-- Individual payment records (deposit, full payment, etc.)
-- ----------------------------------------------------------------------------

CREATE TABLE public.transfer_payments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id             uuid NOT NULL REFERENCES public.ownership_transfers(id) ON DELETE CASCADE,
  milestone_id            uuid REFERENCES public.transfer_milestones(id) ON DELETE SET NULL,

  payment_type            payment_type NOT NULL,
  amount                  numeric(12,2) NOT NULL,
  currency                text NOT NULL DEFAULT 'USD',

  status                  payment_status NOT NULL DEFAULT 'pending',
  method                  payment_method,

  reference               text,       -- wire confirmation #, check #, etc.

  initiated_by_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  initiated_at            timestamptz,
  received_at             timestamptz,
  confirmed_at            timestamptz,

  metadata                jsonb NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.transfer_payments IS 'Payment records within a transfer. Multiple payments possible (deposit + balance). reference holds wire/check confirmation numbers.';

CREATE INDEX idx_transfer_payments_transfer ON public.transfer_payments(transfer_id);
CREATE INDEX idx_transfer_payments_status ON public.transfer_payments(status) WHERE status NOT IN ('confirmed', 'reversed');

-- ----------------------------------------------------------------------------
-- transfer_obligations
-- Contractual obligations one party owes the other (oil change, detailing, etc.)
-- ----------------------------------------------------------------------------

CREATE TABLE public.transfer_obligations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id             uuid NOT NULL REFERENCES public.ownership_transfers(id) ON DELETE CASCADE,

  obligated_party         obligation_party NOT NULL,
  description             text NOT NULL,

  status                  obligation_status NOT NULL DEFAULT 'pending',
  deadline_at             timestamptz,
  completed_at            timestamptz,

  evidence_id             uuid REFERENCES public.transfer_documents(id) ON DELETE SET NULL,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.transfer_obligations IS 'Contractual obligations within a transfer. Each row is one obligation (e.g. "seller changes oil before delivery"). Obligations block transfer_complete milestone.';

CREATE INDEX idx_transfer_obligations_transfer ON public.transfer_obligations(transfer_id);
CREATE INDEX idx_transfer_obligations_status ON public.transfer_obligations(status) WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- transfer_shipping
-- Shipping/logistics record (one per transfer, if applicable)
-- ----------------------------------------------------------------------------

CREATE TABLE public.transfer_shipping (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id             uuid NOT NULL REFERENCES public.ownership_transfers(id) ON DELETE CASCADE,

  carrier                 text,
  tracking_number         text,

  from_address            jsonb,      -- { street, city, state, zip, country }
  to_address              jsonb,

  quoted_at               timestamptz,
  initiated_at            timestamptz,
  estimated_delivery      timestamptz,
  actual_delivery         timestamptz,

  status                  shipping_status NOT NULL DEFAULT 'pending',

  metadata                jsonb NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.transfer_shipping IS 'Shipping/transport record for a transfer. One per transfer. Drives the shipping_initiated and vehicle_arrived milestones.';

CREATE INDEX idx_transfer_shipping_transfer ON public.transfer_shipping(transfer_id);
CREATE INDEX idx_transfer_shipping_status ON public.transfer_shipping(status) WHERE status NOT IN ('delivered', 'failed');

-- ----------------------------------------------------------------------------
-- transfer_inspections
-- Live or scheduled inspections (seller-initiated phone inspection, pre-delivery, etc.)
-- ----------------------------------------------------------------------------

CREATE TABLE public.transfer_inspections (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id             uuid NOT NULL REFERENCES public.ownership_transfers(id) ON DELETE CASCADE,
  milestone_id            uuid REFERENCES public.transfer_milestones(id) ON DELETE SET NULL,

  inspector_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  inspection_type         text NOT NULL CHECK (inspection_type IN ('pre_sale', 'post_sale', 'delivery', 'live')),
  method                  text NOT NULL CHECK (method IN ('in_person', 'remote_video', 'phone')),

  status                  text NOT NULL DEFAULT 'scheduled'
                            CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),

  scheduled_at            timestamptz,
  started_at              timestamptz,
  completed_at            timestamptz,

  -- For live video inspection sessions (Nuke Live integration)
  session_id              text,
  stream_url              text,

  report_document_id      uuid REFERENCES public.transfer_documents(id) ON DELETE SET NULL,

  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.transfer_inspections IS 'Inspection events within a transfer. Includes live video inspections triggered at contract signature (seller uses phone, buyer watches remotely).';

CREATE INDEX idx_transfer_inspections_transfer ON public.transfer_inspections(transfer_id);

-- ----------------------------------------------------------------------------
-- vehicles table additions
-- Two columns that link a vehicle to its active/most recent transfer.
-- ----------------------------------------------------------------------------

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS current_transfer_id   uuid REFERENCES public.ownership_transfers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ownership_confirmed_at timestamptz;

COMMENT ON COLUMN public.vehicles.current_transfer_id IS 'FK to ownership_transfers. Non-null while a transfer is in_progress. Drives the TRANSFER PENDING badge in the vehicle header. Owned by ownership transfer system — do not write directly.';
COMMENT ON COLUMN public.vehicles.ownership_confirmed_at IS 'Timestamp of most recent completed title transfer (transfer_complete milestone). Represents legal ownership confirmation date.';

CREATE INDEX idx_vehicles_current_transfer ON public.vehicles(current_transfer_id) WHERE current_transfer_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- pipeline_registry entries
-- Document the new columns so agents don't write to them directly.
-- ----------------------------------------------------------------------------

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES
  ('vehicles', 'current_transfer_id',    'ownership-transfer-system', 'Active transfer FK. Set when transfer starts, cleared when completed or cancelled.', true,  'ownership_transfers table — set via transfer lifecycle functions'),
  ('vehicles', 'ownership_confirmed_at', 'ownership-transfer-system', 'Timestamp of last confirmed title transfer. Set when transfer_complete milestone fires.', true, 'ownership_transfers table — set when transfer status → completed')
ON CONFLICT (table_name, column_name) DO UPDATE
  SET owned_by = EXCLUDED.owned_by,
      description = EXCLUDED.description,
      do_not_write_directly = EXCLUDED.do_not_write_directly,
      write_via = EXCLUDED.write_via;

-- ----------------------------------------------------------------------------
-- RLS
-- Parties to a transfer see full detail.
-- Public sees only non-sensitive fields when public_visibility = 'detailed'.
-- Admins (service role) see everything.
-- ----------------------------------------------------------------------------

ALTER TABLE public.ownership_transfers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_milestones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_communications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_obligations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_shipping        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_inspections     ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (edge functions use service role key)

-- ownership_transfers: parties see their own; public sees non-hidden transfers
CREATE POLICY "Parties can view their transfer"
  ON public.ownership_transfers FOR SELECT TO authenticated
  USING (
    auth.uid() = from_user_id OR
    auth.uid() = to_user_id
  );

CREATE POLICY "Public can view non-hidden transfers"
  ON public.ownership_transfers FOR SELECT TO anon
  USING (public_visibility != 'hidden');

CREATE POLICY "Parties can update their transfer"
  ON public.ownership_transfers FOR UPDATE TO authenticated
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

-- Milestones: inherit transfer access
CREATE POLICY "Parties can view milestones"
  ON public.transfer_milestones FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ownership_transfers t
      WHERE t.id = transfer_id
        AND (t.from_user_id = auth.uid() OR t.to_user_id = auth.uid())
    )
  );

CREATE POLICY "Parties can update milestones"
  ON public.transfer_milestones FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ownership_transfers t
      WHERE t.id = transfer_id
        AND (t.from_user_id = auth.uid() OR t.to_user_id = auth.uid())
    )
  );

-- Documents: parties only (documents contain sensitive financial/legal data)
CREATE POLICY "Parties can view documents"
  ON public.transfer_documents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ownership_transfers t
      WHERE t.id = transfer_id
        AND (t.from_user_id = auth.uid() OR t.to_user_id = auth.uid())
    )
  );

CREATE POLICY "Parties can insert documents"
  ON public.transfer_documents FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ownership_transfers t
      WHERE t.id = transfer_id
        AND (t.from_user_id = auth.uid() OR t.to_user_id = auth.uid())
    )
  );

-- Communications: parties only
CREATE POLICY "Parties can view communications"
  ON public.transfer_communications FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ownership_transfers t
      WHERE t.id = transfer_id
        AND (t.from_user_id = auth.uid() OR t.to_user_id = auth.uid())
    )
  );

-- Payments: parties only
CREATE POLICY "Parties can view payments"
  ON public.transfer_payments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ownership_transfers t
      WHERE t.id = transfer_id
        AND (t.from_user_id = auth.uid() OR t.to_user_id = auth.uid())
    )
  );

-- Obligations: parties only
CREATE POLICY "Parties can view obligations"
  ON public.transfer_obligations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ownership_transfers t
      WHERE t.id = transfer_id
        AND (t.from_user_id = auth.uid() OR t.to_user_id = auth.uid())
    )
  );

-- Shipping: parties only
CREATE POLICY "Parties can view shipping"
  ON public.transfer_shipping FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ownership_transfers t
      WHERE t.id = transfer_id
        AND (t.from_user_id = auth.uid() OR t.to_user_id = auth.uid())
    )
  );

-- Inspections: parties can view; inspector can update
CREATE POLICY "Parties can view inspections"
  ON public.transfer_inspections FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ownership_transfers t
      WHERE t.id = transfer_id
        AND (t.from_user_id = auth.uid() OR t.to_user_id = auth.uid())
    )
    OR auth.uid() = inspector_user_id
  );

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ownership_transfers_updated_at
  BEFORE UPDATE ON public.ownership_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_transfer_milestones_updated_at
  BEFORE UPDATE ON public.transfer_milestones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_transfer_payments_updated_at
  BEFORE UPDATE ON public.transfer_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_transfer_obligations_updated_at
  BEFORE UPDATE ON public.transfer_obligations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_transfer_shipping_updated_at
  BEFORE UPDATE ON public.transfer_shipping
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_transfer_inspections_updated_at
  BEFORE UPDATE ON public.transfer_inspections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- last_milestone_at trigger
-- Keeps ownership_transfers.last_milestone_at current whenever a milestone
-- is marked completed — used by the staleness detection job.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transfer_milestone_completed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    UPDATE public.ownership_transfers
    SET last_milestone_at = now(),
        updated_at        = now()
    WHERE id = NEW.transfer_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_transfer_milestone_completed
  AFTER UPDATE ON public.transfer_milestones
  FOR EACH ROW EXECUTE FUNCTION public.transfer_milestone_completed();

-- ----------------------------------------------------------------------------
-- Auto-clear vehicles.current_transfer_id when transfer completes/cancels
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transfer_status_changed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('completed', 'cancelled') AND OLD.status NOT IN ('completed', 'cancelled') THEN
    UPDATE public.vehicles
    SET current_transfer_id   = NULL,
        ownership_confirmed_at = CASE
          WHEN NEW.status = 'completed' THEN now()
          ELSE ownership_confirmed_at
        END
    WHERE id = NEW.vehicle_id
      AND current_transfer_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_transfer_status_changed
  AFTER UPDATE ON public.ownership_transfers
  FOR EACH ROW EXECUTE FUNCTION public.transfer_status_changed();
