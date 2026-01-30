-- ============================================
-- VEHICLE DOMAIN KNOWLEDGE
-- Known issues, terminology, and expertise per make/model
-- ============================================

-- 1. KNOWN ISSUES PER VEHICLE
-- What problems are common for this make/model/year range
CREATE TABLE IF NOT EXISTS vehicle_known_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vehicle match
  make TEXT NOT NULL,
  model TEXT,                          -- NULL = all models
  year_start INT,
  year_end INT,

  -- The issue
  issue_name TEXT NOT NULL,            -- "Power steering rack failure"
  issue_slug TEXT NOT NULL,            -- "ps-rack-failure"
  common_names TEXT[],                 -- ["morning sickness", "PS rack leak"]

  -- Classification
  category TEXT NOT NULL,              -- mechanical, electrical, structural, cosmetic
  severity TEXT NOT NULL,              -- minor, moderate, major, critical

  -- What to look for
  symptoms TEXT[],                     -- ["groaning when cold", "fluid leak"]
  affected_components TEXT[],          -- ["steering rack", "power steering pump"]

  -- Repair info
  typical_cost_min INT,                -- cents
  typical_cost_max INT,
  labor_hours DECIMAL(4,1),
  diy_difficulty TEXT,                 -- easy, moderate, hard, shop-only

  -- Content
  description TEXT,
  repair_notes TEXT,

  -- Source
  source_urls TEXT[],                  -- forum threads, TSBs, etc.
  confidence DECIMAL(3,2) DEFAULT 0.8,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS known_issues_vehicle ON vehicle_known_issues(make, model, year_start, year_end);
CREATE INDEX IF NOT EXISTS known_issues_slug ON vehicle_known_issues(issue_slug);


-- 2. DOMAIN TERMINOLOGY
-- Maps slang/enthusiast terms to canonical meanings
CREATE TABLE IF NOT EXISTS domain_terminology (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The term
  term TEXT NOT NULL,                  -- "morning sickness"
  term_normalized TEXT NOT NULL,       -- lowercase, trimmed

  -- What it means
  canonical_meaning TEXT NOT NULL,     -- "Power steering rack failure"
  category TEXT,                       -- mechanical, cosmetic, etc.
  sentiment TEXT NOT NULL,             -- positive, negative, neutral

  -- Scope
  applies_to_makes TEXT[],             -- ["Saab"] or NULL for universal
  applies_to_models TEXT[],

  -- Linked entities
  related_known_issue_id UUID REFERENCES vehicle_known_issues(id),
  related_part_id UUID REFERENCES parts(id),

  -- Metadata
  source TEXT,                         -- where we learned this
  confidence DECIMAL(3,2) DEFAULT 0.8,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS terminology_term ON domain_terminology(term_normalized);
CREATE INDEX IF NOT EXISTS terminology_makes ON domain_terminology USING gin(applies_to_makes);


-- 3. EXTRACTION QUALITY SCORES
-- Track quality of extractions for feedback loop
CREATE TABLE IF NOT EXISTS extraction_quality_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  discovery_id UUID REFERENCES observation_discoveries(id),
  vehicle_id UUID,

  -- Quality metrics
  has_source_quotes BOOLEAN DEFAULT false,
  quote_verified BOOLEAN,              -- did we find the quote in comments?
  insights_count INT,
  actionable_count INT,                -- insights with clear actions
  garbage_count INT,                   -- filtered out as useless

  -- Classification accuracy
  misclassified_positive_as_negative INT DEFAULT 0,
  misclassified_negative_as_positive INT DEFAULT 0,
  hallucinated_count INT DEFAULT 0,

  -- Scores
  specificity_score DECIMAL(3,2),      -- 0-1, how specific are the insights
  actionability_score DECIMAL(3,2),    -- 0-1, how actionable
  accuracy_score DECIMAL(3,2),         -- 0-1, verified against source

  -- Model info
  model_used TEXT,
  prompt_version TEXT,

  reviewed_by TEXT,                    -- NULL = auto, else user_id
  reviewed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now()
);


-- 4. SEED KNOWN ISSUES
-- Start with some common ones

-- Saab 99/900 Turbo
INSERT INTO vehicle_known_issues (make, model, year_start, year_end, issue_name, issue_slug, common_names, category, severity, symptoms, affected_components, typical_cost_min, typical_cost_max, labor_hours, diy_difficulty, description) VALUES
('Saab', '99', 1978, 1984, 'Power Steering Rack Failure', 'saab-ps-morning-sickness',
 ARRAY['morning sickness', 'PS rack leak', 'steering rack groan'],
 'mechanical', 'moderate',
 ARRAY['groaning noise when cold', 'power steering fluid leak', 'stiff steering on startup'],
 ARRAY['power steering rack', 'rack seals'],
 45000, 120000, 4.0, 'shop-only',
 'Common issue with Saginaw-sourced power steering racks. Called "morning sickness" because symptoms are worst when cold. Rack seals fail and cause groaning/leaking.')
ON CONFLICT DO NOTHING;

INSERT INTO vehicle_known_issues (make, model, year_start, year_end, issue_name, issue_slug, common_names, category, severity, symptoms, affected_components, typical_cost_min, typical_cost_max, labor_hours, diy_difficulty, description) VALUES
('Saab', '900', 1979, 1993, 'Power Steering Rack Failure', 'saab-ps-morning-sickness',
 ARRAY['morning sickness', 'PS rack leak', 'steering rack groan'],
 'mechanical', 'moderate',
 ARRAY['groaning noise when cold', 'power steering fluid leak', 'stiff steering on startup'],
 ARRAY['power steering rack', 'rack seals'],
 45000, 120000, 4.0, 'shop-only',
 'Common issue with Saginaw-sourced power steering racks in classic 900s.')
