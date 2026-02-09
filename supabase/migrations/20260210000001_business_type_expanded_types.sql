-- Expand business_type to support meaningful categories (no more dumping into "other")
-- New types from analysis of 2193 "other" businesses: villa_rental, event_company,
-- restaurant_food, hotel_lodging, property_management, travel_tourism, art_creative,
-- retail_other, health_medical, professional_services, sport_recreation, marine_nautical,
-- education, construction_services, car_rental. "club" already exists for club_association.

ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_business_type_check;

ALTER TABLE businesses ADD CONSTRAINT businesses_business_type_check
CHECK (business_type IN (
  'sole_proprietorship', 'partnership', 'llc', 'corporation',
  'garage', 'dealership', 'restoration_shop', 'performance_shop',
  'body_shop', 'detailing', 'mobile_service', 'specialty_shop',
  'parts_supplier', 'fabrication', 'racing_team',
  'auction_house', 'marketplace', 'concours', 'automotive_expo',
  'motorsport_event', 'rally_event', 'builder',
  'collection', 'dealer', 'forum', 'club', 'media', 'registry',
  'villa_rental', 'event_company', 'restaurant_food', 'hotel_lodging',
  'property_management', 'travel_tourism', 'art_creative', 'retail_other',
  'health_medical', 'professional_services', 'sport_recreation', 'marine_nautical',
  'education', 'construction_services', 'car_rental',
  'other'
));

COMMENT ON COLUMN businesses.business_type IS 'Organization category. Automotive: dealer, garage, auction_house, restoration_shop, performance_shop, body_shop, detailing, marketplace, builder, registry, club, media. Non-automotive: villa_rental, event_company, restaurant_food, hotel_lodging, property_management, travel_tourism, art_creative, retail_other, health_medical, professional_services, sport_recreation, marine_nautical, education, construction_services, car_rental. other = unclassified.';
