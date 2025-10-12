-- Shops core schema: Basic shop structure and membership

-- 1) Enums
CREATE TYPE shop_member_role AS ENUM ('owner', 'admin', 'staff', 'contractor');
CREATE TYPE member_status AS ENUM ('active', 'invited', 'pending', 'removed');
CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- 2) Shops table
CREATE TABLE IF NOT EXISTS shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  phone TEXT,
  website_url TEXT,
  description TEXT,
  location_city TEXT,
  location_state TEXT,
  location_country TEXT,
  logo_url TEXT,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Shop members
CREATE TABLE IF NOT EXISTS shop_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role shop_member_role NOT NULL DEFAULT 'staff',
  status member_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, user_id)
);

-- 4) Invitations
CREATE TABLE IF NOT EXISTS shop_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role shop_member_role NOT NULL DEFAULT 'staff',
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
  status invite_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5) Link shops to contributor workflow
ALTER TABLE vehicle_contributor_roles
  ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id) ON DELETE SET NULL;

ALTER TABLE contributor_documentation
  ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id) ON DELETE SET NULL;

ALTER TABLE contributor_onboarding
  ADD COLUMN IF NOT EXISTS submitted_by TEXT NOT NULL DEFAULT 'individual' CHECK (submitted_by IN ('individual','shop')),
  ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id) ON DELETE SET NULL;

-- 6) Enable RLS
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_invitations ENABLE ROW LEVEL SECURITY;

-- Shops policies
CREATE POLICY shop_select_for_members ON shops FOR SELECT
USING (
  owner_user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM shop_members sm WHERE sm.shop_id = shops.id AND sm.user_id = auth.uid() AND sm.status = 'active'
  )
);

CREATE POLICY shop_insert_owner ON shops FOR INSERT
WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY shop_update_owner_admin ON shops FOR UPDATE
USING (
  owner_user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM shop_members sm WHERE sm.shop_id = shops.id AND sm.user_id = auth.uid() AND sm.role IN ('owner','admin') AND sm.status = 'active'
  )
);

-- Shop members policies
CREATE POLICY shop_members_select_for_members ON shop_members FOR SELECT
USING (
  user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM shop_members sm2 WHERE sm2.shop_id = shop_members.shop_id AND sm2.user_id = auth.uid() AND sm2.status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM shops s WHERE s.id = shop_members.shop_id AND s.owner_user_id = auth.uid()
  )
);

CREATE POLICY shop_members_insert_by_owner_admin ON shop_members FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM shops s WHERE s.id = shop_members.shop_id AND s.owner_user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM shop_members sm WHERE sm.shop_id = shop_members.shop_id AND sm.user_id = auth.uid() AND sm.role IN ('owner','admin') AND sm.status = 'active'
  )
);

CREATE POLICY shop_members_update_by_owner_admin ON shop_members FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM shops s WHERE s.id = shop_members.shop_id AND s.owner_user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM shop_members sm WHERE sm.shop_id = shop_members.shop_id AND sm.user_id = auth.uid() AND sm.role IN ('owner','admin') AND sm.status = 'active'
  )
);

-- Invitations policies
CREATE POLICY shop_invites_select_for_owner_admin ON shop_invitations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM shops s WHERE s.id = shop_invitations.shop_id AND s.owner_user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM shop_members sm WHERE sm.shop_id = shop_invitations.shop_id AND sm.user_id = auth.uid() AND sm.role IN ('owner','admin') AND sm.status = 'active'
  )
);

CREATE POLICY shop_invites_insert_owner_admin ON shop_invitations FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM shops s WHERE s.id = shop_invitations.shop_id AND s.owner_user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM shop_members sm WHERE sm.shop_id = shop_invitations.shop_id AND sm.user_id = auth.uid() AND sm.role IN ('owner','admin') AND sm.status = 'active'
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_shops_owner ON shops(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_shop_members_user ON shop_members(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_members_shop ON shop_members(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_invites_shop ON shop_invitations(shop_id);
