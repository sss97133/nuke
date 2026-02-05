-- Allow sale_status = 'auction_live' and 'ended' for sync-live-auctions and UI/stats parity.
-- Portfolio and homepage count active auctions with sale_status = 'auction_live'.

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_sale_status_check;
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_sale_status_check1;

ALTER TABLE vehicles ADD CONSTRAINT vehicles_sale_status_check CHECK (
  sale_status IS NULL OR sale_status IN (
    'not_for_sale', 'for_sale', 'sold', 'pending',
    'auction_live', 'ended', 'available', 'discovered',
    'not_sold', 'unsold', 'upcoming'
  )
);

COMMENT ON COLUMN vehicles.sale_status IS 'Current sale status. auction_live = active auction (synced from BaT/CC/C&B). ended = auction ended.';
