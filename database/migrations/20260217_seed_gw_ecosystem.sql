-- ============================================================
-- SEED: Gunther Werks Discovery Ecosystem
-- 20+ organizations, 10+ people, 50+ relationships, 60+ brands
-- ============================================================

BEGIN;

-- ============================================================
-- MANUFACTURERS / BUILDERS
-- ============================================================

INSERT INTO organizations (business_name, slug, entity_type, business_type, description, website, phone, email, city, state, country, social_links, enrichment_status, last_enriched_at, enrichment_sources, metadata)
VALUES
  ('Gunther Werks', 'gunther-werks', 'manufacturer', 'builder',
   'Ultra-niche restomod coachbuilder specializing in bespoke Porsche 993-based vehicles. Programs: GWR (40 units), Turbo (75 units), Speedster (25 units, sold out), 400R Coupe (25 units, sold out), GWX (3 units, invitation only). ~168 total production capacity. Founded by Peter Nam (Vorsteiner). Based in Huntington Beach, CA.',
   'https://guntherwerks.com', '+1-714-733-7038', 'info@guntherwerks.com',
   'Huntington Beach', 'CA', 'US',
   '{"instagram": {"handle": "@guntherwerks", "followers": 489000}, "youtube": "/c/GuntherWerks", "facebook": "/guntherwerksna"}'::jsonb,
   'enriched', NOW(), ARRAY['https://guntherwerks.com', 'https://guntherwerks.com/dealer'],
   '{"founded_by": "Peter Nam", "platform": "Porsche 993", "production_total": 168, "price_range": "$525K-$1.8M", "programs": {"400R": {"units": 25, "status": "sold_out"}, "Speedster": {"units": 25, "status": "sold_out"}, "Turbo": {"units": 75, "status": "in_production"}, "GWR": {"units": 40, "status": "in_production"}, "GWX": {"units": 3, "status": "invitation_only"}}}'::jsonb
  ),
  ('Singer Vehicle Design', 'singer-vehicle-design', 'manufacturer', 'builder',
   'Porsche 964-based restomod builder. Bespoke commission model with global network partners. Founded by Rob Dickinson in 2009. Based in Torrance, CA.',
   'https://singervehicledesign.com', NULL, NULL,
   'Torrance', 'CA', 'US',
   '{"instagram": {"handle": "@singervehicledesign"}}'::jsonb,
   'partial', NOW(), ARRAY['https://singervehicledesign.com'],
   '{"founded_by": "Rob Dickinson", "platform": "Porsche 964", "founded_year": 2009}'::jsonb
  ),
  ('RUF Automobile', 'ruf-automobile', 'manufacturer', 'builder',
   'German manufacturer and Porsche tuner. Multi-generational 911 platform. RUF North America based in Miami.',
   'https://ruf-automobile.de', NULL, NULL,
   'Pfaffenhausen', NULL, 'DE',
   '{}'::jsonb,
   'stub', NOW(), ARRAY['https://ruf-automobile.de'],
   '{"platform": "Porsche multi-gen"}'::jsonb
  ),
  ('Scuderia Cameron Glickenhaus', 'scuderia-cameron-glickenhaus', 'manufacturer', 'builder',
   'Performance vehicle manufacturer. 004S/004CS supercar ($450K+, 650hp V8, 6-speed manual). Factory in Connecticut. Founded by Jim Glickenhaus. Le Mans racing program.',
   'https://www.sscnorthamerica.com', NULL, NULL,
   'Sleepy Hollow', 'NY', 'US',
   '{}'::jsonb,
   'partial', NOW(), ARRAY['https://glickenhausracing.com'],
   '{"founded_by": "Jim Glickenhaus", "key_model": "004S/004CS", "price_from": 450000}'::jsonb
  ),
  ('SSC North America', 'ssc-north-america', 'manufacturer', 'builder',
   'Hypercar manufacturer. Tuatara ($1.9M+). Based in Richland, Washington.',
   'https://www.sscnorthamerica.com', NULL, 'sales@sscnorthamerica.com',
   'Richland', 'WA', 'US',
   '{}'::jsonb,
   'partial', NOW(), ARRAY['https://www.sscnorthamerica.com'],
   '{"key_model": "Tuatara", "price_from": 1900000}'::jsonb
  ),
  ('Kimera Automobili', 'kimera-automobili', 'manufacturer', 'builder',
   'Italian restomod builder. Lancia-based EVO37 (37 units) and EVO38 (26 units).',
   'https://www.kimeraautomobili.com', NULL, NULL,
   NULL, NULL, 'IT',
   '{}'::jsonb,
   'stub', NOW(), ARRAY['https://www.kimeraautomobili.com'],
   '{"platform": "Lancia", "models": {"EVO37": 37, "EVO38": 26}}'::jsonb
  ),
  ('Eccentrica Cars', 'eccentrica-cars', 'manufacturer', 'builder',
   'Lamborghini Diablo V12 restomod builder. Very limited production.',
   'https://eccentricacars.com', NULL, NULL,
   NULL, NULL, 'IT',
   '{}'::jsonb,
   'stub', NOW(), ARRAY['https://eccentricacars.com'],
   '{"platform": "Lamborghini Diablo"}'::jsonb
  ),
  ('Nardone Automotive', 'nardone-automotive', 'manufacturer', 'builder',
   'Porsche 928-based restomod builder.',
   NULL, NULL, NULL,
   NULL, NULL, 'FR',
   '{}'::jsonb,
   'stub', NOW(), NULL,
   '{"platform": "Porsche 928"}'::jsonb
  ),
  ('Pagani Automobili', 'pagani-automobili', 'manufacturer', 'builder',
   'Italian hypercar manufacturer. Huayra, Utopia. ~$2.5M+.',
   'https://www.pagani.com', NULL, NULL,
   'San Cesario sul Panaro', NULL, 'IT',
   '{}'::jsonb,
   'stub', NOW(), NULL,
   '{"price_from": 2500000}'::jsonb
  ),
  ('Koenigsegg', 'koenigsegg', 'manufacturer', 'builder',
   'Swedish hypercar manufacturer. Jesko, Gemera. ~$3M+.',
   'https://www.koenigsegg.com', NULL, NULL,
   'Angelholm', NULL, 'SE',
   '{}'::jsonb,
   'stub', NOW(), NULL,
   '{"price_from": 3000000}'::jsonb
  ),
  ('GW9 Design', 'gw9-design', 'manufacturer', 'specialty_shop',
   'Gunther Werks sub-brand for aftermarket aero kits. 992 Turbo S carbon fiber packages, $3,995-$68,000. Collaboration with Vorsteiner.',
   'https://gw9design.com', NULL, NULL,
   'Huntington Beach', 'CA', 'US',
   '{}'::jsonb,
   'partial', NOW(), ARRAY['https://gw9design.com'],
   '{"parent_brand": "Gunther Werks", "platform": "992 Turbo S", "price_range": "$3,995-$68,000"}'::jsonb
  )
