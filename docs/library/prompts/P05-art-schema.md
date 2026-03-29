# P05: Art Schema

## Context
Read these THOROUGHLY before executing:
- `docs/library/reference/encyclopedia/README.md` Sections 2-5 — complete art entity specs
- `docs/library/reference/encyclopedia/README.md` Section 12 — editions and multiples
- `docs/library/reference/dictionary/README.md` — all term definitions
- `docs/library/intellectual/theoreticals/entity-resolution-theory.md` — why art needs different resolution

## Prerequisites
P04 verified. `assets` table exists. Vehicles have `asset_id` populated.

## Scope
~20 new tables. All reference `assets.id`. All follow existing Nuke conventions (uuid PKs, timestamptz, comments on every column).

## IMPORTANT: Read the encyclopedia section for EACH table before creating it.

The encyclopedia defines the columns. Do not invent fields. Do not add fields the encyclopedia doesn't specify. If you think a field is missing, add it to the encyclopedia FIRST, then to the schema.

## Steps

1. Create all tables in a single migration. Order matters — parent tables before children, referenced tables before referencing tables.

**Creation order:**

```sql
-- 1. Artist profiles (extends user profiles)
CREATE TABLE artist_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, -- FK to auth.users or profiles table
  birth_date date,
  death_date date,
  birth_location text,
  death_location text,
  nationality text[], -- can be multiple
  active_period_start date,
  active_period_end date,
  primary_media text[], -- painting, sculpture, photography, etc.
  movements text[], -- Abstract Expressionism, Pop, etc.
  biography text,
  estate_org_id uuid, -- FK to organizations (the foundation/estate managing legacy)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Edition parents (for multiples)
CREATE TABLE edition_parents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  artist_id uuid, -- FK to artist_profiles.user_id
  title text,
  date_executed text, -- text not date — "circa 1965" is valid
  medium text,
  technique text,
  edition_size int,
  artist_proofs int DEFAULT 0,
  printer_proofs int DEFAULT 0,
  hors_commerce int DEFAULT 0,
  publisher_org_id uuid, -- FK to organizations (print workshop, foundry)
  source_id uuid, -- FK to observation_sources
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3. Artworks (the shell — like vehicles)
CREATE TABLE artworks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  artist_id uuid, -- FK to artist_profiles.user_id
  title text,
  date_executed text,
  date_precision text DEFAULT 'exact', -- exact/year/decade/circa
  medium text,
  support text, -- canvas, panel, paper, etc.
  dimensions_height numeric,
  dimensions_width numeric,
  dimensions_depth numeric,
  dimensions_unit text DEFAULT 'in', -- in/cm
  edition_parent_id uuid REFERENCES edition_parents(id),
  edition_number text, -- "3/250" or "AP 1/2"
  edition_total int,
  signed boolean,
  signed_location text,
  inscribed boolean,
  inscription_text text,
  catalogue_raisonne_ref text,
  current_location_org_id uuid, -- FK to organizations
  current_owner_id uuid, -- FK to profiles/users
  creation_location text,
  creation_context text,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT artworks_date_precision_check CHECK (
    date_precision = ANY(ARRAY['exact', 'year', 'decade', 'circa'])
  ),
  CONSTRAINT artworks_status_check CHECK (
    status = ANY(ARRAY['active', 'sold', 'destroyed', 'lost', 'stolen', 'disputed', 'archived'])
  )
);

-- 4. Artwork components (material resolution)
CREATE TABLE artwork_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artwork_id uuid NOT NULL REFERENCES artworks(id),
  component_type text NOT NULL, -- primary_support, ground, media, surface_treatment, support_structure, inscription, verso_marking
  component_subtype text, -- e.g., for media: oil, acrylic, watercolor
  description text,
  material text,
  condition_notes text,
  source_id uuid,
  created_at timestamptz DEFAULT now()
);

-- 5. Artwork images (same pattern as vehicle_images)
CREATE TABLE artwork_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artwork_id uuid NOT NULL REFERENCES artworks(id),
  asset_id uuid REFERENCES assets(id),
  url text NOT NULL,
  zone text, -- recto, verso, detail_signature, detail_surface, detail_edges, detail_frame, detail_labels, conservation, installation, historical
  caption text,
  photographer text,
  date_taken date,
  source_id uuid,
  source_url text,
  ai_processing_status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),

  CONSTRAINT ai_zone_check CHECK (
    zone IS NULL OR zone = ANY(ARRAY[
      'recto', 'verso', 'detail_signature', 'detail_surface', 'detail_edges',
      'detail_frame', 'detail_labels', 'conservation_uv', 'conservation_ir',
      'conservation_xray', 'installation', 'historical'
    ])
  )
);

-- 6. Exhibitions
CREATE TABLE exhibitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid, -- FK to organizations (hosting institution)
  title text NOT NULL,
  subtitle text,
  start_date date,
  end_date date,
  venue_name text,
  venue_city text,
  venue_country text,
  exhibition_type text,
  catalog_published boolean DEFAULT false,
  curator_user_id uuid,
  source_id uuid,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT exhibition_type_check CHECK (
    exhibition_type IS NULL OR exhibition_type = ANY(ARRAY[
      'solo', 'group', 'retrospective', 'survey', 'biennale',
      'art_fair_booth', 'permanent_collection', 'traveling'
    ])
  )
);

-- 7. Exhibition history (junction: artwork ↔ exhibition)
CREATE TABLE exhibition_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  exhibition_id uuid NOT NULL REFERENCES exhibitions(id),
  catalog_number text,
  was_for_sale boolean,
  sale_price numeric,
  sale_currency text,
  installation_notes text,
  source_id uuid,
  created_at timestamptz DEFAULT now(),

  UNIQUE(asset_id, exhibition_id)
);

-- 8. Provenance entries (shared across domains)
CREATE TABLE provenance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  owner_user_id uuid,
  owner_org_id uuid,
  owner_description text, -- "Private collection, New York"
  acquisition_method text,
  acquisition_date text, -- text for imprecise dates
  acquisition_date_precision text,
  disposition_method text,
  disposition_date text,
  disposition_date_precision text,
  location_during text,
  price_at_acquisition numeric,
  price_currency text,
  source_id uuid,
  confidence_score numeric,
  notes text,
  sort_order int,
  is_gap boolean DEFAULT false, -- marks provenance gaps explicitly
  gap_flag text, -- holocaust_era, freeport, rapid_transfer, undocumented
  created_at timestamptz DEFAULT now(),

  CONSTRAINT acquisition_method_check CHECK (
    acquisition_method IS NULL OR acquisition_method = ANY(ARRAY[
      'purchase', 'gift', 'bequest', 'commission', 'inheritance',
      'seizure', 'restitution', 'found', 'unknown'
    ])
  )
);

-- 9. Literature references
CREATE TABLE literature_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  publication_type text,
  title text,
  author text,
  publisher text,
  publication_date date,
  page_numbers text,
  plate_number text,
  figure_number text,
  is_illustrated boolean DEFAULT false,
  is_color boolean DEFAULT false,
  is_catalogue_raisonne boolean DEFAULT false,
  isbn text,
  issn text,
  source_id uuid,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT pub_type_check CHECK (
    publication_type IS NULL OR publication_type = ANY(ARRAY[
      'book', 'catalog', 'magazine_article', 'newspaper_article',
      'journal_article', 'dissertation', 'online'
    ])
  )
);

-- 10. Certificates of authenticity
CREATE TABLE certificates_of_authenticity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  issuing_org_id uuid,
  issuing_user_id uuid,
  issue_date date,
  certificate_number text,
  status text DEFAULT 'valid',
  status_changed_at timestamptz,
  notes text,
  document_url text,
  source_id uuid,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT coa_status_check CHECK (
    status = ANY(ARRAY['valid', 'revoked', 'disputed', 'superseded'])
  )
);

-- 11. Conservation history
CREATE TABLE conservation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  conservator_user_id uuid,
  conservator_org_id uuid,
  treatment_date date,
  treatment_end_date date,
  treatment_type text,
  treatment_description text,
  condition_before text,
  condition_after text,
  materials_used text,
  source_id uuid,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT treatment_type_check CHECK (
    treatment_type IS NULL OR treatment_type = ANY(ARRAY[
      'cleaning', 'relining', 'inpainting', 'varnish_removal',
      'structural_repair', 'frame_restoration', 'preventive', 'full_restoration'
    ])
  )
);

-- 12. Private sales
CREATE TABLE private_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  seller_user_id uuid,
  seller_org_id uuid,
  buyer_user_id uuid,
  buyer_org_id uuid,
  sale_date text,
  sale_date_precision text,
  price numeric,
  price_currency text DEFAULT 'USD',
  price_source text, -- invoice, insurance, legal, appraisal, reported, estimated
  intermediary_org_id uuid,
  confidential boolean DEFAULT true,
  source_id uuid,
  created_at timestamptz DEFAULT now()
);

-- 13. Appraisals
CREATE TABLE appraisals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  appraiser_user_id uuid,
  appraiser_org_id uuid,
  appraisal_date date,
  appraisal_type text,
  fair_market_value numeric,
  replacement_value numeric,
  price_currency text DEFAULT 'USD',
  source_id uuid,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT appraisal_type_check CHECK (
    appraisal_type IS NULL OR appraisal_type = ANY(ARRAY[
      'insurance', 'estate', 'donation', 'market', 'damage'
    ])
  )
);

-- 14. Org staff (the hidden power layer)
CREATE TABLE org_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  role text NOT NULL,
  start_date date,
  end_date date,
  is_public boolean DEFAULT true,
  source_id uuid,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT org_staff_role_check CHECK (
    role = ANY(ARRAY[
      'director', 'curator', 'registrar', 'handler', 'advisor',
      'sales', 'preparator', 'archivist', 'conservator', 'publisher',
      'editor', 'photographer', 'writer', 'designer', 'manager'
    ])
  )
);

-- 15. Artist representation (gallery relationships)
CREATE TABLE artist_representation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL, -- FK to artist_profiles.user_id
  gallery_id uuid NOT NULL, -- FK to organizations
  representation_type text DEFAULT 'non_exclusive',
  start_date date,
  end_date date,
  territory text, -- global, north_america, europe, asia, etc.
  source_id uuid,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT rep_type_check CHECK (
    representation_type = ANY(ARRAY['exclusive', 'non_exclusive', 'project', 'estate'])
  )
);

-- 16. User-org ownership (artists' LLCs, foundations)
CREATE TABLE user_org_ownership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  ownership_type text,
  start_date date,
  end_date date,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT ownership_type_check CHECK (
    ownership_type IS NULL OR ownership_type = ANY(ARRAY[
      'founder', 'beneficiary', 'director', 'trustee', 'partner', 'owner'
    ])
  )
);

-- Indexes for all new tables
CREATE INDEX idx_artworks_asset_id ON artworks(asset_id);
CREATE INDEX idx_artworks_artist_id ON artworks(artist_id);
CREATE INDEX idx_artworks_edition_parent ON artworks(edition_parent_id);
CREATE INDEX idx_artwork_images_artwork_id ON artwork_images(artwork_id);
CREATE INDEX idx_artwork_components_artwork_id ON artwork_components(artwork_id);
CREATE INDEX idx_exhibition_history_asset ON exhibition_history(asset_id);
CREATE INDEX idx_exhibition_history_exhibition ON exhibition_history(exhibition_id);
CREATE INDEX idx_provenance_entries_asset ON provenance_entries(asset_id);
CREATE INDEX idx_literature_references_asset ON literature_references(asset_id);
CREATE INDEX idx_coa_asset ON certificates_of_authenticity(asset_id);
CREATE INDEX idx_conservation_asset ON conservation_history(asset_id);
CREATE INDEX idx_private_sales_asset ON private_sales(asset_id);
CREATE INDEX idx_appraisals_asset ON appraisals(asset_id);
CREATE INDEX idx_org_staff_user ON org_staff(user_id);
CREATE INDEX idx_org_staff_org ON org_staff(org_id);
CREATE INDEX idx_artist_rep_artist ON artist_representation(artist_id);
CREATE INDEX idx_artist_rep_gallery ON artist_representation(gallery_id);
CREATE INDEX idx_artist_profiles_user ON artist_profiles(user_id);
```

