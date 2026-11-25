-- canonical_model_alias_retirements_v1: a generic noun is not a model's alias.
--
-- WHY. canonical_models.aliases (4,470 models, 21,810 aliases on 2026-11-25) maps free model text to a canonical model.
-- 48 aliases on 45 models are common nouns, not names: project (14), touring (14), junior (7), motor (6), engine (3),
-- car (2), bat (1), speed (1, on a model not named Speed). Any reader matching model text to an alias files 'my BMW car'
-- under BMW 3 Series, a Porsche 'junior' under the 356, a Dodge 'touring' under the D-Series. About 100 public and
-- private cars carry one of these nouns as their whole model text (Land Rover 'speed' 25, Dodge 'touring' 11, BMW 'car' 9,
-- Maxwell 'touring' 8, Porsche 'junior' 6, ...). The array had no writer and no supersession: rows came from migrations
-- and scripts.
--
-- ROWS.
--   canonical_generic_words(word PK, basis): a noun that names no model by itself. Seeded with the eight above, each
--     with the false pair that found it. Adding a word (body styles such as custom, roadster, pickup are measured on the
--     board, not ruled) is one row.
--   canonical_model_alias_retirements(model_id FK canonical_models, alias, word, basis, retired_at/by, restored_at/by):
--     the record of each alias taken out of a model's aliases, and how to put it back. One current row per model and
--     lower(alias).
-- WRITERS (service role only).
--   canonical_model_aliases_retire_generic(p_by): for every alias equal (lower, trimmed) to a generic word and not equal
--     to the model's own canonical_model, writes a retirement row and removes the alias from the array. Returns the count.
--   canonical_model_alias_restore(p_retirement_id, p_by, p_basis): stamps the retirement restored and puts the alias back;
--     refused while the word is still a canonical_generic_words row (rule the word first, then restore).
-- GUARD. canonical_models_alias_guard (BEFORE INSERT OR UPDATE OF aliases) refuses an alias that has a current retirement
--   row for that model, or that is a generic word other than the model's own name, so a seed or script re-run cannot
--   bring one back silently. The restore writer passes it by stamping the retirement first.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.canonical_generic_words (
  word text PRIMARY KEY CHECK (word = lower(btrim(word)) AND word ~ '^[a-z0-9-]+$'),
  basis text NOT NULL CHECK (length(btrim(basis)) >= 12)
);
CREATE TABLE IF NOT EXISTS public.canonical_model_alias_retirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES public.canonical_models(id) ON DELETE CASCADE,
  alias text NOT NULL,
  word text NOT NULL CHECK (word = lower(btrim(word))),  -- the rule word at retirement; no FK, so the word can be ruled non-generic later
  basis text NOT NULL CHECK (length(btrim(basis)) >= 12),
  retired_at timestamptz NOT NULL DEFAULT now(),
  retired_by text NOT NULL CHECK (retired_by ~ '^(agent|job):'),
  restored_at timestamptz,
  restored_by text CHECK (restored_by ~ '^(agent|job):'),
  restore_basis text,
  CHECK ((restored_at IS NULL) = (restored_by IS NULL) AND (restored_at IS NULL) = (restore_basis IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS canonical_model_alias_retirements_current
  ON public.canonical_model_alias_retirements (model_id, lower(btrim(alias))) WHERE restored_at IS NULL;
ALTER TABLE public.canonical_generic_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_model_alias_retirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.canonical_generic_words, public.canonical_model_alias_retirements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.canonical_generic_words, public.canonical_model_alias_retirements TO service_role;
COMMENT ON TABLE public.canonical_generic_words IS
  'canonical_model_alias_retirements_v1: a noun that names no model by itself; never a model alias unless it is that model''s own name.';
COMMENT ON TABLE public.canonical_model_alias_retirements IS
  'canonical_model_alias_retirements_v1: an alias taken out of canonical_models.aliases, with its rule and basis; restored_at puts it back. Written only by canonical_model_aliases_retire_generic and canonical_model_alias_restore.';

INSERT INTO public.canonical_generic_words (word, basis) VALUES
  ('car', 'false pair in the statement subject resolver (ta-labor 2026-11-25): ''my BMW car'' resolved to BMW 3 Series'),
  ('project', 'false pair (ta-labor 2026-11-25): ''my BMW project'' resolved through an alias on 14 models'),
  ('motor', 'false pair (ta-labor 2026-11-25): a generic noun aliased on 6 motorcycle and truck models'),
  ('engine', 'false pair (ta-labor 2026-11-25): a generic noun aliased on 3 models'),
  ('touring', 'false pair (ta-labor 2026-11-25): a body style word aliased on 14 models of different makes'),
  ('junior', 'false pair (ta-labor 2026-11-25): aliased on 7 models; a Porsche Junior is a tractor, not a 356'),
  ('bat', 'false pair (ta-labor 2026-11-25): the auction site abbreviation aliased on one model'),
  ('speed', 'false pair (ta-labor 2026-11-25): aliased on a Land Rover model not named Speed')
ON CONFLICT (word) DO NOTHING;

CREATE OR REPLACE FUNCTION public.canonical_models_alias_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $f$
DECLARE a text;
BEGIN
  IF NEW.aliases IS NULL THEN RETURN NEW; END IF;
  FOREACH a IN ARRAY NEW.aliases LOOP
    IF lower(btrim(a)) <> lower(btrim(coalesce(NEW.canonical_model, ''))) AND EXISTS (
         SELECT 1 FROM public.canonical_generic_words g WHERE g.word = lower(btrim(a))) THEN
      RAISE EXCEPTION 'canonical_models: alias % is a generic word (canonical_generic_words), not a name of model %', a, NEW.id;
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (
         SELECT 1 FROM public.canonical_model_alias_retirements r
          WHERE r.model_id = NEW.id AND lower(btrim(r.alias)) = lower(btrim(a)) AND r.restored_at IS NULL) THEN
      RAISE EXCEPTION 'canonical_models: alias % of model % is retired (canonical_model_alias_retirements); restore it with canonical_model_alias_restore', a, NEW.id;
    END IF;
  END LOOP;
  RETURN NEW;
END
$f$;

CREATE OR REPLACE FUNCTION public.canonical_model_aliases_retire_generic(p_by text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE n integer;
BEGIN
  IF p_by IS NULL OR p_by !~ '^(agent|job):' THEN RAISE EXCEPTION 'canonical_model_aliases_retire_generic: p_by must be agent:<name> or job:<name>'; END IF;
  WITH hit AS (
    SELECT m.id AS model_id, a.alias, g.word, g.basis
      FROM public.canonical_models m
     CROSS JOIN LATERAL unnest(m.aliases) AS a(alias)
      JOIN public.canonical_generic_words g ON g.word = lower(btrim(a.alias))
     WHERE lower(btrim(a.alias)) <> lower(btrim(coalesce(m.canonical_model, '')))
  ), rec AS (
    INSERT INTO public.canonical_model_alias_retirements (model_id, alias, word, basis, retired_by)
    SELECT model_id, alias, word, basis, p_by FROM hit
    ON CONFLICT (model_id, lower(btrim(alias))) WHERE restored_at IS NULL DO NOTHING
    RETURNING 1
  ), upd AS (
    UPDATE public.canonical_models m
       SET aliases = ARRAY(SELECT x FROM unnest(m.aliases) WITH ORDINALITY AS u(x, o)
                            WHERE NOT EXISTS (SELECT 1 FROM hit h WHERE h.model_id = m.id AND h.alias = u.x)
                            ORDER BY u.o)
     WHERE m.id IN (SELECT model_id FROM hit)
    RETURNING 1
  )
  SELECT count(*)::integer INTO n FROM hit;  -- rec and upd run to completion whether or not they are read
  RETURN n;
END
$f$;

CREATE OR REPLACE FUNCTION public.canonical_model_alias_restore(p_retirement_id uuid, p_by text, p_basis text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE r public.canonical_model_alias_retirements%ROWTYPE;
BEGIN
  IF p_by IS NULL OR p_by !~ '^(agent|job):' THEN RAISE EXCEPTION 'canonical_model_alias_restore: p_by must be agent:<name> or job:<name>'; END IF;
  IF length(btrim(coalesce(p_basis, ''))) < 12 THEN RAISE EXCEPTION 'canonical_model_alias_restore: a basis of at least 12 characters'; END IF;
  SELECT * INTO r FROM public.canonical_model_alias_retirements WHERE id = p_retirement_id AND restored_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'canonical_model_alias_restore: no current retirement %', p_retirement_id; END IF;
  IF EXISTS (SELECT 1 FROM public.canonical_generic_words g WHERE g.word = r.word) THEN
    RAISE EXCEPTION 'canonical_model_alias_restore: % is still a generic word; remove its canonical_generic_words row first', r.word; END IF;
  UPDATE public.canonical_model_alias_retirements
     SET restored_at = now(), restored_by = p_by, restore_basis = p_basis WHERE id = r.id;
  UPDATE public.canonical_models SET aliases = array_append(coalesce(aliases, '{}'), r.alias) WHERE id = r.model_id;
  RETURN r.id;
END
$f$;
REVOKE ALL ON FUNCTION public.canonical_models_alias_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canonical_model_aliases_retire_generic(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canonical_model_alias_restore(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_model_aliases_retire_generic(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.canonical_model_alias_restore(uuid, text, text) TO service_role;

-- Retire the current generic aliases, then arm the guard (a retirement row exists for each before the guard reads them).
SELECT public.canonical_model_aliases_retire_generic('job:migration-20261126020500') AS aliases_retired;

DROP TRIGGER IF EXISTS canonical_models_alias_guard ON public.canonical_models;
CREATE TRIGGER canonical_models_alias_guard
  BEFORE INSERT OR UPDATE OF aliases, canonical_model ON public.canonical_models
  FOR EACH ROW EXECUTE FUNCTION public.canonical_models_alias_guard();
