-- 20260524_user_profile_oidc_scim_floor.sql
-- Materialize the OIDC + SCIM intersection as first-class substrate so Nuke
-- meets industry-baseline definition of "having a user profile."
--
-- Per Skylar 2026-05-24 directive after agent research: Nuke is BELOW floor on
-- the standard identity layer (everything is in auth.users.raw_user_meta_data
-- JSON blob or implicit in Profile.tsx) and ABOVE floor on the rich behavioral
-- layer (user_contributions + user_observations + possessions). The two are
-- stacked, not competing. This migration adds the missing floor so the rich
-- layer has a clean anchor.
--
-- Research grounding:
--   - OpenID Connect Core 1.0 §5.1 Standard Claims
--   - RFC 7643 SCIM Core Schema (esp. multi-valued attrs)
--   - RFC 6350 vCard 4.0
--   - schema.org Person
--   - Auth0 normalized profile (user_metadata vs app_metadata split)
--   - Kobsa (2001), Brusilovsky & Millán (2007) on UMUAI user-model dimensions
--
-- Hard Rule #2 justification: 6 new tables. Each is canonical in identity
-- standards (1:1 user_profiles, multi-valued user_emails/phones/addresses,
-- explicit user_roles, user_consents for privacy). None duplicate existing
-- substrate. raw_user_meta_data JSON is unstructured and unqueryable; this
-- replaces it with structured, indexed, RLS-policied storage.

-- ============================================================================
-- 1. user_profiles — 1:1 with auth.users; structured identity attributes
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Name components (OIDC §5.1, SCIM §4.1.1 name complex, vCard §6.2)
  display_name text,
  given_name text,
  family_name text,
  middle_name text,
  nickname text,
  preferred_username text UNIQUE,
  honorific_prefix text,
  honorific_suffix text,

  -- Media (OIDC `picture`, schema.org Person.image, vCard PHOTO)
  picture_url text,
  cover_photo_url text,

  -- Biography / interests (schema.org Person.description, Google People bio)
  bio text,
  interests text[],
  skills text[],

  -- Demographics (OIDC `birthdate`, vCard BDAY/GENDER)
  birthdate date,
  gender text,
  nationality text,                  -- ISO 3166-1 alpha-2

  -- i18n (OIDC `locale` BCP47, `zoneinfo` IANA TZ, SCIM `preferredLanguage`)
  locale text DEFAULT 'en-US',
  timezone text DEFAULT 'UTC',
  preferred_language text,

  -- Auth0 metadata buckets — extensibility without column churn
  -- user_metadata: user-editable, non-security (e.g., theme, dashboard prefs)
  -- app_metadata: system-managed, affects authz (e.g., feature flags, plan tier)
  user_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  app_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Provenance (OIDC `updated_at`, SCIM meta.created/meta.lastModified)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_profiles_preferred_username ON user_profiles(preferred_username) WHERE preferred_username IS NOT NULL;
CREATE INDEX idx_user_profiles_user_metadata ON user_profiles USING gin(user_metadata);
CREATE INDEX idx_user_profiles_app_metadata ON user_profiles USING gin(app_metadata);

COMMENT ON TABLE user_profiles IS 'OIDC + SCIM canonical identity substrate. 1:1 with auth.users. Structured identity, demographics, i18n, plus Auth0-style metadata buckets for extensibility. Sits BENEATH user_contributions/user_observations (the Nuke-specific behavioral layer).';
COMMENT ON COLUMN user_profiles.user_metadata IS 'User-editable extension blob (theme, prefs). Auth0 pattern — does NOT affect authorization.';
COMMENT ON COLUMN user_profiles.app_metadata IS 'System-managed blob (plan, flags, internal tags). Auth0 pattern — DOES affect authorization decisions.';

-- ============================================================================
-- 2. user_emails — multi-valued, typed, verified (SCIM §4.1.2 multi-valued attr)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  type text NOT NULL DEFAULT 'personal' CHECK (type IN ('personal','work','other','alias')),
  is_primary boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  notes text,                        -- "gmail alias used for ebay receipts", etc.
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, email)
);

CREATE INDEX idx_user_emails_user_primary ON user_emails(user_id) WHERE is_primary = true;
CREATE INDEX idx_user_emails_email ON user_emails(email);
CREATE UNIQUE INDEX idx_user_emails_one_primary ON user_emails(user_id) WHERE is_primary = true;

COMMENT ON TABLE user_emails IS 'SCIM-shape multi-valued email attribute. Per OIDC + RFC 7643 a user can have multiple typed emails with exactly one primary.';

-- ============================================================================
-- 3. user_phones — multi-valued, typed, verified
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL,               -- E.164 format preferred
  type text NOT NULL DEFAULT 'mobile' CHECK (type IN ('mobile','home','work','fax','pager','other')),
  is_primary boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  carrier text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, phone)
);

CREATE INDEX idx_user_phones_user_primary ON user_phones(user_id) WHERE is_primary = true;
CREATE INDEX idx_user_phones_phone ON user_phones(phone);
CREATE UNIQUE INDEX idx_user_phones_one_primary ON user_phones(user_id) WHERE is_primary = true;

COMMENT ON TABLE user_phones IS 'SCIM-shape multi-valued phone attribute. E.164 format expected.';

