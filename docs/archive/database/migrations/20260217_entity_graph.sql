-- ============================================================
-- DISCOVERY INTELLIGENCE: Entity Graph Schema
-- Extends organizations + adds people + relationships + brands
-- ============================================================

BEGIN;

-- 1. ORGANIZATION RELATIONSHIPS (lateral, non-hierarchical)
CREATE TABLE organization_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  target_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  is_exclusive BOOLEAN DEFAULT FALSE,
  territory TEXT,
  since_date DATE,
  metadata JSONB DEFAULT '{}',
  confidence_score NUMERIC(3,2) DEFAULT 0.50,
  source_url TEXT,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_org_id, target_org_id, relationship_type)
);

ALTER TABLE organization_relationships ADD CONSTRAINT chk_org_rel_type
  CHECK (relationship_type IN (
    'dealer_for',
    'exclusive_dealer_for',
    'service_partner',
    'distributor_for',
    'competes_with',
    'shares_brand_with',
    'collaborates_with',
    'sponsors',
    'consigns_through',
    'sources_from',
    'supplies_to',
    'other'
  ));

CREATE INDEX idx_org_rel_source ON organization_relationships(source_org_id);
CREATE INDEX idx_org_rel_target ON organization_relationships(target_org_id);
CREATE INDEX idx_org_rel_type ON organization_relationships(relationship_type);

-- 2. ORGANIZATION BRANDS (what brands each dealer/distributor carries)
CREATE TABLE organization_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL,
  authorization_level TEXT NOT NULL DEFAULT 'authorized',
  brand_organization_id UUID REFERENCES organizations(id),
  operating_name TEXT,
  territory TEXT,
  source_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, brand_name, authorization_level)
);

ALTER TABLE organization_brands ADD CONSTRAINT chk_org_brand_auth
  CHECK (authorization_level IN (
    'factory_authorized',
    'exclusive',
    'partner',
    'pre_owned',
    'service_only',
    'aftermarket',
    'consignment'
  ));

CREATE INDEX idx_org_brands_org ON organization_brands(organization_id);
CREATE INDEX idx_org_brands_name ON organization_brands(brand_name);
CREATE INDEX idx_org_brands_brand_org ON organization_brands(brand_organization_id) WHERE brand_organization_id IS NOT NULL;

-- 3. DISCOVERED PERSONS (unclaimed profiles built from factual data)
CREATE TABLE discovered_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE,
  full_name TEXT NOT NULL,
  bio TEXT,
  avatar_url TEXT,
  primary_role TEXT,
  primary_organization_id UUID REFERENCES organizations(id),
  email TEXT,
  phone TEXT,
  location TEXT,
  social_links JSONB DEFAULT '{}',
  known_for TEXT[],
  expertise_areas TEXT[],
  enrichment_status TEXT DEFAULT 'stub',
  enrichment_sources TEXT[],
  last_enriched_at TIMESTAMPTZ,
  confidence_score NUMERIC(3,2) DEFAULT 0.50,
  claimed_by_profile_id UUID REFERENCES profiles(id),
  claimed_at TIMESTAMPTZ,
  search_vector TSVECTOR,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_disc_persons_slug ON discovered_persons(slug);
CREATE INDEX idx_disc_persons_name ON discovered_persons USING gin (lower(full_name) gin_trgm_ops);
CREATE INDEX idx_disc_persons_org ON discovered_persons(primary_organization_id) WHERE primary_organization_id IS NOT NULL;
CREATE INDEX idx_disc_persons_claimed ON discovered_persons(claimed_by_profile_id) WHERE claimed_by_profile_id IS NOT NULL;
CREATE INDEX idx_disc_persons_search ON discovered_persons USING gin (search_vector);
CREATE INDEX idx_disc_persons_enrichment ON discovered_persons(enrichment_status);

CREATE OR REPLACE FUNCTION discovered_persons_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.full_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.primary_role, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.bio, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.location, '')), 'D');
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_disc_persons_search
  BEFORE INSERT OR UPDATE ON discovered_persons
  FOR EACH ROW EXECUTE FUNCTION discovered_persons_search_update();

-- 4. PERSON-ORG ROLES
CREATE TABLE person_organization_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES discovered_persons(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_title TEXT NOT NULL,
  role_type TEXT DEFAULT 'staff',
  is_current BOOLEAN DEFAULT TRUE,
  start_date DATE,
  end_date DATE,
  source_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(person_id, organization_id, role_title)
);

ALTER TABLE person_organization_roles ADD CONSTRAINT chk_person_org_role_type
  CHECK (role_type IN (
    'founder', 'owner', 'ceo', 'executive',
    'staff', 'sales', 'service', 'marketing',
    'advisor', 'investor', 'collector', 'other'
  ));

CREATE INDEX idx_person_org_roles_person ON person_organization_roles(person_id);
CREATE INDEX idx_person_org_roles_org ON person_organization_roles(organization_id);

-- 5. ENRICHMENT LOG
CREATE TABLE entity_enrichment_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  enrichment_source TEXT NOT NULL,
  source_url TEXT,
  fields_updated TEXT[],
  previous_values JSONB,
  new_values JSONB,
  confidence_score NUMERIC(3,2),
  enriched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_enrichment_log_entity ON entity_enrichment_log(entity_type, entity_id);
CREATE INDEX idx_enrichment_log_time ON entity_enrichment_log(enriched_at DESC);

-- 6. ADD ENRICHMENT COLUMNS TO ORGANIZATIONS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'enrichment_status') THEN
    ALTER TABLE organizations ADD COLUMN enrichment_status TEXT DEFAULT 'stub';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'last_enriched_at') THEN
    ALTER TABLE organizations ADD COLUMN last_enriched_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'enrichment_sources') THEN
    ALTER TABLE organizations ADD COLUMN enrichment_sources TEXT[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'brands_carried') THEN
    ALTER TABLE organizations ADD COLUMN brands_carried TEXT[];
  END IF;
END $$;

-- 7. RLS POLICIES
ALTER TABLE organization_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovered_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_organization_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_enrichment_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read org relationships" ON organization_relationships FOR SELECT USING (true);
CREATE POLICY "Public read org brands" ON organization_brands FOR SELECT USING (true);
CREATE POLICY "Public read discovered persons" ON discovered_persons FOR SELECT USING (true);
CREATE POLICY "Public read person org roles" ON person_organization_roles FOR SELECT USING (true);
CREATE POLICY "Public read enrichment log" ON entity_enrichment_log FOR SELECT USING (true);

CREATE POLICY "Service writes org relationships" ON organization_relationships FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service writes org brands" ON organization_brands FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service writes discovered persons" ON discovered_persons FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service writes person org roles" ON person_organization_roles FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service writes enrichment log" ON entity_enrichment_log FOR ALL USING (auth.role() = 'service_role');

COMMIT;
