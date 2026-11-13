-- Disposable database only. Exercise the actual source migration twice and its listing reader.
DO $$BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database required'; END IF;
END$$;
CREATE TYPE public.source_species AS ENUM ('timed_auction','block_house','dealer','classifieds','auth_walled_marketplace','aggregator','media_forum_video','owner_private');
CREATE TYPE public.observation_kind AS ENUM ('listing');
CREATE TABLE public.observation_sources (
  slug text PRIMARY KEY, display_name text, category text, base_url text, url_patterns text[],
  base_trust_score numeric DEFAULT 0.50, supported_observations public.observation_kind[], requires_auth boolean,
  notes text, species public.source_species, species_set public.source_species[], species_evidence jsonb
);
\ir ../migrations/20261109164109_register_mccormicks_source.sql
\ir ../migrations/20261109164109_register_mccormicks_source.sql
DO $$BEGIN
  IF NOT (SELECT species='block_house' AND species_set::text[]=ARRAY['block_house','dealer']
    AND jsonb_array_length(species_evidence->'examined')=4 FROM public.observation_sources WHERE slug='mccormicks')
    THEN RAISE EXCEPTION 'source classification/evidence missing'; END IF;
  IF public.listing_species_from_evidence('mccormicks','https://www.classic-carauction.com/auction-results?auctionnbr=80&auctionid=15164',NULL) IS DISTINCT FROM 'block_house'::public.source_species
    OR public.listing_species_from_evidence('mccormicks','https://www.classic-carauction.com/featured-cars?auctionid=123',NULL) IS DISTINCT FROM 'block_house'::public.source_species
    OR public.listing_species_from_evidence('mccormicks','https://www.classic-carauction.com/Showroom-Inventory?sp=1&id=2743',NULL) IS DISTINCT FROM 'dealer'::public.source_species
    THEN RAISE EXCEPTION 'auction/showroom channels conflated'; END IF;
  IF public.listing_species_from_evidence('mccormicks','https://classic-carauction.com.evil/auction-cars?auctionid=1',NULL) IS NOT NULL
    OR public.listing_species_from_evidence('mccormicks','https://www.classic-carauction.com/not-a-lot',NULL) IS NOT NULL
    THEN RAISE EXCEPTION 'unexamined route classified'; END IF;
  IF public.listing_species_from_evidence('barnfinds','https://barnfinds.com/bf-exclusive-x',NULL) IS DISTINCT FROM 'classifieds'::public.source_species
    OR public.listing_species_from_evidence('ebay_motors','https://www.ebay.com/itm/1','{"buying_options":["CLASSIFIED_AD"]}') IS DISTINCT FROM 'classifieds'::public.source_species
    THEN RAISE EXCEPTION 'existing classifier regressed'; END IF;
END$$;