-- ============================================================================
-- 4. user_addresses — OIDC §5.1.1 sub-structured Address Claim
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'home' CHECK (type IN ('home','shipping','billing','work','property','other')),
  formatted text,                    -- "707 Yucca St\nBoulder City, NV 89005\nUS"
  street_address text,               -- Full street incl. apartment/suite (newline-separated if multiline)
  locality text,                     -- City
  region text,                       -- State / province / prefecture
  postal_code text,
  country text,                      -- ISO 3166-1 alpha-2 (e.g., 'US')
  is_primary boolean NOT NULL DEFAULT false,
  property_id uuid,                  -- Optional link to properties table if address is a tracked property
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_addresses_user ON user_addresses(user_id);
CREATE UNIQUE INDEX idx_user_addresses_one_primary ON user_addresses(user_id) WHERE is_primary = true;
CREATE INDEX idx_user_addresses_country_region ON user_addresses(country, region);

COMMENT ON TABLE user_addresses IS 'OIDC Address Claim shape: sub-structured (street/locality/region/postal/country) + `formatted` rollup. Typed home/shipping/billing/property/etc.';

-- ============================================================================
-- 5. user_roles — explicit role assignments (replaces implicit Skylar-gating)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL,                -- 'owner', 'admin', 'shop_team', 'family', 'public_viewer', etc.

  -- Optional scoping — role applies within a specific subject (org/vehicle/global)
  scope_type text CHECK (scope_type IS NULL OR scope_type IN ('global','organization','vehicle','property')),
  scope_id uuid,                     -- the org/vehicle/property UUID this role applies within

  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id),
  expires_at timestamptz,            -- NULL = no expiry
  revoked_at timestamptz,            -- NULL = active
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_roles_user_active ON user_roles(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_user_roles_scope ON user_roles(scope_type, scope_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX idx_user_roles_unique_active ON user_roles(user_id, role, COALESCE(scope_type, ''), COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;

COMMENT ON TABLE user_roles IS 'Explicit SCIM-style role assignments. Each row = (user, role, optional scope). Replaces implicit Skylar-gating in views.';

-- ============================================================================
-- 6. user_consents — privacy/data-sharing consent records
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_scope text NOT NULL,       -- 'data_share_anthropic', 'public_profile', 'analytics', 'agent_write_access', etc.
  granted boolean NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,            -- NULL = still in granted state
  consent_text text,                 -- The actual language the user agreed to
  consent_version text,              -- TOS/Privacy policy version they agreed under
  evidence_url text,                 -- Link to the form/page where consent was captured
  evidence_method text,              -- 'click_through', 'verbal', 'email_confirm', 'in_app_modal'
  ip_address inet,
  user_agent text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_consents_user_scope ON user_consents(user_id, consent_scope);
CREATE INDEX idx_user_consents_active ON user_consents(user_id, consent_scope) WHERE revoked_at IS NULL AND granted = true;

COMMENT ON TABLE user_consents IS 'Privacy / data-sharing consent records. Required for GDPR-style compliance and for third-party data-share scoping. Each consent has provenance (consent_version, evidence_url, ip+ua).';

-- ============================================================================
-- updated_at trigger function (shared)
-- ============================================================================
CREATE OR REPLACE FUNCTION user_profile_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION user_profile_touch_updated_at();
CREATE TRIGGER trg_user_emails_updated_at BEFORE UPDATE ON user_emails FOR EACH ROW EXECUTE FUNCTION user_profile_touch_updated_at();
CREATE TRIGGER trg_user_phones_updated_at BEFORE UPDATE ON user_phones FOR EACH ROW EXECUTE FUNCTION user_profile_touch_updated_at();
CREATE TRIGGER trg_user_addresses_updated_at BEFORE UPDATE ON user_addresses FOR EACH ROW EXECUTE FUNCTION user_profile_touch_updated_at();
CREATE TRIGGER trg_user_roles_updated_at BEFORE UPDATE ON user_roles FOR EACH ROW EXECUTE FUNCTION user_profile_touch_updated_at();
CREATE TRIGGER trg_user_consents_updated_at BEFORE UPDATE ON user_consents FOR EACH ROW EXECUTE FUNCTION user_profile_touch_updated_at();

-- ============================================================================
-- RLS policies — user-personal data, locked to owner
-- ============================================================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_consents ENABLE ROW LEVEL SECURITY;

-- Owner-self-read on all
CREATE POLICY user_profiles_owner_select ON user_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_emails_owner_select ON user_emails FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_phones_owner_select ON user_phones FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_addresses_owner_select ON user_addresses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_roles_owner_select ON user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_consents_owner_select ON user_consents FOR SELECT USING (auth.uid() = user_id);

-- Owner-self-write on all
CREATE POLICY user_profiles_owner_modify ON user_profiles FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_emails_owner_modify ON user_emails FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_phones_owner_modify ON user_phones FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_addresses_owner_modify ON user_addresses FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- user_roles: owner can SELECT but only granters (admin role) can INSERT/UPDATE — for now allow self until role-granting flow exists
CREATE POLICY user_roles_owner_modify ON user_roles FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_consents_owner_modify ON user_consents FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- public profile select (when app_metadata.public = true) — optional, off for now
-- Add later when public-facing profile rendering is needed.
