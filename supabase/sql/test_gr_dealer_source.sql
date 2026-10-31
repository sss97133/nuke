-- Empty disposable PG17 only. Source registration is idempotent, qualified and
-- preserves prior rows and curated trust.
CREATE TYPE public.source_species AS ENUM ('dealer','aggregator');
CREATE TYPE public.observation_kind AS ENUM ('listing','sale_result');
CREATE TABLE public.observation_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, display_name text NOT NULL,
 category text NOT NULL, base_url text, supported_observations public.observation_kind[],
 species public.source_species, species_set public.source_species[], species_evidence jsonb,
 base_trust_score numeric DEFAULT 0.50
);
INSERT INTO public.observation_sources(slug,display_name,category,base_trust_score)
 VALUES('existing-control','Synthetic control','dealer',0.73);
\ir ../migrations/20261031063500_register_existing_gr_dealer_source.sql
UPDATE public.observation_sources SET base_trust_score=0.61 WHERE slug='gr-auto-gallery';
\ir ../migrations/20261031063500_register_existing_gr_dealer_source.sql
DO $$ BEGIN
 IF (SELECT count(*) FROM public.observation_sources) <> 2 THEN RAISE EXCEPTION 'Registration duplicated or replaced another source'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE slug='gr-auto-gallery'
   AND species='dealer' AND species_set=ARRAY['dealer']::public.source_species[]
   AND supported_observations=ARRAY['listing']::public.observation_kind[] AND base_trust_score=0.61
   AND jsonb_array_length(species_evidence->'examined')=2) THEN RAISE EXCEPTION 'Registration lost qualification or overwrote curated trust'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE slug='existing-control' AND base_trust_score=0.73) THEN RAISE EXCEPTION 'Control changed'; END IF;
END $$;
