-- Core Organizations (Shops) schema and RPCs
-- Safe to re-run: uses IF NOT EXISTS and OR REPLACE where possible.

BEGIN;

-- Ensure UUID generation is available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================
-- Tables
-- ==========================

CREATE TABLE IF NOT EXISTS public.shops (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  business_type      text NOT NULL,
  website_url        text,
  description        text,
  phone              text,
  email              text,
  owner_user_id      uuid REFERENCES auth.users(id),
  tax_id             text,
  is_public          boolean DEFAULT true,
  verification_status text DEFAULT 'unverified',
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shops_owner ON public.shops(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_shops_business_type ON public.shops(business_type);

CREATE TABLE IF NOT EXISTS public.shop_locations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  name             text NOT NULL,
  street_address   text,
  city             text,
  state            text,
  postal_code      text,
  phone            text,
  email            text,
  is_headquarters  boolean DEFAULT false,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_locations_shop ON public.shop_locations(shop_id);

CREATE TABLE IF NOT EXISTS public.shop_licenses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id            uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  location_id        uuid REFERENCES public.shop_locations(id) ON DELETE SET NULL,
  license_type       text NOT NULL,
  license_number     text NOT NULL,
  issuing_authority  text,
  issuing_state      text,
  issued_date        date,
  expiration_date    date,
  is_active          boolean DEFAULT true,
  created_at         timestamptz DEFAULT now(),
  UNIQUE (shop_id, license_type, license_number)
);

CREATE INDEX IF NOT EXISTS idx_shop_licenses_shop ON public.shop_licenses(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_licenses_loc ON public.shop_licenses(location_id);

CREATE TABLE IF NOT EXISTS public.shop_departments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  location_id     uuid REFERENCES public.shop_locations(id) ON DELETE SET NULL,
  name            text NOT NULL,
  department_type text NOT NULL,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_departments_shop ON public.shop_departments(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_departments_loc ON public.shop_departments(location_id);

CREATE TABLE IF NOT EXISTS public.department_presets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_type    text NOT NULL,
  preset_name      text NOT NULL,
  department_type  text NOT NULL,
  is_recommended   boolean DEFAULT true,
  sort_order       integer DEFAULT 0,
  UNIQUE (business_type, department_type, preset_name)
);

-- Backward-compat: if department_presets already exists without preset_name, add it and backfill
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'department_presets'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'department_presets' AND column_name = 'preset_name'
    ) THEN
      ALTER TABLE public.department_presets ADD COLUMN preset_name text;
      -- If a legacy 'name' column exists, backfill preset_name from it
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'department_presets' AND column_name = 'name'
      ) THEN
        EXECUTE 'UPDATE public.department_presets SET preset_name = name WHERE preset_name IS NULL';
      END IF;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'department_presets' AND column_name = 'department_type'
    ) THEN
      ALTER TABLE public.department_presets ADD COLUMN department_type text;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'department_presets' AND column_name = 'is_recommended'
    ) THEN
      ALTER TABLE public.department_presets ADD COLUMN is_recommended boolean DEFAULT true;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'department_presets' AND column_name = 'sort_order'
    ) THEN
      ALTER TABLE public.department_presets ADD COLUMN sort_order integer DEFAULT 0;
    END IF;
  END IF;
END
$$;

-- Ensure unique constraint exists even on legacy tables
CREATE UNIQUE INDEX IF NOT EXISTS uq_department_presets 
  ON public.department_presets (business_type, department_type, preset_name);

CREATE TABLE IF NOT EXISTS public.shop_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('owner','admin','staff','contractor')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','inactive','removed')),
  department_id uuid REFERENCES public.shop_departments(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (shop_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_shop_members_shop ON public.shop_members(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_members_user ON public.shop_members(user_id);

CREATE TABLE IF NOT EXISTS public.shop_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('owner','admin','staff','contractor')),
  invited_by  uuid REFERENCES auth.users(id),
  token       text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (id)
);

CREATE INDEX IF NOT EXISTS idx_shop_invitations_shop ON public.shop_invitations(shop_id);
-- Enforce one pending invite per shop/email via partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_invitations_pending 
  ON public.shop_invitations (shop_id, email)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.shop_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  title         text,
  storage_path  text NOT NULL,
  file_url      text NOT NULL,
  mime_type     text,
  file_size     integer,
  is_sensitive  boolean DEFAULT true,
  visibility    text NOT NULL DEFAULT 'admin_only' CHECK (visibility IN ('public','members','admin_only')),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_documents_shop ON public.shop_documents(shop_id);

-- Link vehicles to organizations (for future timeline rollups)
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS owner_shop_id uuid REFERENCES public.shops(id);
CREATE INDEX IF NOT EXISTS idx_vehicles_owner_shop ON public.vehicles(owner_shop_id);

-- Verification requests (used by onboarding)
CREATE TABLE IF NOT EXISTS public.verification_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES auth.users(id),
  verification_type  text NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submission_data    jsonb,
  created_at         timestamptz DEFAULT now()
);