2. Add comments to every column. Every. Single. One. Reference the encyclopedia section.

3. Update `assets` type check to include 'artwork':
```sql
-- Already done in P04 if forward-looking, but verify:
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_type_check
  CHECK (asset_type = ANY(ARRAY['vehicle', 'artwork']));
```

4. Extend `resolveEntity` in `_shared/resolveEntity.ts` to handle `asset_type: 'artwork'`:
- For artworks: no VIN equivalent (yet). Resolution by:
  - catalogue_raisonne_ref (if provided) → 0.95 confidence
  - source_url → 0.95 confidence
  - artist + title + date + dimensions → scored intersection, 0.80 threshold
  - image hash (future)

## Verify
```sql
-- All tables created
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
  'artworks', 'artwork_components', 'artwork_images', 'artist_profiles',
  'edition_parents', 'exhibitions', 'exhibition_history', 'provenance_entries',
  'literature_references', 'certificates_of_authenticity', 'conservation_history',
  'private_sales', 'appraisals', 'org_staff', 'artist_representation',
  'user_org_ownership'
)
ORDER BY tablename;
-- Should return 16 rows

-- Test: create an artwork through the system
INSERT INTO assets (asset_type, display_title) VALUES ('artwork', 'Test Artwork, 2026');
-- Then create corresponding artworks row with the asset_id
-- Verify cross-domain query works:
SELECT a.asset_type, a.display_title FROM assets a WHERE asset_type = 'artwork';
```

## Anti-Patterns
- Do NOT add columns the encyclopedia doesn't define. If you think something's missing, update the encyclopedia first.
- Do NOT create edge functions for art extraction in this prompt. Schema only. Functions come in P07.
- Do NOT add sample/test data beyond minimal verification inserts. Real data comes from scraping.
- Do NOT add triggers or RLS policies yet. Schema first, security later.
- Do NOT forget column comments. Every column must have a COMMENT ON explaining its purpose and referencing the encyclopedia section.

## Library Contribution
After completing:
- Add ALL new tables to `docs/library/reference/dictionary/tables.md`
- Update `docs/library/technical/schematics/entity-relationships.md` — add art entity diagram
- Update `docs/library/reference/almanac/README.md` — add table counts
- Update `docs/library/reference/encyclopedia/README.md` Sections 2-5 — mark as implemented
