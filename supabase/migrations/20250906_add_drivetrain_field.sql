-- Add drivetrain field to vehicles table
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS drivetrain TEXT;

-- Add index for drivetrain
CREATE INDEX IF NOT EXISTS idx_vehicles_drivetrain ON vehicles(drivetrain);

-- Add comment for drivetrain field
COMMENT ON COLUMN vehicles.drivetrain IS 'Drivetrain type (4WD, AWD, FWD, RWD, etc.) - separate from trim level';
