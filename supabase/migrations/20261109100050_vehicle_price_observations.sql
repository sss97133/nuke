-- vehicle_price_observations: typed, cited price observations read from a vehicle's screen recordings and screenshots.
--
-- Why a new table (checked read-only against the live schema, 2026-11-04):
--   * vehicle_price_history has price_type CHECK (msrp | purchase | current | asking | sale): no offer, no agreed, no
--     unknown, no frame citation, and its purchase/sale rows are read as the vehicle's price of record. Widening a
--     468k-row table's constraint to fit this would also make an OCR read look like a price of record.
--   * vehicle_observations is the shared 14M-row claims ledger with a fixed property vocabulary (asking_price_usd,
--     sale_price_usd): no offer/agreed, and adding properties changes a registry other pipelines read.
--   * price_observations is villa/service rates; price_basis_observation is an auction-event audit trail.
--   None fits, and none is owner-only.
--
-- One row per price seen on screen. A price is never copied to vehicles.purchase_price: these are observations, each
-- with its type and the preview frame (index and seconds) that shows it. price_type is chosen on the phone from the
-- text around the price ("asking", "would you take", "offer", "deal", "sold to you"); when that text is not clear it
-- is 'unknown', never a guess.
--
-- Access: owner-only. Rows are written only by public.device_file_media_document (SECURITY DEFINER); no client has
-- INSERT/UPDATE/DELETE. An owner reads their own rows (user_id = auth.uid()).
--
-- STATUS: written for the screen-capture PR. Creates one empty table; it changes no existing object.

SET lock_timeout = '10s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.vehicle_price_observations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  price_type    text NOT NULL CHECK (price_type IN ('asking', 'offer', 'agreed', 'unknown')),
  amount        numeric(12,2) NOT NULL CHECK (amount >= 500 AND amount <= 5000000),
  currency      text NOT NULL DEFAULT 'USD',
  source        text NOT NULL DEFAULT 'screen_capture' CHECK (source = 'screen_capture'),
  rule          text NOT NULL DEFAULT 'screen_text_v1',
  media_row_id  uuid NOT NULL,                 -- the metadata-only vehicle_images row of the capture
  document_id   uuid,                          -- the acquisition_document it was attached as
  frame_index   integer NOT NULL CHECK (frame_index BETWEEN 1 AND 12),
  frame_seconds numeric(6,2) NOT NULL CHECK (frame_seconds >= 0 AND frame_seconds <= 60),
  observed_at   timestamptz NOT NULL,          -- when the capture was recorded
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (media_row_id, price_type, amount)
);

CREATE INDEX IF NOT EXISTS vehicle_price_observations_vehicle_idx
  ON public.vehicle_price_observations (vehicle_id, observed_at);

ALTER TABLE public.vehicle_price_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_price_observations_owner_read ON public.vehicle_price_observations;
CREATE POLICY vehicle_price_observations_owner_read ON public.vehicle_price_observations
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.vehicle_price_observations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicle_price_observations TO authenticated;
GRANT ALL ON public.vehicle_price_observations TO service_role;

COMMENT ON TABLE public.vehicle_price_observations IS
  'Typed price observations (asking | offer | agreed | unknown) read on the owner''s phone from screen recordings and '
  'screenshots, one per price, each citing its preview frame. Observations, not prices of record: never copied to '
  'vehicles.purchase_price. Owner-only; written by device_file_media_document. See apps/nuke-capture-ios/docs/VIDEO_SYNC_PLAN.md.';