ON CONFLICT DO NOTHING;

-- Porsche 911 (air-cooled)
INSERT INTO vehicle_known_issues (make, model, year_start, year_end, issue_name, issue_slug, common_names, category, severity, symptoms, affected_components, typical_cost_min, typical_cost_max, labor_hours, diy_difficulty, description) VALUES
('Porsche', '911', 1965, 1998, 'IMS Bearing Failure', 'porsche-ims-bearing',
 ARRAY['IMS failure', 'intermediate shaft bearing', 'IMS grenade'],
 'mechanical', 'critical',
 ARRAY['engine noise', 'metal in oil', 'catastrophic engine failure'],
 ARRAY['intermediate shaft bearing', 'engine'],
 150000, 2000000, 8.0, 'shop-only',
 'Intermediate shaft bearing can fail catastrophically, destroying the engine. Most common in 1999-2008 996/997 but present in earlier cars too.')
ON CONFLICT DO NOTHING;

-- BMW E30
INSERT INTO vehicle_known_issues (make, model, year_start, year_end, issue_name, issue_slug, common_names, category, severity, symptoms, affected_components, typical_cost_min, typical_cost_max, labor_hours, diy_difficulty, description) VALUES
('BMW', '3 Series', 1982, 1994, 'Timing Belt Failure', 'bmw-e30-timing-belt',
 ARRAY['timing belt', 'cambelt'],
 'mechanical', 'critical',
 ARRAY['engine won''t start', 'bent valves', 'no compression'],
 ARRAY['timing belt', 'tensioner', 'water pump'],
 30000, 80000, 4.0, 'moderate',
 'M20 and M42 engines are interference - timing belt failure destroys valves. Must replace every 60k miles.')
ON CONFLICT DO NOTHING;

-- Mercedes W123
INSERT INTO vehicle_known_issues (make, model, year_start, year_end, issue_name, issue_slug, common_names, category, severity, symptoms, affected_components, typical_cost_min, typical_cost_max, labor_hours, diy_difficulty, description) VALUES
('Mercedes-Benz', '300D', 1977, 1985, 'Vacuum System Deterioration', 'mercedes-w123-vacuum',
 ARRAY['vacuum leak', 'door locks not working', 'climate control issues'],
 'mechanical', 'minor',
 ARRAY['doors won''t lock', 'AC not switching', 'idle issues'],
 ARRAY['vacuum lines', 'vacuum reservoir', 'check valve'],
 5000, 30000, 2.0, 'moderate',
 'Mercedes used vacuum for door locks, climate control, and transmission. Lines deteriorate with age.')
ON CONFLICT DO NOTHING;


-- 5. SEED TERMINOLOGY
INSERT INTO domain_terminology (term, term_normalized, canonical_meaning, category, sentiment, applies_to_makes) VALUES
('morning sickness', 'morning sickness', 'Power steering rack seal failure causing cold-start groaning', 'mechanical', 'negative', ARRAY['Saab']),
('numbers matching', 'numbers matching', 'Original engine/transmission matching factory records', 'provenance', 'positive', NULL),
('matching numbers', 'matching numbers', 'Original engine/transmission matching factory records', 'provenance', 'positive', NULL),
('IMS', 'ims', 'Intermediate shaft bearing (potential failure point)', 'mechanical', 'negative', ARRAY['Porsche']),
('garage queen', 'garage queen', 'Low-mileage vehicle kept in climate-controlled storage', 'condition', 'positive', NULL),
('driver quality', 'driver quality', 'Cosmetically imperfect but mechanically sound - meant to be driven', 'condition', 'neutral', NULL),
('patina', 'patina', 'Original aged finish, not restored - valued by some collectors', 'cosmetic', 'neutral', NULL),
('barn find', 'barn find', 'Vehicle discovered after long-term storage, often unrestored', 'provenance', 'positive', NULL),
('frame-off', 'frame-off', 'Complete restoration with body removed from frame', 'restoration', 'positive', NULL),
('rotisserie', 'rotisserie', 'Frame-off restoration using rotating mount for access', 'restoration', 'positive', NULL),
('correct', 'correct', 'Accurate to factory original specification', 'authenticity', 'positive', NULL),
('period correct', 'period correct', 'Accurate to the era, even if not original to this specific car', 'authenticity', 'positive', NULL),
('clone', 'clone', 'Modified to appear as a rarer/more valuable variant', 'authenticity', 'negative', NULL),
('tribute', 'tribute', 'Built to honor a specific model but not claiming to be original', 'authenticity', 'neutral', NULL),
('rust free', 'rust free', 'No significant corrosion - often from dry climate', 'condition', 'positive', NULL),
('california car', 'california car', 'From dry climate, typically less rust', 'provenance', 'positive', NULL),
('arizona car', 'arizona car', 'From dry climate, typically less rust', 'provenance', 'positive', NULL),
('swiss cheese', 'swiss cheese', 'Severe rust with holes throughout', 'condition', 'negative', NULL),
('PPI', 'ppi', 'Pre-purchase inspection by independent mechanic', 'process', 'neutral', NULL)
ON CONFLICT (term_normalized) DO NOTHING;


-- 6. RLS
ALTER TABLE vehicle_known_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_terminology ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_quality_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read vehicle_known_issues" ON vehicle_known_issues FOR SELECT USING (true);
CREATE POLICY "Public read domain_terminology" ON domain_terminology FOR SELECT USING (true);
CREATE POLICY "Public read extraction_quality_log" ON extraction_quality_log FOR SELECT USING (true);

CREATE POLICY "Service write vehicle_known_issues" ON vehicle_known_issues FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write domain_terminology" ON domain_terminology FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write extraction_quality_log" ON extraction_quality_log FOR ALL USING (auth.role() = 'service_role');