ON CONFLICT (slug) DO UPDATE SET
  description = EXCLUDED.description,
  enrichment_status = EXCLUDED.enrichment_status,
  last_enriched_at = EXCLUDED.last_enriched_at,
  metadata = organizations.metadata || EXCLUDED.metadata;

-- ============================================================
-- DEALERS
-- ============================================================

INSERT INTO organizations (business_name, slug, entity_type, business_type, description, website, phone, email, city, state, country, address, social_links, enrichment_status, last_enriched_at, enrichment_sources, metadata)
VALUES
  ('O''Gara Coach', 'ogara-coach', 'dealer_group', 'dealership',
   'Ultra-luxury multi-brand dealer group. Factory-authorized for 13+ brands including Bugatti, Koenigsegg, Rimac, Pininfarina, McLaren, Bentley, Rolls-Royce, Lamborghini, Aston Martin, Maserati. Locations in Beverly Hills, Westlake Village, La Jolla, Las Vegas, Thermal.',
   'https://www.ogaracoach.com', '(310) 967-3960', 'rhuffman@ogaracoach.com',
   'Beverly Hills', 'CA', 'US', '207-209 S Robertson Blvd, Beverly Hills, CA 90211',
   '{"instagram": {"handle": "@ogaracoach", "followers": 124000}}'::jsonb,
   'enriched', NOW(), ARRAY['https://www.ogaracoach.com', 'https://www.instagram.com/ogaracoach/'],
   '{"locations": ["Beverly Hills", "Westlake Village", "La Jolla", "Las Vegas", "Thermal"], "platform": "dealer.com"}'::jsonb
  ),
  ('HK Motorcars', 'hk-motorcars', 'franchise_dealer', 'dealership',
   'Ultra-niche coachbuilt/restomod dealer. By appointment only. Exclusive worldwide Glickenhaus dealer. Carries 11+ boutique brands including SSC, Kimera, Eccentrica, Nardone, HWA EVO, Meyers Manx. Uses BaT for consignment sales. SpeedSport Tuning service partnership.',
   'https://www.hkmotorcars.com', '(914) 282-0714', 'nat@hkmotorcars.com',
   'Mount Kisco', 'NY', 'US', '281 N Bedford Road, Mount Kisco, NY 10549',
   '{"instagram": {"handle": "@hkmotorcars", "followers": 35000}}'::jsonb,
   'enriched', NOW(), ARRAY['https://www.hkmotorcars.com', 'https://www.hkmotorcars.com/about'],
   '{"appointment_only": true, "platform": "squarespace", "also_has": "@hkmotorcarscollection (private collection IG)"}'::jsonb
  ),
  ('Prestige Imports', 'prestige-imports', 'dealer_group', 'dealership',
   'South Florida exotic car royalty. 355K IG followers. Factory authorized: Lamborghini, Pagani (only East Coast), Lotus, Karma, Czinger, Audi. Also operates Prestige Marine and Prestige Aviation. Founded 1977 by Irv David; CEO Brett David took over at age 19.',
   'https://www.prestigeimports.com', '(305) 783-6493', 'Javier@PrestigeImports.com',
   'North Miami Beach', 'FL', 'US', '15050 Biscayne Blvd., North Miami Beach, FL 33181',
   '{"instagram": {"handle": "@prestigeimports", "followers": 355000}}'::jsonb,
   'enriched', NOW(), ARRAY['https://www.prestigeimports.com', 'https://www.instagram.com/prestigeimports/'],
   '{"founded": 1977, "ceo": "Brett David", "sub_brands_ig": ["@lamborghinimiami", "@paganiofmiami", "@czingermiami", "@lotusofmiami"], "divisions": ["marine", "aviation"]}'::jsonb
  ),
  ('Earth MotorCars', 'earth-motorcars', 'franchise_dealer', 'dealership',
   'Multi-category luxury dealer in Dallas-Fort Worth. Authorized Lotus (Lotus of Dallas), Hennessey, Backdraft Racing. 300+ vehicle inventory. Accepts crypto via BitPay. BBB Accredited since 2007.',
   'https://www.earthmotorcars.com', '(214) 483-9040', 'sales@earthmotorcars.com',
   'Carrollton', 'TX', 'US', '3216 Kellway Dr. Carrollton, TX 75006',
   '{"instagram": {"handle": "@earthmotorcarsofficial", "followers": 922}}'::jsonb,
   'enriched', NOW(), ARRAY['https://www.earthmotorcars.com'],
   '{"accepts_crypto": true, "platform": "dealer.com", "inventory_count": 300}'::jsonb
  ),
  ('Gunther Werks Nashville', 'gunther-werks-nashville', 'franchise_dealer', 'dealership',
   'Dual-brand showroom: Gunther Werks + Pagani of Nashville. Operated by Richie Cuico (Sales/Marketing). Owner Vincent Golde previously ran Pagani Beverly Hills and Pagani Newport Beach.',
   'https://paganiofnashville.com', '(615) 575-2025', 'sales@guntherwerksofnashville.com',
   'Franklin', 'TN', 'US', '111 B Alpha Drive, Franklin, TN 37064',
   '{}'::jsonb,
   'partial', NOW(), ARRAY['https://paganiofnashville.com'],
   '{"also_known_as": "Pagani of Nashville", "operator": "Vincent Golde"}'::jsonb
  ),
  ('GAIN Group', 'gain-group', 'dealer_group', 'dealership',
   '24-company Canadian automotive conglomerate based on Vancouver Island. Encompasses Alfa Romeo, Audi, BMW, FIAT, Lotus, Maserati, Mercedes-Benz, MINI, Polestar, Porsche, Subaru, VW, Volvo dealerships plus Coachwerks Restoration, Vancouver Island Motorsport Circuit, and hospitality properties.',
   'https://gain-vi.ca', NULL, NULL,
   'Victoria', 'BC', 'CA', NULL,
   '{}'::jsonb,
   'enriched', NOW(), ARRAY['https://gain-vi.ca', 'https://gain-vi.ca/companies/'],
   '{"company_count": 24, "includes_motorsport_circuit": true, "includes_hospitality": true}'::jsonb
  ),
  ('Coachwerks Restoration', 'coachwerks-restoration', 'restoration_shop', 'restoration_shop',
   'Globally renowned restoration facility. Mercedes-Benz 300SL specialist. 30,000 sq ft. Mercedes-Benz Classic Partner, Porsche Classic Partner. Part of GAIN Group. Official Canadian Sales Centre for Gunther Werks.',
   'https://coachwerks.com', '(250) 727-1213', 'info@coachwerks.com',
   'Victoria', 'BC', 'CA', '543 Hillside Avenue, Victoria BC V8T 1Y8',
   '{"instagram": {"handle": "@coachwerks", "followers": 16000}}'::jsonb,
   'enriched', NOW(), ARRAY['https://coachwerks.com', 'https://gain-vi.ca/companies/coachwerks-restoration/'],
   '{"facility_sqft": 30000, "specialty": "Mercedes-Benz 300SL", "parent": "GAIN Group"}'::jsonb
  ),
  ('SPS Global', 'sps-global', 'importer_distributor', 'dealership',
   'Gunther Werks Asia-Pacific dealer. Based in Chai Wan, Hong Kong.',
   'https://sps-automotive.com', '+852 3159 6800', 'justin@sps-automotive.com',
   'Chai Wan', NULL, 'HK', '27 Lee Chung St, LG/F Tak King Industrial Building, Chai Wan, Hong Kong',
   '{}'::jsonb,
   'stub', NOW(), ARRAY['https://guntherwerks.com/dealer'],
   '{}'::jsonb
  ),
  ('SpeedSport Tuning', 'speedsport-tuning', 'performance_shop', 'performance_shop',
   'Exclusive service and support center for HK Motorcars/SCG vehicles. Located adjacent to Glickenhaus factory in Connecticut.',
   'https://sstauto.com', '(203) 730-0311', NULL,
   NULL, 'CT', 'US', NULL,
   '{}'::jsonb,
   'partial', NOW(), ARRAY['https://sstauto.com/2021/04/11/hk-motorcars-and-speedsport-tuning/'],
   '{"key_contact": "Bryan Shute", "adjacent_to": "Glickenhaus factory"}'::jsonb
  ),
  ('Pfaff Automotive Partners', 'pfaff-automotive', 'dealer_group', 'dealership',
   'Canadian multi-brand dealer group. 17 brands including Pagani of Toronto, McLaren Toronto, Czinger, Singer partner. Porsche, BMW, Audi, etc.',
   'https://www.pfaffauto.com', NULL, NULL,
   'Toronto', 'ON', 'CA', NULL,
   '{}'::jsonb,
   'partial', NOW(), ARRAY['https://www.pfaffauto.com'],
   '{"brand_count": 17}'::jsonb
  ),
  ('Zagame Automotive Group', 'zagame-automotive', 'dealer_group', 'dealership',
   'Australian multi-brand dealer group. 16+ brands across Melbourne and Adelaide. Sole Australian importer for Pagani and Singer. Factory authorized for Ferrari, Lamborghini, McLaren, Bentley, Rolls-Royce, Aston Martin, etc.',
   'https://www.zag.com.au', NULL, NULL,
   'Melbourne', NULL, 'AU', NULL,
   '{}'::jsonb,
   'partial', NOW(), ARRAY['https://www.zag.com.au'],
   '{"brand_count": 16}'::jsonb
  ),
  ('Seven Car Lounge', 'seven-car-lounge', 'franchise_dealer', 'dealership',
   'Saudi luxury automotive dealer. Official Koenigsegg distributor for Saudi Arabia. Singer partner for Arabian Gulf (Saudi, Bahrain, Kuwait, Qatar). Founded by Talal and Adel Alrajab in 2014.',
   'https://www.sevencarlounge.com', NULL, NULL,
   'Riyadh', NULL, 'SA', NULL,
   '{}'::jsonb,
   'partial', NOW(), ARRAY['https://www.sevencarlounge.com'],
   '{"founded": 2014, "founders": ["Talal Alrajab", "Adel Alrajab"], "territory": "Arabian Gulf"}'::jsonb
  ),
  ('Manhattan Motorcars', 'manhattan-motorcars', 'franchise_dealer', 'dealership',
   'NYC luxury dealer. SSC North America authorized dealer for Northeast US.',
   'https://www.manhattanmotorcars.com', '(866) 325-1538', NULL,
   'New York', 'NY', 'US', '711 11th Ave, New York, NY 10019',
   '{}'::jsonb,
   'stub', NOW(), ARRAY['https://www.manhattanmotorcars.com'],
   '{}'::jsonb
  ),
  ('Rstrada', 'rstrada', 'franchise_dealer', 'dealership',
   'Exclusive West Coast representative for new RUF vehicles. Also RUF conversions and restorations.',
   'https://www.rstrada.com', NULL, NULL,
   'Torrance', 'CA', 'US', NULL,
   '{}'::jsonb,
   'stub', NOW(), ARRAY['https://www.rstrada.com'],
   '{}'::jsonb
  ),
  ('RUF North America', 'ruf-north-america', 'importer_distributor', 'dealership',
   'RUF headquarters and showroom for North America. Based in Miami.',
   'https://rufnorthamerica.com', NULL, NULL,
   'Miami', 'FL', 'US', NULL,
   '{}'::jsonb,
   'stub', NOW(), ARRAY['https://rufnorthamerica.com'],
   '{}'::jsonb
  )
