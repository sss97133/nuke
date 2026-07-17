-- Anon-safe projection of the Guest Book advertiser graph.
-- The frontend (anon key) cannot read publication_features (RLS), which hides
-- the advertiser graph from the app entirely. This view exposes ONLY
-- publishable fields — printed name, page, category, confidence, org link —
-- and deliberately omits the details jsonb (raw contact blocks stay
-- service-role-only, per the data-governance tiering).
create or replace view public.publication_features_public as
  select id, publication_id, publication, edition, page, printed_page,
         org_name_printed, category, feature_kind, confidence, org_id
  from public.publication_features;

comment on view public.publication_features_public is
  'Anon-readable advertiser graph: publishable fields only; contact details excluded by design.';

grant select on public.publication_features_public to anon, authenticated;