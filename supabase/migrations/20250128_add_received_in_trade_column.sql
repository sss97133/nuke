-- Add received_in_trade column to vehicles table
-- This tracks if a vehicle was received as part of a trade transaction

ALTER TABLE vehicles 
  ADD COLUMN IF NOT EXISTS received_in_trade BOOLEAN DEFAULT FALSE;

-- Add index for filtering traded vehicles
CREATE INDEX IF NOT EXISTS idx_vehicles_received_in_trade ON vehicles(received_in_trade) WHERE received_in_trade = true;

-- Add comment for documentation
COMMENT ON COLUMN vehicles.received_in_trade IS 'Indicates if this vehicle was received as part of a trade transaction (including partial trades)';

