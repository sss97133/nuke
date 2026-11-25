-- labor_hours_basis_v1: every book hour states where it comes from; nothing is nulled.
--
-- WHY. Rule (lead, 2026-11-24, ruling 6): label the basis first, flip later. stage_transition_labor_map (28 rows) and
-- labor_operations (78 rows, 64 with base_hours) hold hours typed into seeds with no cited source (table comment
-- 'Seed data, manually curated'; no citation column or table existed). Nulling them emptied three bench cars' totals with
-- no path back (dry run 2026-11-24), the same shape as the establishment rule that emptied the site. So each row now
-- carries its basis as a key, every existing row is uncited_seed as measured, and a row can claim a better basis only by
-- a citation row. The flip (uncited rows stop counting) is a later rule row, per system, once that system's corpus or
-- paper cell passes the hours gate.
--
-- ROWS.
--   labor_hours_bases      basis_key PK, rank (1 best), meaning. shop_paper 1 > corpus_reported 2 > uncited_seed 3.
--   labor_hours_citations  one witness of a book row's hours: exactly one target (stage_transition_labor_map.id or
--                          labor_operations.code) and exactly one source key (receipt_items id: performed shop paper;
--                          vehicle_observations id: a reported-labor-hours observation; service_manual_chunks id: a
--                          printed flat-rate page), the hours as the source states them, cited_by. Ships empty.
--   stage_transition_labor_map.hours_basis, labor_operations.hours_basis  NOT NULL FK labor_hours_bases, default and
--                          every existing row uncited_seed.
--   constraint trigger     a row whose basis is not uncited_seed needs a citation row for it (checked on the row's insert
--                          or basis/hours update, and on a citation's delete or re-point). Deferred to commit.
-- No reader changes here; vehicle_labor_appraisal reads the basis after its stored fold lands (by_basis beside by_grade).
-- Test: supabase/sql/test_labor_hours_basis.sql (PG17).
--
-- REVERT. DROP the two triggers and the function; ALTER TABLE ... DROP COLUMN hours_basis on both tables;
-- DROP TABLE labor_hours_citations, labor_hours_bases.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.labor_hours_bases (
  basis_key text PRIMARY KEY CHECK (basis_key ~ '^[a-z][a-z0-9_]*$'),
  rank integer NOT NULL UNIQUE CHECK (rank > 0),
  meaning text NOT NULL
);
COMMENT ON TABLE public.labor_hours_bases IS
  'labor_hours_basis_v1: where a book hour comes from, ranked (1 best). A book row''s basis other than uncited_seed stands only with a labor_hours_citations row.';
INSERT INTO public.labor_hours_bases (basis_key, rank, meaning) VALUES
  ('shop_paper', 1, 'hours printed on performed shop paper (a receipt_items row of a non-quote receipt)'),
  ('corpus_reported', 2, 'hours from a baseline cell over landed reported-labor-hours observations that passed the hours gate; ranks below shop paper and above uncited_seed'),
  ('uncited_seed', 3, 'hours typed into a seed with no cited source; shown as book estimate, no cited source')
ON CONFLICT (basis_key) DO NOTHING;
ALTER TABLE public.labor_hours_bases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS labor_hours_bases_read ON public.labor_hours_bases;
CREATE POLICY labor_hours_bases_read ON public.labor_hours_bases FOR SELECT USING (true);
REVOKE ALL ON public.labor_hours_bases FROM anon, authenticated;
GRANT SELECT ON public.labor_hours_bases TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.labor_hours_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transition_id uuid REFERENCES public.stage_transition_labor_map(id) ON DELETE RESTRICT,
  operation_code text REFERENCES public.labor_operations(code) ON DELETE RESTRICT ON UPDATE CASCADE,
  receipt_item_id uuid REFERENCES public.receipt_items(id) ON DELETE RESTRICT,
  observation_id uuid REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  manual_chunk_id uuid REFERENCES public.service_manual_chunks(id) ON DELETE RESTRICT,
  hours_min numeric NOT NULL CHECK (hours_min >= 0),
  hours_typical numeric NOT NULL,
  hours_max numeric NOT NULL,
  cited_by text NOT NULL,
  cited_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT labor_hours_citations_one_target CHECK (num_nonnulls(transition_id, operation_code) = 1),
  CONSTRAINT labor_hours_citations_one_source CHECK (num_nonnulls(receipt_item_id, observation_id, manual_chunk_id) = 1),
  CONSTRAINT labor_hours_citations_range CHECK (hours_min <= hours_typical AND hours_typical <= hours_max)
);
CREATE INDEX IF NOT EXISTS labor_hours_citations_transition_idx ON public.labor_hours_citations (transition_id) WHERE transition_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS labor_hours_citations_operation_idx ON public.labor_hours_citations (operation_code) WHERE operation_code IS NOT NULL;
COMMENT ON TABLE public.labor_hours_citations IS
  'labor_hours_basis_v1: one witness of a book row''s hours (grain: stage_transition_labor_map row or labor_operations row x source row). Exactly one source key. Ships empty; a row lands only when a cited source exists. Service role only.';
