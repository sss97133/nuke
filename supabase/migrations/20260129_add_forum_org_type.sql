-- Add 'forum' and other useful types to organizations type constraint

-- Drop existing constraint
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_type_check;

-- Add new constraint with expanded types
ALTER TABLE organizations ADD CONSTRAINT organizations_type_check
CHECK (type IN (
  'dealer',
  'shop',
  'auction_house',
  'collection',
  'forum',           -- Online enthusiast forums
  'club',            -- Car clubs
  'media',           -- Magazines, YouTube channels
  'parts_supplier',  -- Parts suppliers
  'service',         -- Service/repair shops
  'manufacturer',    -- OEMs
  'registry'         -- Vehicle registries
));
