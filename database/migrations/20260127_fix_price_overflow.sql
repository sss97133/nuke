-- Fix integer overflow on price columns
-- Change sale_price, price, and sold_price from integer to bigint

ALTER TABLE vehicles
  ALTER COLUMN sale_price TYPE bigint,
  ALTER COLUMN price TYPE bigint,
  ALTER COLUMN sold_price TYPE bigint;

-- Also update import_queue listing_price
ALTER TABLE import_queue
  ALTER COLUMN listing_price TYPE bigint;
