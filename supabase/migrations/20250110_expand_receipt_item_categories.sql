-- Expand receipt_items.category enum to support detailed receipt extraction categories
-- receipt_items.category uses the parts_category enum type
-- This migration adds missing categories that will emerge from receipt extraction
-- Created: 2026-01-10

-- ============================================================================
-- EXPAND parts_category ENUM
-- ============================================================================
-- receipt_items.category uses parts_category enum (not a CHECK constraint)
-- Current enum values: engine, transmission, suspension, brakes, electrical, 
--                      interior, exterior, exhaust, cooling, fuel_system, 
--                      tools, consumables, hardware, paint, labor
-- 
-- Frontend receiptPersistService.ts uses capitalized names (Engine, Brakes, etc.)
-- but enum uses lowercase. We'll add missing categories and note the mapping.
-- ============================================================================

DO $$
BEGIN
  -- Add missing categories that may emerge from receipt extraction
  -- Note: Enum values are case-sensitive and typically lowercase
  
  -- Add 'tax' if not exists (for receipt tax line items)
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'parts_category' AND e.enumlabel = 'tax'
  ) THEN
    ALTER TYPE parts_category ADD VALUE IF NOT EXISTS 'tax';
  END IF;

  -- Add 'fee' if not exists (for receipt fees)
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'parts_category' AND e.enumlabel = 'fee'
  ) THEN
    ALTER TYPE parts_category ADD VALUE IF NOT EXISTS 'fee';
  END IF;

  -- Add 'shipping' if not exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'parts_category' AND e.enumlabel = 'shipping'
  ) THEN
    ALTER TYPE parts_category ADD VALUE IF NOT EXISTS 'shipping';
  END IF;

  -- Add 'storage' if not exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'parts_category' AND e.enumlabel = 'storage'
  ) THEN
    ALTER TYPE parts_category ADD VALUE IF NOT EXISTS 'storage';
  END IF;

  -- Add 'maintenance' if not exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'parts_category' AND e.enumlabel = 'maintenance'
  ) THEN
    ALTER TYPE parts_category ADD VALUE IF NOT EXISTS 'maintenance';
  END IF;

  -- Add 'hvac' if not exists (heating/ventilation/air conditioning)
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'parts_category' AND e.enumlabel = 'hvac'
  ) THEN
    ALTER TYPE parts_category ADD VALUE IF NOT EXISTS 'hvac';
  END IF;

  -- Add 'lighting' if not exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'parts_category' AND e.enumlabel = 'lighting'
  ) THEN
    ALTER TYPE parts_category ADD VALUE IF NOT EXISTS 'lighting';
  END IF;

  -- Add 'audio' if not exists (audio/electronics)
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'parts_category' AND e.enumlabel = 'audio'
  ) THEN
    ALTER TYPE parts_category ADD VALUE IF NOT EXISTS 'audio';
  END IF;

  -- Add 'safety' if not exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'parts_category' AND e.enumlabel = 'safety'
  ) THEN
    ALTER TYPE parts_category ADD VALUE IF NOT EXISTS 'safety';
  END IF;

END $$;

-- Add comment explaining the category system
COMMENT ON COLUMN receipt_items.category IS 
  'Category for receipt item using parts_category enum. '
  'Current values: engine, transmission, suspension, brakes, electrical, interior, '
  'exterior, exhaust, cooling, fuel_system, tools, consumables, hardware, paint, labor, '
  'tax, fee, shipping, storage, maintenance, hvac, lighting, audio, safety. '
  'Categories will expand as receipt extraction improves. '
  'Note: Frontend receiptPersistService.ts uses capitalized names (Engine, Brakes, etc.) '
  'but enum values are lowercase - mapping should be handled in application code.';

-- Create index for efficient category queries
CREATE INDEX IF NOT EXISTS idx_receipt_items_category_detailed 
  ON receipt_items(category) 
  WHERE category IS NOT NULL;

-- ============================================================================
-- FRONTEND MAPPING NOTE
-- ============================================================================
-- receiptPersistService.ts autoCategory() returns capitalized names:
--   'Engine', 'Brakes', 'Suspension', 'Transmission', 'Wheels & Tires', 
--   'Body/Paint', 'Interior', 'Electrical'
--
-- These need to be mapped to enum values:
--   'Engine' -> 'engine'
--   'Brakes' -> 'brakes'
--   'Suspension' -> 'suspension'
--   'Transmission' -> 'transmission'
--   'Wheels & Tires' -> 'tools' or 'consumables' (or add 'wheels_tires')
--   'Body/Paint' -> 'exterior' or 'paint'
--   'Interior' -> 'interior'
--   'Electrical' -> 'electrical'
--
-- Consider updating receiptPersistService.ts to use enum values directly.
-- ============================================================================