ON CONFLICT (slug) DO UPDATE SET
  description = EXCLUDED.description,
  enrichment_status = EXCLUDED.enrichment_status,
  last_enriched_at = EXCLUDED.last_enriched_at,
  metadata = organizations.metadata || EXCLUDED.metadata;

-- ============================================================
-- AUCTION PLATFORMS
-- ============================================================

INSERT INTO organizations (business_name, slug, entity_type, business_type, description, website, city, state, country, enrichment_status)
VALUES
  ('Bring a Trailer', 'bring-a-trailer', 'online_auction_platform', 'marketplace', 'Leading online collector car auction platform.', 'https://bringatrailer.com', 'San Francisco', 'CA', 'US', 'stub'),
  ('RM Sotheby''s', 'rm-sothebys', 'auction_house', 'auction_house', 'Premier collector car auction house. Multiple venues: Monterey, Arizona, Miami, London.', 'https://rmsothebys.com', NULL, NULL, 'CA', 'stub'),
  ('Bonhams', 'bonhams', 'auction_house', 'auction_house', 'International auction house with collector car division.', 'https://cars.bonhams.com', NULL, NULL, 'GB', 'stub')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- ORGANIZATION RELATIONSHIPS
-- ============================================================

-- Gunther Werks dealer relationships
INSERT INTO organization_relationships (source_org_id, target_org_id, relationship_type, territory, source_url, confidence_score)
SELECT dealer.id, gw.id, 'dealer_for', d.territory, 'https://guntherwerks.com/dealer', 0.95
FROM organizations gw,
(VALUES
  ('ogara-coach', 'West Coast US'),
  ('hk-motorcars', 'Northeast US'),
  ('prestige-imports', 'Southeast US'),
  ('earth-motorcars', 'Texas/South Central'),
  ('gunther-werks-nashville', 'Tennessee/Mid-South'),
  ('sps-global', 'Asia-Pacific')
) AS d(slug, territory)
JOIN organizations dealer ON dealer.slug = d.slug
WHERE gw.slug = 'gunther-werks'
ON CONFLICT DO NOTHING;

