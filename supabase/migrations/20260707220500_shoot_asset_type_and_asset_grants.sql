-- Shoot layer specimen #1: add 'shoot' to assets.asset_type and create asset_grants.
-- Justification: a photoshoot is a first-class asset (capture-event plane under all
-- verticals); grants are outbound provenance — the missing fourth verb (deposit/fold/
-- traverse/GRANT). Theory + canon verification:
-- docs/library/intellectual/discourses/2026-07-07_the-shoot-layer-and-the-grant.md
-- Discovery-first: this table holds ONLY what the first real delivery (Julie Rodrigo,
-- one-image-per-look) needs. Fields crystallize from real requests, not from spec.

ALTER TABLE assets DROP CONSTRAINT assets_asset_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_asset_type_check
  CHECK (asset_type = ANY (ARRAY['image'::text, 'vehicle'::text, 'garment'::text,
                                 'publication'::text, 'issue'::text, 'article'::text,
                                 'shoot'::text]));

CREATE TABLE asset_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  grantee_name text NOT NULL,
  grantee_contact text,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  terms text,
  delivery_url text,
  expires_at timestamptz,
  granted_at timestamptz,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status = ANY (ARRAY['draft','active','revoked','expired'])),
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_asset_grants_asset ON asset_grants(asset_id);

COMMENT ON TABLE asset_grants IS 'Outbound provenance: every release of an asset carries (grantee, scope, terms, expiry) + a pull log, mirroring inbound (source, method, observed_at, trust). A grant is delivery + record, never a storefront. Binding a grant (status draft -> active) is Sign-tier: owner action only. See discourse 2026-07-07_the-shoot-layer-and-the-grant.md.';
COMMENT ON COLUMN asset_grants.scope IS 'What is released: e.g. {"selection":"one-per-look","image_identity_ids":[...],"files":[...]}. Caveats may narrow scope downstream, never widen it.';
COMMENT ON COLUMN asset_grants.terms IS 'Human-readable usage terms. NULL until the owner writes/approves them; a grant with NULL terms must never be delivered (indicative != bindable).';
COMMENT ON COLUMN asset_grants.events IS 'Append-only pull/delivery log: [{"at":...,"event":"delivered|viewed|revoked",...}].';