-- ==========================
-- Seeds (idempotent)
-- ==========================
DO $$
DECLARE has_dept_name boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='department_presets' AND column_name='department_name'
  ) INTO has_dept_name;

  IF has_dept_name THEN
    INSERT INTO public.department_presets (business_type, department_name, preset_name, department_type, is_recommended, sort_order)
    VALUES
      ('shop','Sales','Sales','sales', true, 1),
      ('shop','Service','Service','service', true, 2),
      ('shop','Detailing','Detailing','detailing', true, 3),
      ('dealer','Sales','Sales','sales', true, 1),
      ('dealer','Finance','Finance','finance', true, 2),
      ('dealer','Service','Service','service', true, 3)
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.department_presets (business_type, preset_name, department_type, is_recommended, sort_order)
    VALUES
      ('shop','Sales','sales', true, 1),
      ('shop','Service','service', true, 2),
      ('shop','Detailing','detailing', true, 3),
      ('dealer','Sales','sales', true, 1),
      ('dealer','Finance','finance', true, 2),
      ('dealer','Service','service', true, 3)
    ON CONFLICT (business_type, department_type, preset_name) DO NOTHING;
  END IF;
END
$$;

-- ==========================
-- RPCs (Functions)
-- ==========================

-- Clean up legacy signatures if present
DROP FUNCTION IF EXISTS public.create_shop_atomic(
  text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text
);

DROP FUNCTION IF EXISTS public.add_shop_license_atomic(
  uuid, uuid, text, text, text, date, date
);

-- Create shop and HQ location atomically
CREATE OR REPLACE FUNCTION public.create_shop_atomic(
  p_name           text,
  p_owner_user_id  uuid,
  p_business_type  text,
  p_website_url    text,
  p_description    text,
  p_phone          text,
  p_email          text,
  p_tax_id         text,
  p_hq_name        text,
  p_street         text,
  p_city           text,
  p_state          text,
  p_postal         text,
  p_hq_phone       text,
  p_hq_email       text
)
RETURNS TABLE (shop_id uuid, location_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shop_id uuid;
  v_loc_id  uuid;
BEGIN
  INSERT INTO public.shops (name, business_type, website_url, description, phone, email, owner_user_id, tax_id)
  VALUES (p_name, p_business_type, p_website_url, p_description, p_phone, p_email, p_owner_user_id, p_tax_id)
  RETURNING id INTO v_shop_id;

  INSERT INTO public.shop_locations (shop_id, name, street_address, city, state, postal_code, phone, email, is_headquarters)
  VALUES (v_shop_id, COALESCE(NULLIF(p_hq_name,''), 'Headquarters'), p_street, p_city, p_state, p_postal, p_hq_phone, p_hq_email, true)
  RETURNING id INTO v_loc_id;

  shop_id := v_shop_id;
  location_id := v_loc_id;
  RETURN;
END;
$$;

-- Add a shop license atomically
CREATE OR REPLACE FUNCTION public.add_shop_license_atomic(
  p_shop_id           uuid,
  p_location_id       uuid,
  p_license_type      text,
  p_license_number    text,
  p_issuing_authority text,
  p_issuing_state     text,
  p_issued_date       date,
  p_expiration_date   date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.shop_licenses (shop_id, location_id, license_type, license_number, issuing_authority, issuing_state, issued_date, expiration_date)
  VALUES (p_shop_id, p_location_id, p_license_type, p_license_number, p_issuing_authority, p_issuing_state, p_issued_date, p_expiration_date)
  ON CONFLICT (shop_id, license_type, license_number) DO NOTHING;
  RETURN;
END;
$$;

-- Create default departments from presets for a shop/location
CREATE OR REPLACE FUNCTION public.create_default_departments(
  p_shop_id       uuid,
  p_location_id   uuid,
  p_business_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN (
    SELECT preset_name, department_type
    FROM public.department_presets
    WHERE business_type = p_business_type AND is_recommended = true
    ORDER BY sort_order NULLS LAST, preset_name
  ) LOOP
    INSERT INTO public.shop_departments (shop_id, location_id, name, department_type)
    VALUES (p_shop_id, p_location_id, r.preset_name, r.department_type)
    ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN;
END;
$$;

COMMIT;