-- Coachwerks/GAIN → Gunther Werks (Canadian dealer)
INSERT INTO organization_relationships (source_org_id, target_org_id, relationship_type, territory, source_url, confidence_score)
SELECT c.id, gw.id, 'dealer_for', 'Canada', 'https://gain-vi.ca/companies/gunther-werks/', 0.95
FROM organizations c, organizations gw
WHERE c.slug = 'coachwerks-restoration' AND gw.slug = 'gunther-werks'
ON CONFLICT DO NOTHING;

-- HK Motorcars exclusive for Glickenhaus
INSERT INTO organization_relationships (source_org_id, target_org_id, relationship_type, is_exclusive, territory, source_url, confidence_score)
SELECT hk.id, scg.id, 'exclusive_dealer_for', TRUE, 'Worldwide', 'https://www.carscoops.com/2024/12/glickenhaus-finally-starts-building-road-legal-004-supercar/', 0.90
FROM organizations hk, organizations scg
WHERE hk.slug = 'hk-motorcars' AND scg.slug = 'scuderia-cameron-glickenhaus'
ON CONFLICT DO NOTHING;

-- SpeedSport ↔ HK Motorcars service partnership
INSERT INTO organization_relationships (source_org_id, target_org_id, relationship_type, source_url, confidence_score)
SELECT ss.id, hk.id, 'service_partner', 'https://sstauto.com/2021/04/11/hk-motorcars-and-speedsport-tuning/', 0.90
FROM organizations ss, organizations hk
WHERE ss.slug = 'speedsport-tuning' AND hk.slug = 'hk-motorcars'
ON CONFLICT DO NOTHING;

