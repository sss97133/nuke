-- 20260524_user_observations_photo_kinds.sql
-- Extend user_observation_kind enum to support photo-derived user-scope atoms.
-- Per Skylar 2026-05-24: "user profiles are the drivers of progress on the platform
-- otherwise the system is dead. its a shell without a driver."
--
-- The existing enum (vendor_preference / brand_preference / purchase_cadence /
-- shipping_address_pattern / payment_method_pattern / vehicle_attribution_inferred /
-- tool_owned / counterparty_relationship / spending_pattern / category_breakdown)
-- is purchase-pattern focused. It cannot land photo-derived atoms like:
--   - "Skylar at shop on May 19 (selfie)"
--   - "Cream convertible Mustang in shop (un-attributed vehicle sighting)"
--   - "Kitchen at Yucca St under renovation (property state)"
--
-- These are user-substrate atoms — they belong to Skylar's profile, not to any
-- single vehicle. Extending the enum to support them. Conservative: 4 new kinds
-- only, all photo-derivable from a single image observation.

ALTER TYPE user_observation_kind ADD VALUE IF NOT EXISTS 'scene_observation';
ALTER TYPE user_observation_kind ADD VALUE IF NOT EXISTS 'presence';
ALTER TYPE user_observation_kind ADD VALUE IF NOT EXISTS 'property_observation';
ALTER TYPE user_observation_kind ADD VALUE IF NOT EXISTS 'daily_activity';

-- Also extend the source CHECK to allow 'photo_pipeline_byok_deep_analysis' as a
-- first-class source slug (currently only qb/apple_cash/apple_mail/receipt_ocr/
-- imessage/photos_metadata/manual are permitted). photos_metadata is for raw EXIF
-- ingestion; this new source is for vision-derived structured atoms.
ALTER TABLE user_observations DROP CONSTRAINT IF EXISTS user_observations_source_check;
ALTER TABLE user_observations ADD CONSTRAINT user_observations_source_check
  CHECK (source IN (
    'qb_transactions','apple_cash','apple_mail','receipt_ocr','imessage',
    'photos_metadata','photo_pipeline_byok_deep_analysis','manual'
  ));

COMMENT ON TYPE user_observation_kind IS
  'Kinds of user-scope observations. Financial-pattern kinds (vendor_preference, brand_preference, etc.) are mined from QB/Apple Cash/Mail. Photo-derived kinds (scene_observation, presence, property_observation, daily_activity) are written by BYOK vision agents reading user_id-scoped images that lack vehicle attribution. The user is the subject; vehicle attribution may be derived later via clustering.';
