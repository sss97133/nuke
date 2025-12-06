-- Seed Top Body Work Supply Brands
-- For indexing material manuals and TDS sheets

INSERT INTO brands (name, slug, industry, category, description) VALUES
-- Paint & Finishing Brands
('PPG', 'ppg', 'automotive', 'manufacturer', 'PPG Industries - Deltron, Omni, Shop-Line paint systems'),
('BASF', 'basf', 'automotive', 'manufacturer', 'BASF Automotive - Glasurit, R-M, Limco paint systems'),
('Sherwin-Williams', 'sherwin-williams', 'automotive', 'manufacturer', 'Sherwin-Williams Automotive Finishes'),
('Axalta', 'axalta', 'automotive', 'manufacturer', 'Axalta Coating Systems - Spies Hecker, Standox, Cromax'),
('Sikkens', 'sikkens', 'automotive', 'manufacturer', 'Sikkens Automotive Refinish (AkzoNobel)'),
('House of Kolor', 'house-of-kolor', 'automotive', 'manufacturer', 'House of Kolor - Custom paint systems'),
('DuPont', 'dupont', 'automotive', 'manufacturer', 'DuPont Automotive Refinish'),
('Valspar', 'valspar', 'automotive', 'manufacturer', 'Valspar Automotive Finishes'),

-- Primer, Filler & Body Work
('3M', '3m', 'parts', 'manufacturer', '3M Automotive - Adhesives, tapes, abrasives, body fillers'),
('Evercoat', 'evercoat', 'parts', 'manufacturer', 'Evercoat - Body fillers, glazes, primers'),
('USC', 'usc', 'parts', 'manufacturer', 'USC - Body fillers, primers, repair materials'),
('SEM', 'sem', 'parts', 'manufacturer', 'SEM Products - Adhesives, sealers, coatings'),
('Fusor', 'fusor', 'parts', 'manufacturer', 'Fusor - Structural adhesives for body repair'),
('Dynatron', 'dynatron', 'parts', 'manufacturer', 'Dynatron - Body fillers and repair materials'),
('Bondo', 'bondo', 'parts', 'manufacturer', 'Bondo - Body fillers and repair products'),

-- Sanding & Abrasives
('Mirka', 'mirka', 'tools', 'manufacturer', 'Mirka - Sanding systems and abrasives'),
('Norton', 'norton', 'tools', 'manufacturer', 'Norton Abrasives - Sanding discs and materials'),

-- Adhesives & Sealants
('Lord Corporation', 'lord-corporation', 'parts', 'manufacturer', 'Lord Corporation - Structural adhesives'),
('Henkel', 'henkel', 'parts', 'manufacturer', 'Henkel - Automotive adhesives and sealants (Loctite)'),

-- Restoration & Specialty
('Eastwood', 'eastwood', 'parts', 'manufacturer', 'Eastwood - Automotive restoration products and tools'),
('Rust-Oleum', 'rust-oleum', 'parts', 'manufacturer', 'Rust-Oleum - Protective coatings and primers')

ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  industry = EXCLUDED.industry,
  category = EXCLUDED.category;

COMMENT ON TABLE brands IS 'Master brand database for body work supplies, paint, tools, and materials';

