SET statement_timeout = '10s';
SET lock_timeout = '2s';

-- Source registry metadata, not an edit to retained source testimony.
-- ECR pages describe registry presentations/collection claims; they are not sale outcomes.
UPDATE public.observation_sources
SET species = 'aggregator', species_set = ARRAY['aggregator']::public.source_species[],
    species_evidence = jsonb_build_object(
      'examined_at', '2026-10-31',
      'examined', jsonb_build_array(
        'listing_page_snapshots:893abd0e-0e00-4a1a-81a4-3d3ae8f76b77',
        'listing_page_snapshots:67a7ff32-c358-484b-9e7b-c1244c36f175',
        'listing_page_snapshots:5744a924-1b33-4b37-a7b1-b80a6237b95f'),
      'seen', 'Hash-verified retained collection pages distinguish Current/Previous cards and Load more. Detail pages contain public identity labels and Log in fields; some pages say This content is locked. No auction close or sale outcome is established.',
      'doc', 'docs/ledger/theory/data-machine-cases.md §6: aggregators map who exists; source claims are not physical identity or permission.',
      'extractor', 'ingest-observation retained_ecr_capture_v1',
      'listing_rule', 'Registry presentation only. Hidden fields stay unknown. Captured card lists are not exhaustive inventories or current ownership.'
    )
WHERE slug = 'exclusive-car-registry' AND species IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE slug='exclusive-car-registry' AND species='aggregator') THEN
    RAISE EXCEPTION 'ECR registry source absent or has a conflicting species; inspect before admitting data';
  END IF;
END $$;
