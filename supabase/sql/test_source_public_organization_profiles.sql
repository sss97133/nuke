-- Disposable PG17 fixtures; reuse the sanctioned creator's actual contract.
\set ON_ERROR_STOP on
\ir test_create_organization_batch_contract.sql

CREATE TABLE public.observation_sources (
  slug text PRIMARY KEY, display_name text, base_url text,
  business_id uuid REFERENCES public.organizations(id)
);
INSERT INTO public.organizations (id, business_name, website, is_public) VALUES
  ('d2f587a0-5993-4d2c-9032-0fb3dd94d995', 'Mecum Auctions', 'https://www.mecum.com', true),
  ('d2bd6370-11d1-4af0-8dd2-3de2c3899166', 'Bring a Trailer', 'https://bringatrailer.com', true),
  ('eb426570-c8e7-43c3-a4f1-8807ed9e075c', 'Bonhams', 'https://www.bonhams.com', true),
  ('fafd3529-5b39-4336-b500-c6720e3895b7', 'Hemmings', 'https://www.hemmings.com/', true),
  ('7a3d0d2a-c738-4d8a-a199-1a687aa6cdf4', 'Barrett-Jackson', 'https://www.barrett-jackson.com', true),
  ('f7c80592-6725-448d-9b32-2abf3e011cf8', 'PCarMarket', 'https://www.pcarmarket.com', false),
  ('0d435048-f2c5-47ba-bba0-4c18c6d58686', 'Collecting Cars', 'https://collectingcars.com', true),
  ('29d2afda-96dd-45e3-b649-620556bde874', 'Gooding & Company', 'https://goodingco.com', true),
  ('bf7f8e55-4abc-45dc-aae0-1df86a9f365a', 'Broad Arrow Auctions', 'https://www.broadarrowauctions.com', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Private Mecum Collection', 'https://www.mecum.com', false);
INSERT INTO public.observation_sources (slug, display_name, base_url) VALUES
  ('mecum','Mecum Auctions','https://mecum.com'), ('bat','Bring a Trailer','https://bringatrailer.com'),
  ('bonhams','Bonhams','https://bonhams.com'), ('hemmings','Hemmings','https://hemmings.com'),
  ('barrett-jackson','Barrett-Jackson','https://barrett-jackson.com'), ('pcarmarket','PCarMarket','https://pcarmarket.com'),
  ('collecting-cars','Collecting Cars','https://collectingcars.com'), ('gooding','Gooding & Company','https://goodingco.com'),
  ('broad-arrow','Broad Arrow Auctions','https://broadarrowauctions.com'), ('barnfinds','Barn Finds',NULL);
CREATE TEMP TABLE original_unrelated AS SELECT id, to_jsonb(o) AS original FROM public.organizations o
  WHERE id NOT IN (SELECT id FROM public.organizations WHERE website ~ '(mecum|bringatrailer|bonhams|hemmings|barrett-jackson|pcarmarket|collectingcars|goodingco|broadarrow)');

\ir ../migrations/20261010164828_source_public_organization_profiles.sql
SELECT pg_temp.ok('all ten source keys resolve to the intended platform',
  (SELECT count(*) FROM public.observation_sources s JOIN public.organizations o ON o.id=s.business_id
    WHERE o.business_name=s.display_name AND o.is_public) = 10);
SELECT pg_temp.ok('Barn Finds is created once through the sanctioned intake',
  (SELECT count(*) FROM public.organizations WHERE website='https://barnfinds.com' AND discovered_via='declared-source:barnfinds') = 1);
SELECT pg_temp.ok('Barn Finds country stays unknown and no ownership is invented',
  (SELECT country IS NULL AND discovered_by IS NULL AND uploaded_by IS NULL AND business_type IS NULL
    FROM public.organizations WHERE website='https://barnfinds.com'));
SELECT pg_temp.ok('private collection remains private and is not linked as a platform',
  (SELECT is_public=false FROM public.organizations WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    AND NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE business_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
SELECT pg_temp.ok('unrelated testimony is preserved', NOT EXISTS (
  SELECT 1 FROM original_unrelated u JOIN public.organizations o USING(id) WHERE u.original <> to_jsonb(o)));

\ir ../migrations/20261010164828_source_public_organization_profiles.sql
SELECT pg_temp.ok('replay never creates a duplicate Barn Finds profile',
  (SELECT count(*) FROM public.organizations WHERE website='https://barnfinds.com') = 1);
DO $$ BEGIN RAISE NOTICE 'ALL CONTRACTS PASSED: source public organization profiles'; END $$;