-- GAIN Group parent of Coachwerks
INSERT INTO organization_hierarchy (parent_organization_id, child_organization_id, relationship_type)
SELECT g.id, c.id, 'subsidiary'
FROM organizations g, organizations c
WHERE g.slug = 'gain-group' AND c.slug = 'coachwerks-restoration'
ON CONFLICT DO NOTHING;

-- GW9 sub-brand of Gunther Werks
INSERT INTO organization_hierarchy (parent_organization_id, child_organization_id, relationship_type)
SELECT gw.id, gw9.id, 'division'
FROM organizations gw, organizations gw9
WHERE gw.slug = 'gunther-werks' AND gw9.slug = 'gw9-design'
ON CONFLICT DO NOTHING;

-- Singer partner relationships
INSERT INTO organization_relationships (source_org_id, target_org_id, relationship_type, territory, confidence_score)
SELECT partner.id, s.id, 'dealer_for', p.territory, 0.85
FROM organizations s,
(VALUES
  ('pfaff-automotive', 'Canada'),
  ('zagame-automotive', 'Australia & New Zealand'),
  ('seven-car-lounge', 'Arabian Gulf')
) AS p(slug, territory)
JOIN organizations partner ON partner.slug = p.slug
WHERE s.slug = 'singer-vehicle-design'
ON CONFLICT DO NOTHING;

-- RUF dealer relationships
INSERT INTO organization_relationships (source_org_id, target_org_id, relationship_type, territory, confidence_score)
SELECT dealer.id, r.id, rel_type, d.territory, 0.80
FROM organizations r,
(VALUES
  ('rstrada', 'West Coast US', 'exclusive_dealer_for'),
  ('coachwerks-restoration', 'Canada', 'dealer_for')
) AS d(slug, territory, rel_type)
JOIN organizations dealer ON dealer.slug = d.slug
WHERE r.slug = 'ruf-automobile'
ON CONFLICT DO NOTHING;