ALTER TABLE public.labor_hours_citations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.labor_hours_citations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.labor_hours_citations TO service_role;

ALTER TABLE public.stage_transition_labor_map
  ADD COLUMN IF NOT EXISTS hours_basis text NOT NULL DEFAULT 'uncited_seed' REFERENCES public.labor_hours_bases(basis_key);
ALTER TABLE public.labor_operations
  ADD COLUMN IF NOT EXISTS hours_basis text NOT NULL DEFAULT 'uncited_seed' REFERENCES public.labor_hours_bases(basis_key);
COMMENT ON COLUMN public.stage_transition_labor_map.hours_basis IS
  'labor_hours_basis_v1: where this row''s estimated hours come from (labor_hours_bases). Every row was uncited_seed on 2026-11-24; another basis needs a labor_hours_citations row.';
COMMENT ON COLUMN public.labor_operations.hours_basis IS
  'labor_hours_basis_v1: where this row''s base_hours come from (labor_hours_bases). Every row was uncited_seed on 2026-11-24; another basis needs a labor_hours_citations row.';

CREATE OR REPLACE FUNCTION public.labor_hours_basis_cited()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'stage_transition_labor_map' THEN
    IF NEW.hours_basis <> 'uncited_seed'
       AND NOT EXISTS (SELECT 1 FROM public.labor_hours_citations c WHERE c.transition_id = NEW.id) THEN
      RAISE EXCEPTION 'labor_hours_basis: transition % claims basis % with no citation row', NEW.id, NEW.hours_basis
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'labor_operations' THEN
    IF NEW.hours_basis <> 'uncited_seed'
       AND NOT EXISTS (SELECT 1 FROM public.labor_hours_citations c WHERE c.operation_code = NEW.code) THEN
      RAISE EXCEPTION 'labor_hours_basis: operation % claims basis % with no citation row', NEW.code, NEW.hours_basis
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF OLD.transition_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.stage_transition_labor_map m
          WHERE m.id = OLD.transition_id AND m.hours_basis <> 'uncited_seed'
            AND NOT EXISTS (SELECT 1 FROM public.labor_hours_citations c WHERE c.transition_id = m.id)) THEN
      RAISE EXCEPTION 'labor_hours_basis: citation removed under transition % basis', OLD.transition_id USING ERRCODE = '23514';
    END IF;
    IF OLD.operation_code IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.labor_operations o
          WHERE o.code = OLD.operation_code AND o.hours_basis <> 'uncited_seed'
            AND NOT EXISTS (SELECT 1 FROM public.labor_hours_citations c WHERE c.operation_code = o.code)) THEN
      RAISE EXCEPTION 'labor_hours_basis: citation removed under operation % basis', OLD.operation_code USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS stage_transition_labor_map_basis_cited ON public.stage_transition_labor_map;
CREATE CONSTRAINT TRIGGER stage_transition_labor_map_basis_cited
  AFTER INSERT OR UPDATE OF hours_basis, estimated_hours_min, estimated_hours_typical, estimated_hours_max
  ON public.stage_transition_labor_map DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.labor_hours_basis_cited();
DROP TRIGGER IF EXISTS labor_operations_basis_cited ON public.labor_operations;
CREATE CONSTRAINT TRIGGER labor_operations_basis_cited
  AFTER INSERT OR UPDATE OF hours_basis, base_hours
  ON public.labor_operations DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.labor_hours_basis_cited();
DROP TRIGGER IF EXISTS labor_hours_citations_kept ON public.labor_hours_citations;
CREATE CONSTRAINT TRIGGER labor_hours_citations_kept
  AFTER DELETE OR UPDATE OF transition_id, operation_code
  ON public.labor_hours_citations DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.labor_hours_basis_cited();
