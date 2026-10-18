SET statement_timeout = '60s';
SET session_replication_role = replica;

-- Porsche model numbers as make (911, 944, 356)
UPDATE vehicles SET make = 'Porsche' WHERE make IN ('911', '944', '356') AND discovery_url LIKE '%bringatrailer.com%' AND listing_kind = 'vehicle';

-- One-Owner / Original-Owner with make in model
UPDATE vehicles SET make = split_part(model, ' ', 1), model = TRIM(SUBSTRING(model FROM POSITION(' ' IN model) + 1))
WHERE make IN ('One-Owner', 'Original-Owner', 'Original-Owner,') AND listing_kind = 'vehicle' AND LENGTH(split_part(model, ' ', 1)) > 2;

-- Year as make (e.g. make="2008", make="1999", make="1965") - extract from URL
-- URL pattern: /listing/YEAR-make-model
UPDATE vehicles v SET make = initcap(split_part(split_part(discovery_url, '/listing/', 2), '-', 2))
WHERE make ~ '^\d{4}$' AND listing_kind = 'vehicle' AND discovery_url LIKE '%/listing/%'
  AND LENGTH(split_part(split_part(discovery_url, '/listing/', 2), '-', 2)) > 2;

-- Small number as make (5, 12, etc) - extract from model
UPDATE vehicles SET make = split_part(model, ' ', 1), model = TRIM(SUBSTRING(model FROM POSITION(' ' IN model) + 1))
WHERE make ~ '^\d{1,2}$' AND listing_kind = 'vehicle' AND LENGTH(split_part(model, ' ', 1)) > 2;

SET session_replication_role = DEFAULT;