-- HK Motorcars consigns through BaT
INSERT INTO organization_relationships (source_org_id, target_org_id, relationship_type, source_url, confidence_score)
SELECT hk.id, bat.id, 'consigns_through', 'https://www.hkmotorcars.com/sellorconsign', 0.85
FROM organizations hk, organizations bat
WHERE hk.slug = 'hk-motorcars' AND bat.slug = 'bring-a-trailer'
ON CONFLICT DO NOTHING;

-- Competition relationships
INSERT INTO organization_relationships (source_org_id, target_org_id, relationship_type, confidence_score, metadata)
SELECT a.id, b.id, 'competes_with', 0.75, '{"segment": "Porsche 911 restomods"}'::jsonb
FROM organizations a, organizations b
WHERE a.slug = 'gunther-werks' AND b.slug = 'singer-vehicle-design'
ON CONFLICT DO NOTHING;

INSERT INTO organization_relationships (source_org_id, target_org_id, relationship_type, confidence_score, metadata)
SELECT a.id, b.id, 'competes_with', 0.70, '{"segment": "Porsche restomods"}'::jsonb
FROM organizations a, organizations b
WHERE a.slug = 'gunther-werks' AND b.slug = 'ruf-automobile'
ON CONFLICT DO NOTHING;

-- SSC → Manhattan Motorcars
INSERT INTO organization_relationships (source_org_id, target_org_id, relationship_type, territory, source_url, confidence_score)
SELECT mm.id, ssc.id, 'dealer_for', 'Northeast US', 'https://www.sscnorthamerica.com/news/manhattan-motorcars-dealer-partnership', 0.85
FROM organizations mm, organizations ssc
WHERE mm.slug = 'manhattan-motorcars' AND ssc.slug = 'ssc-north-america'
ON CONFLICT DO NOTHING;

-- ============================================================
-- ORGANIZATION BRANDS
-- ============================================================

-- O'Gara Coach brands
INSERT INTO organization_brands (organization_id, brand_name, authorization_level, operating_name, source_url)
SELECT o.id, b.brand, b.auth, b.op_name, 'https://www.ogaracoach.com'
FROM organizations o,
(VALUES
  ('Bugatti', 'factory_authorized', NULL),
  ('Koenigsegg', 'factory_authorized', NULL),
  ('Rimac', 'factory_authorized', NULL),
  ('Pininfarina', 'factory_authorized', NULL),
  ('McLaren', 'factory_authorized', NULL),
  ('Bentley', 'factory_authorized', NULL),
  ('Rolls-Royce', 'factory_authorized', NULL),
  ('Lamborghini', 'factory_authorized', NULL),
  ('Aston Martin', 'factory_authorized', NULL),
  ('Maserati', 'factory_authorized', NULL),
  ('Alfa Romeo', 'factory_authorized', NULL),
  ('Genesis', 'factory_authorized', NULL),
  ('Gunther Werks', 'factory_authorized', NULL),
  ('Lanzante', 'exclusive', NULL)
) AS b(brand, auth, op_name)
WHERE o.slug = 'ogara-coach'
ON CONFLICT DO NOTHING;

-- Prestige Imports brands
INSERT INTO organization_brands (organization_id, brand_name, authorization_level, operating_name, source_url)
SELECT o.id, b.brand, b.auth, b.op_name, 'https://www.prestigeimports.com'
FROM organizations o,
(VALUES
  ('Lamborghini', 'factory_authorized', 'Lamborghini Miami'),
  ('Pagani', 'exclusive', 'Pagani of Miami'),
  ('Lotus', 'factory_authorized', 'Lotus of Miami'),
  ('Karma', 'factory_authorized', 'Karma Miami'),
  ('Czinger', 'factory_authorized', 'Czinger Miami'),
  ('Audi', 'factory_authorized', 'Prestige Audi'),
  ('Gunther Werks', 'factory_authorized', NULL)
) AS b(brand, auth, op_name)
WHERE o.slug = 'prestige-imports'
ON CONFLICT DO NOTHING;

-- HK Motorcars brands
INSERT INTO organization_brands (organization_id, brand_name, authorization_level, source_url)
SELECT o.id, b.brand, b.auth, 'https://www.hkmotorcars.com'
FROM organizations o,
(VALUES
  ('Glickenhaus', 'exclusive'),
  ('SSC North America', 'factory_authorized'),
  ('Gunther Werks', 'factory_authorized'),
  ('Kimera Automobili', 'factory_authorized'),
  ('Eccentrica', 'factory_authorized'),
  ('Nardone Automotive', 'factory_authorized'),
  ('HWA EVO', 'factory_authorized'),
  ('Fifteen Eleven', 'factory_authorized'),
  ('Meyers Manx', 'factory_authorized'),
  ('Kindred Motorworks', 'factory_authorized'),
  ('Cartainers', 'factory_authorized')
) AS b(brand, auth)
WHERE o.slug = 'hk-motorcars'
ON CONFLICT DO NOTHING;

