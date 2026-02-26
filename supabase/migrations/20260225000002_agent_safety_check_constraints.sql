-- =============================================================================
-- AGENT SAFETY: CHECK constraints for undocumented status columns
-- =============================================================================
-- Purpose: Make invalid state writes fail loudly instead of silently
--   accumulating bad data.
--
-- Strategy: Add constraints as NOT VALID first so they don't scan existing
--   data (which may have legacy values), then they apply to all NEW inserts
--   and updates going forward.
-- =============================================================================


-- =============================================================================
-- vehicles.status
-- Existing values in DB: active, pending, sold, discovered, merged, rejected,
--   inactive, archived, deleted, pending_backfill, duplicate
-- =============================================================================
ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_status_check CHECK (
    status IS NULL OR status = ANY(ARRAY[
      'active', 'pending', 'sold', 'discovered', 'merged',
      'rejected', 'inactive', 'archived', 'deleted',
      'pending_backfill', 'duplicate'
    ])
  ) NOT VALID;


-- =============================================================================
-- vehicles.auction_status
-- Existing values in DB: active, ended, sold
-- =============================================================================
ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_auction_status_check CHECK (
    auction_status IS NULL OR auction_status = ANY(ARRAY[
      'active', 'ended', 'sold'
    ])
  ) NOT VALID;


-- =============================================================================
-- vehicles.reserve_status
-- Existing values in DB: no_reserve, reserve_met, reserve_not_met
-- =============================================================================
ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_reserve_status_check CHECK (
    reserve_status IS NULL OR reserve_status = ANY(ARRAY[
      'no_reserve', 'reserve_met', 'reserve_not_met'
    ])
  ) NOT VALID;


-- =============================================================================
-- vehicle_images.ai_processing_status
-- Values used in codebase: pending, processing, completed, failed
-- =============================================================================
ALTER TABLE vehicle_images
  ADD CONSTRAINT vehicle_images_ai_processing_status_check CHECK (
    ai_processing_status IS NULL OR ai_processing_status = ANY(ARRAY[
      'pending', 'processing', 'completed', 'failed', 'skipped'
    ])
  ) NOT VALID;


-- =============================================================================
-- vehicle_images.optimization_status
-- Values: pending (default), optimized, failed
-- =============================================================================
ALTER TABLE vehicle_images
  ADD CONSTRAINT vehicle_images_optimization_status_check CHECK (
    optimization_status IS NULL OR optimization_status = ANY(ARRAY[
      'pending', 'processing', 'optimized', 'failed'
    ])
  ) NOT VALID;


-- =============================================================================
-- vehicle_images.organization_status
-- Values used in codebase: unorganized, organized, ignored
-- =============================================================================
ALTER TABLE vehicle_images
  ADD CONSTRAINT vehicle_images_organization_status_check CHECK (
    organization_status IS NULL OR organization_status = ANY(ARRAY[
      'unorganized', 'organized', 'ignored'
    ])
  ) NOT VALID;