-- Earth MotorCars brands
INSERT INTO organization_brands (organization_id, brand_name, authorization_level, operating_name, source_url)
SELECT o.id, b.brand, b.auth, b.op_name, 'https://www.earthmotorcars.com'
FROM organizations o,
(VALUES
  ('Lotus', 'factory_authorized', 'Lotus of Dallas'),
  ('Hennessey', 'factory_authorized', NULL),
  ('Backdraft Racing', 'factory_authorized', NULL),
  ('Gunther Werks', 'factory_authorized', NULL),
  ('Mercedes Luxury Vans', 'factory_authorized', NULL)
) AS b(brand, auth, op_name)
WHERE o.slug = 'earth-motorcars'
ON CONFLICT DO NOTHING;

-- Zagame brands
INSERT INTO organization_brands (organization_id, brand_name, authorization_level, source_url)
SELECT o.id, b.brand, b.auth, 'https://www.zag.com.au'
FROM organizations o,
(VALUES
  ('Pagani', 'exclusive'),
  ('Singer Vehicle Design', 'partner'),
  ('Ferrari', 'factory_authorized'),
  ('Lamborghini', 'factory_authorized'),
  ('McLaren', 'factory_authorized'),
  ('Bentley', 'factory_authorized'),
  ('Rolls-Royce', 'factory_authorized'),
  ('Aston Martin', 'factory_authorized')
) AS b(brand, auth)
WHERE o.slug = 'zagame-automotive'
ON CONFLICT DO NOTHING;

-- Pfaff brands
INSERT INTO organization_brands (organization_id, brand_name, authorization_level, operating_name, source_url)
SELECT o.id, b.brand, b.auth, b.op_name, 'https://www.pfaffauto.com'
FROM organizations o,
(VALUES
  ('Pagani', 'factory_authorized', 'Pagani of Toronto'),
  ('Singer Vehicle Design', 'partner', NULL),
  ('McLaren', 'factory_authorized', 'McLaren Toronto'),
  ('Czinger', 'factory_authorized', NULL),
  ('Porsche', 'factory_authorized', NULL)
) AS b(brand, auth, op_name)
WHERE o.slug = 'pfaff-automotive'
ON CONFLICT DO NOTHING;

-- Seven Car Lounge brands
INSERT INTO organization_brands (organization_id, brand_name, authorization_level, source_url)
SELECT o.id, b.brand, b.auth, 'https://www.sevencarlounge.com'
FROM organizations o,
(VALUES
  ('Koenigsegg', 'exclusive'),
  ('Singer Vehicle Design', 'partner')
) AS b(brand, auth)
WHERE o.slug = 'seven-car-lounge'
ON CONFLICT DO NOTHING;

-- ============================================================
-- DISCOVERED PERSONS
-- ============================================================

INSERT INTO discovered_persons (slug, full_name, primary_role, location, email, phone, social_links, known_for, expertise_areas, enrichment_status, enrichment_sources, confidence_score)
VALUES
  ('nat-mundy', 'Nat Mundy', 'Director of Sales', 'Mount Kisco, NY',
   'nat@hkmotorcars.com', '(914) 282-0714',
   '{"linkedin": "nathanielmundy"}'::jsonb,
   ARRAY['HK Motorcars Director of Sales', 'Exclusive Glickenhaus dealer contact'],
   ARRAY['exotic cars', 'coachbuilt vehicles', 'restomods'],
   'partial', ARRAY['https://www.hkmotorcars.com', 'https://www.linkedin.com/in/nathanielmundy/'], 0.80
  ),
  ('brett-david', 'Brett David', 'CEO', 'North Miami Beach, FL',
   NULL, NULL,
   '{"instagram": "@brett_david"}'::jsonb,
   ARRAY['Prestige Imports CEO', 'Took over dealership at age 19', 'Only East Coast Pagani dealer'],
   ARRAY['luxury automotive', 'exotic cars', 'Pagani', 'Lamborghini'],
   'partial', ARRAY['https://www.prestigeimports.com/story'], 0.85
  ),
  ('peter-nam', 'Peter Nam', 'Founder / CEO', 'Huntington Beach, CA',
   NULL, NULL,
   '{"instagram": "@vorsteinerpeter"}'::jsonb,
   ARRAY['Gunther Werks founder', 'Vorsteiner founder', 'GW9 Design'],
   ARRAY['Porsche restomods', 'carbon fiber', 'automotive design'],
   'partial', ARRAY['https://guntherwerks.com'], 0.80
  ),
  ('jim-glickenhaus', 'Jim Glickenhaus', 'Founder', 'New York, NY',
   NULL, NULL,
   '{}'::jsonb,
   ARRAY['Scuderia Cameron Glickenhaus founder', 'Le Mans racing', 'Film director', 'Car collector'],
   ARRAY['racing', 'supercars', 'motorsport', 'film'],
   'partial', ARRAY['https://glickenhausracing.com'], 0.80
  ),
  ('ryan-huffman', 'Ryan Huffman', 'Sales Contact', 'Beverly Hills, CA',
   'rhuffman@ogaracoach.com', '(310) 967-3960',
   '{}'::jsonb,
   ARRAY['O''Gara Coach Gunther Werks contact'],
   ARRAY['luxury automotive'],
   'stub', ARRAY['https://guntherwerks.com/dealer'], 0.60
  ),
  ('dave-hargraves', 'Dave Hargraves', 'Contact', 'Victoria, BC',
   'dave@coachwerks.com', '(250) 727-1213',
   '{}'::jsonb,
   ARRAY['Coachwerks/GAIN Group Gunther Werks contact'],
   ARRAY['restoration', 'collector cars'],
   'stub', ARRAY['https://guntherwerks.com/dealer'], 0.60
  ),
  ('richie-cuico', 'Richie Cuico', 'Sales & Marketing Manager', 'Franklin, TN',
   'sales@guntherwerksofnashville.com', '(615) 575-2025',
   '{}'::jsonb,
   ARRAY['Gunther Werks Nashville / Pagani of Nashville'],
   ARRAY['luxury automotive', 'Pagani', 'Gunther Werks'],
   'stub', ARRAY['https://guntherwerks.com/dealer'], 0.60
  ),
  ('vincent-golde', 'Vincent Golde', 'Owner', 'Franklin, TN',
   NULL, NULL,
   '{}'::jsonb,
   ARRAY['Pagani of Nashville owner', 'Previously ran Pagani Beverly Hills and Pagani Newport Beach'],
   ARRAY['Pagani', 'luxury automotive'],
   'stub', ARRAY['https://paganiofnashville.com'], 0.55
  ),
  ('bryan-shute', 'Bryan Shute', 'Contact', 'Connecticut',
   NULL, '(203) 730-0311',
   '{}'::jsonb,
   ARRAY['SpeedSport Tuning contact for SCG/HK Motorcars service'],
   ARRAY['Porsche service', 'race car preparation'],
   'stub', ARRAY['https://sstauto.com/2021/04/11/hk-motorcars-and-speedsport-tuning/'], 0.55
  ),
  ('justin-liu', 'Justin Liu', 'Contact', 'Hong Kong',
   'justin@sps-automotive.com', '+852 3159 6800',
   '{}'::jsonb,
   ARRAY['SPS Global Gunther Werks Asia contact'],
   ARRAY['luxury automotive', 'Asia-Pacific market'],
   'stub', ARRAY['https://guntherwerks.com/dealer'], 0.55
  )
ON CONFLICT (slug) DO UPDATE SET
  enrichment_status = EXCLUDED.enrichment_status,
  known_for = EXCLUDED.known_for;

-- ============================================================
-- PERSON-ORG ROLES
-- ============================================================

INSERT INTO person_organization_roles (person_id, organization_id, role_title, role_type, source_url)
SELECT p.id, o.id, r.role_title, r.role_type, r.source_url
FROM
(VALUES
  ('nat-mundy', 'hk-motorcars', 'Director of Sales', 'sales', 'https://www.hkmotorcars.com'),
  ('brett-david', 'prestige-imports', 'CEO', 'ceo', 'https://www.prestigeimports.com/story'),
  ('peter-nam', 'gunther-werks', 'Founder & CEO', 'founder', 'https://guntherwerks.com'),
  ('peter-nam', 'gw9-design', 'Founder', 'founder', 'https://gw9design.com'),
  ('jim-glickenhaus', 'scuderia-cameron-glickenhaus', 'Founder', 'founder', 'https://glickenhausracing.com'),
  ('ryan-huffman', 'ogara-coach', 'Gunther Werks Sales Contact', 'sales', 'https://guntherwerks.com/dealer'),
  ('dave-hargraves', 'coachwerks-restoration', 'Gunther Werks Contact', 'sales', 'https://guntherwerks.com/dealer'),
  ('richie-cuico', 'gunther-werks-nashville', 'Sales & Marketing Manager', 'sales', 'https://guntherwerks.com/dealer'),
  ('vincent-golde', 'gunther-werks-nashville', 'Owner', 'owner', 'https://paganiofnashville.com'),
  ('bryan-shute', 'speedsport-tuning', 'Service Contact', 'service', 'https://sstauto.com/2021/04/11/hk-motorcars-and-speedsport-tuning/'),
  ('justin-liu', 'sps-global', 'Sales Contact', 'sales', 'https://guntherwerks.com/dealer')
) AS r(person_slug, org_slug, role_title, role_type, source_url)
JOIN discovered_persons p ON p.slug = r.person_slug
JOIN organizations o ON o.slug = r.org_slug
ON CONFLICT DO NOTHING;

COMMIT;
