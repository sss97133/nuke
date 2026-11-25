-- reported_labor_hours_v1, writer half: the one way a reported labor statement lands.
--
-- WHY. Lead rulings 2026-11-25: the reported-hours statements land through ingest-observation with their source keys;
-- admission lives in the database, not the edge; a statement lands with vehicle_id NULL (proj_disposition marks a car
-- in_progress on any work_record row and vehicle_build_log_public prints every work_record on a public car, so a
-- commenter's hours about another car must not sit on the lot car); links are keys, not text.
--
-- ROWS.
--   reported_labor_statements (grain: one landed statement; PK observation_id FK vehicle_observations): the keyed
--     edges of the statement. Exactly one source row FK (source_comment_id auction_comments, source_build_post_id
--     build_posts, source_vehicle_id vehicles), page_vehicle_id FK vehicles (the page it appeared on, never the
--     subject), the resolved stated subject as a make+model pair (lead ruling 2026-11-25: subject_make_id
--     canonical_makes and subject_model_id canonical_models both set or both NULL; subject_make_alias_id make_alias_ref
--     when the make was written as an alias, only beside its make), system_key FK receipt_line_systems, the source registry row
--     (source_id FK observation_sources), the check's disposition (admitted | held) and reasons, figures, qualifiers,
--     speaker_role derived from the source row or NULL with its reason. Unique per (source row, quote hash, low,
--     high): a replay returns the landed row. vehicle_observations.source_comment_id is not used:
--     validate_comment_observation_source binds it to the lot car (vehicle_id = auction_comments.vehicle_id, kind
--     comment), which is the edge the lead ruled out.
--   record_reported_labor_statement(source_table, source_row_id, quote, low, high, qualifiers, reader) -> jsonb
--     (service role; the record_vehicle_statement shape). Runs reported_labor_statement_check; refused -> no write,
--     {disposition refused, reasons}. The source registry row is the house of the source row (auction_comments.platform,
--     build_threads.forum_source_id -> forum_sources.slug, coalesce(vehicles.auction_source, listing_source)) as an
--     observation_sources slug; none -> refused source_unregistered. The clock is the source row's: posted_at
--     (source_publication_time), else created_at (source_capture_time). Lands one vehicle_observations row (kind
--     work_record, property labor_hours_reported_low, vehicle_id NULL, extraction_method reported_labor_hours_v1,
--     content_text = the verbatim quote; no confidence_score is seeded) and its reported_labor_statements row.
--   admit_reported_labor_statement (BEFORE INSERT on vehicle_observations, WHEN the method or the contract is
--     reported_labor_hours_v1 or the row carries a property: a row keyed to labor_hours_reported_low/_high by any
--     other method is a statement too, ta-skeptic2 2026-11-25): refuses any row not written by the writer for exactly that id in this transaction,
--     or whose fixed columns differ (vehicle_id NULL, kind, property, method, contract, source, identifier, hash).
--     guard_reported_labor_statement_update / _delete: a landed statement is immutable except its supersession
--     columns and is never deleted.
-- Test: supabase/sql/test_reported_labor_statement_writer.sql (PG17, chained after the check test; live trigger
-- functions citation_required_write_check and validate_comment_observation_source installed from pg_get_functiondef).
-- One transaction: a lock_timeout on any CREATE TRIGGER rolls the whole file back, never leaves the guards missing.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.reported_labor_statements (
  observation_id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id),
  source_table text NOT NULL CHECK (source_table IN ('auction_comments', 'build_posts', 'vehicles')),
  source_comment_id uuid REFERENCES public.auction_comments(id),
  source_build_post_id uuid REFERENCES public.build_posts(id),
  source_vehicle_id uuid REFERENCES public.vehicles(id),
  source_id uuid NOT NULL REFERENCES public.observation_sources(id),
  page_vehicle_id uuid REFERENCES public.vehicles(id),
  quote_hash text NOT NULL,
  text_md5 text NOT NULL,
  low numeric NOT NULL CHECK (low > 0),
  high numeric CHECK (high IS NULL OR high >= low),
  disposition text NOT NULL CHECK (disposition IN ('admitted', 'held')),
  held_reasons text[] NOT NULL DEFAULT '{}',
  labor_scope text NOT NULL,
  statement_kind text NOT NULL,
  time_basis text NOT NULL,
  system_key text REFERENCES public.receipt_line_systems(system_key),
  system_key_null_reason text,
  speaker_role text,
  speaker_role_null_reason text,
  subject_make_id uuid REFERENCES public.canonical_makes(id),
  subject_make_alias_id bigint REFERENCES public.make_alias_ref(id),
  subject_model_id uuid REFERENCES public.canonical_models(id),
  landed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(source_comment_id, source_build_post_id, source_vehicle_id) = 1),
  CHECK ((source_table = 'auction_comments') = (source_comment_id IS NOT NULL)
     AND (source_table = 'build_posts') = (source_build_post_id IS NOT NULL)
     AND (source_table = 'vehicles') = (source_vehicle_id IS NOT NULL)),
  CHECK ((subject_make_id IS NULL) = (subject_model_id IS NULL)),
  CHECK (subject_make_alias_id IS NULL OR subject_make_id IS NOT NULL),
  CHECK ((speaker_role IS NULL) <> (speaker_role_null_reason IS NULL)),
  CHECK (system_key IS NULL OR system_key_null_reason IS NULL),
  CHECK ((disposition = 'held') = (cardinality(held_reasons) > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS reported_labor_statements_replay
  ON public.reported_labor_statements (source_table, coalesce(source_comment_id, source_build_post_id, source_vehicle_id),
                                       quote_hash, low, coalesce(high, -1));
COMMENT ON TABLE public.reported_labor_statements IS
  'reported_labor_hours_v1: one row per landed reported labor statement (PK the vehicle_observations row): its keyed edges (source row, page car, resolved subject, system key, source registry) and the check''s disposition. Written only by record_reported_labor_statement. A held row admits nothing and reaches no baseline.';
CREATE INDEX IF NOT EXISTS reported_labor_statements_page_vehicle_idx ON public.reported_labor_statements (page_vehicle_id);
CREATE INDEX IF NOT EXISTS reported_labor_statements_source_vehicle_idx ON public.reported_labor_statements (source_vehicle_id)
  WHERE source_vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reported_labor_statements_subject_model_idx ON public.reported_labor_statements (subject_model_id)
  WHERE subject_model_id IS NOT NULL;
-- Visibility, decided (ta-pipeline 2026-11-25): the observation rows carry vehicle_id NULL, so vo_authenticated_read shows
-- them to no anon or authenticated caller, and this table is service-role only. A public page reads them only through a
-- SECURITY DEFINER reader with its own test: the house registered, the quote verbatim, and a car (page, source or subject
-- resolved to a vehicle) named only when that vehicle is is_public AND deleted_at IS NULL. Until that reader exists they
-- are hidden by this decision, not by accident.
ALTER TABLE public.reported_labor_statements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reported_labor_statements FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.reported_labor_statements TO service_role;

CREATE OR REPLACE FUNCTION public.record_reported_labor_statement(
  p_source_table text, p_source_row_id uuid, p_quote text, p_low numeric, p_high numeric, p_qualifiers jsonb,
  p_reader jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE
  c jsonb;
  q jsonb := coalesce(p_qualifiers, '{}'::jsonb);
  v_slug text;
  src_id uuid;
  clock timestamptz;
  basis text;
  prop uuid;
  ident text;
  existing uuid;
  oid_ uuid := gen_random_uuid();
  sk jsonb;
BEGIN
  c := public.reported_labor_statement_check(p_source_table, p_source_row_id, p_quote, p_low, p_high, p_qualifiers);
  IF c ->> 'disposition' = 'refused' THEN
    RETURN jsonb_build_object('disposition', 'refused', 'reasons', c -> 'reasons', 'writes', 0);
  END IF;

  -- Two concurrent calls with one statement: the second waits here, then reads the first's row as its replay instead of
  -- failing on reported_labor_statements_replay (ta-pipeline 2026-11-25). The figures are trim_scale'd so 40 and 40.0 take
  -- one lock, as the replay index compares them as numbers (ta-skeptic2). The lock ends with the caller's transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended('reported_labor_hours_v1:' || p_source_table || ':' || p_source_row_id || ':'
                                                 || (c ->> 'quote_hash') || ':' || trim_scale(p_low) || ':' || coalesce(trim_scale(p_high)::text, ''), 0));
  SELECT r.observation_id INTO existing FROM public.reported_labor_statements r
   WHERE r.source_table = p_source_table
     AND coalesce(r.source_comment_id, r.source_build_post_id, r.source_vehicle_id) = p_source_row_id
     AND r.quote_hash = c ->> 'quote_hash' AND r.low = p_low AND coalesce(r.high, -1) = coalesce(p_high, -1);
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('disposition', c ->> 'disposition', 'observation_id', existing, 'duplicate', true, 'writes', 0);
  END IF;

  IF p_source_table = 'auction_comments' THEN
    SELECT a.platform, coalesce(a.posted_at, a.created_at),
           CASE WHEN a.posted_at IS NOT NULL THEN 'source_publication_time' ELSE 'source_capture_time' END
      INTO v_slug, clock, basis FROM public.auction_comments a WHERE a.id = p_source_row_id;
  ELSIF p_source_table = 'build_posts' THEN
    SELECT f.slug, coalesce(b.posted_at, b.created_at),
           CASE WHEN b.posted_at IS NOT NULL THEN 'source_publication_time' ELSE 'source_capture_time' END
      INTO v_slug, clock, basis
      FROM public.build_posts b JOIN public.build_threads t ON t.id = b.build_thread_id
      LEFT JOIN public.forum_sources f ON f.id = t.forum_source_id
     WHERE b.id = p_source_row_id;
  ELSE
    SELECT coalesce(v.auction_source, v.listing_source), v.created_at, 'source_capture_time'
      INTO v_slug, clock, basis FROM public.vehicles v WHERE v.id = p_source_row_id;
  END IF;
  SELECT s.id INTO src_id FROM public.observation_sources s WHERE s.slug = v_slug;
  IF src_id IS NULL OR clock IS NULL THEN
    RETURN jsonb_build_object('disposition', 'refused',
      'reasons', jsonb_build_array(CASE WHEN src_id IS NULL THEN 'source_unregistered' ELSE 'source_clock_missing' END), 'writes', 0);
  END IF;

  SELECT o.id INTO prop FROM public.observation_properties o WHERE o.property_key = 'labor_hours_reported_low';
  ident := 'reported_labor_hours_v1:' || p_source_table || ':' || p_source_row_id || ':' || (c ->> 'quote_hash')
           || ':' || trim_scale(p_low) || ':' || coalesce(trim_scale(p_high)::text, '');  -- 40 and 40.0 are one statement
  sk := c -> 'stated_subject_key';

  PERFORM set_config('nuke.reported_labor_writer', oid_::text, true);
  INSERT INTO public.vehicle_observations (id, vehicle_id, kind, property_id, observed_at, observed_at_basis, source_id,
    source_identifier, raw_source_ref, content_text, content_hash, extraction_method, structured_data, extraction_metadata)
  VALUES (oid_, NULL, 'work_record', prop, clock, basis, src_id, ident, p_source_table || ':' || p_source_row_id, p_quote,
    md5('reported-labor:' || ident), 'reported_labor_hours_v1',
    -- nulls stripped: an absent qualifier is absent, never a JSON null a key gate would count as an orphan
    jsonb_strip_nulls(jsonb_build_object('contract', 'reported_labor_hours_v1', 'disposition', c ->> 'disposition',
      'held_reasons', c -> 'held_reasons', 'low', p_low, 'high', p_high,
      'labor_scope', q ->> 'labor_scope', 'labor_statement_kind', q ->> 'labor_statement_kind',
      'labor_time_basis', q ->> 'labor_time_basis', 'labor_system_key', q ->> 'labor_system_key',
      'labor_system_key_null_reason', q ->> 'labor_system_key_null_reason',
      'speaker_role', c ->> 'speaker_role', 'speaker_role_null_reason', c ->> 'speaker_role_null_reason',
      'page_vehicle_id', c ->> 'page_vehicle_id', 'source_table', p_source_table, 'source_row_id', p_source_row_id,
      'text_md5', c ->> 'text_md5')),
    jsonb_build_object('reader', coalesce(p_reader, '{}'::jsonb), 'speaker_role_read', c -> 'speaker_role_read',
      'labor_stated_subject', q ->> 'labor_stated_subject'));
  PERFORM set_config('nuke.reported_labor_writer', '', true);

  INSERT INTO public.reported_labor_statements (observation_id, source_table, source_comment_id, source_build_post_id,
    source_vehicle_id, source_id, page_vehicle_id, quote_hash, text_md5, low, high, disposition, held_reasons, labor_scope,
    statement_kind, time_basis, system_key, system_key_null_reason, speaker_role, speaker_role_null_reason,
    subject_make_id, subject_make_alias_id, subject_model_id)
  VALUES (oid_, p_source_table,
    CASE WHEN p_source_table = 'auction_comments' THEN p_source_row_id END,
    CASE WHEN p_source_table = 'build_posts' THEN p_source_row_id END,
    CASE WHEN p_source_table = 'vehicles' THEN p_source_row_id END,
    src_id, (c ->> 'page_vehicle_id')::uuid, c ->> 'quote_hash', c ->> 'text_md5', p_low, p_high, c ->> 'disposition',
    ARRAY(SELECT jsonb_array_elements_text(c -> 'held_reasons')), q ->> 'labor_scope', q ->> 'labor_statement_kind',
    q ->> 'labor_time_basis', q ->> 'labor_system_key', q ->> 'labor_system_key_null_reason',
    c ->> 'speaker_role', c ->> 'speaker_role_null_reason',
    CASE WHEN sk ->> 'kind' = 'make_model_pair' THEN (sk ->> 'make_id')::uuid END,
    CASE WHEN sk ->> 'kind' = 'make_model_pair' THEN (sk ->> 'make_alias_id')::bigint END,
    CASE WHEN sk ->> 'kind' = 'make_model_pair' THEN (sk ->> 'model_id')::uuid END);

  RETURN jsonb_build_object('disposition', c ->> 'disposition', 'observation_id', oid_, 'held_reasons', c -> 'held_reasons',
    'speaker_role', c -> 'speaker_role', 'speaker_role_null_reason', c -> 'speaker_role_null_reason',
    'stated_subject_key', sk, 'duplicate', false, 'writes', 2);
END $fn$;
COMMENT ON FUNCTION public.record_reported_labor_statement(text, uuid, text, numeric, numeric, jsonb, jsonb) IS
  'reported_labor_hours_v1: the writer of reported labor statements (ingest-observation mode reported_labor_hours_v1 calls it). Runs reported_labor_statement_check; lands admitted and held statements with vehicle_id NULL and their keyed reported_labor_statements row; refuses malformed ones with reasons and no write; a replay returns the landed row.';
REVOKE ALL ON FUNCTION public.record_reported_labor_statement(text, uuid, text, numeric, numeric, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_reported_labor_statement(text, uuid, text, numeric, numeric, jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.is_reported_labor_property(p uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT p IS NOT NULL AND EXISTS (SELECT 1 FROM public.observation_properties o
                                    WHERE o.id = p AND o.property_key IN ('labor_hours_reported_low', 'labor_hours_reported_high'))
$function$;
-- Every role that writes vehicle_observations fires the gate (triggers run as the caller), so every role may call it;
-- it answers only whether an id is one of two public property keys.
GRANT EXECUTE ON FUNCTION public.is_reported_labor_property(uuid) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.admit_reported_labor_statement()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE
  sd jsonb := NEW.structured_data;
BEGIN
  IF NEW.extraction_method IS DISTINCT FROM 'reported_labor_hours_v1'
     AND sd ->> 'contract' IS DISTINCT FROM 'reported_labor_hours_v1'
     AND NOT public.is_reported_labor_property(NEW.property_id) THEN
    RETURN NEW;  -- fired for any row with a property; not a labor statement
  END IF;
  IF NEW.extraction_method IS DISTINCT FROM 'reported_labor_hours_v1'
     OR sd ->> 'contract' IS DISTINCT FROM 'reported_labor_hours_v1'
     -- set by the writer for exactly this row, in this transaction; the insert runs as the writer's owner
     OR nullif(current_setting('nuke.reported_labor_writer', true), '') IS DISTINCT FROM NEW.id::text
     OR current_user <> (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p
          WHERE p.oid = 'public.record_reported_labor_statement(text,uuid,text,numeric,numeric,jsonb,jsonb)'::regprocedure)
     OR NEW.vehicle_id IS NOT NULL OR NEW.kind IS DISTINCT FROM 'work_record'::public.observation_kind
     OR NEW.property_id IS DISTINCT FROM (SELECT o.id FROM public.observation_properties o WHERE o.property_key = 'labor_hours_reported_low')
     OR sd ->> 'disposition' NOT IN ('admitted', 'held')
     OR NEW.source_id IS NULL OR NEW.source_comment_id IS NOT NULL OR NEW.submitted_by_user_id IS NOT NULL
     OR NEW.source_identifier IS NULL OR NEW.source_identifier NOT LIKE 'reported_labor_hours_v1:%'
     OR NEW.content_text IS NULL
     OR NEW.observed_at IS NULL OR NEW.observed_at_basis IS NULL
     OR NEW.observed_at_basis NOT IN ('source_publication_time', 'source_capture_time')
     OR NEW.content_hash IS DISTINCT FROM md5('reported-labor:' || NEW.source_identifier)
     OR NEW.is_superseded IS TRUE OR NEW.superseded_by IS NOT NULL
     OR NEW.subject_type IS DISTINCT FROM 'vehicle' OR NEW.subject_id IS NOT NULL OR NEW.subject_organization_id IS NOT NULL THEN
    RAISE EXCEPTION 'a reported labor statement is admitted only through its writer' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_reported_labor_statement_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE
  open_cols text[] := ARRAY['is_superseded', 'superseded_by', 'superseded_at', 'lineage_chain', 'is_processed', 'processing_metadata'];
BEGIN
  IF OLD.extraction_method IS DISTINCT FROM 'reported_labor_hours_v1' AND NEW.extraction_method IS DISTINCT FROM 'reported_labor_hours_v1'
     AND OLD.structured_data ->> 'contract' IS DISTINCT FROM 'reported_labor_hours_v1'
     AND NEW.structured_data ->> 'contract' IS DISTINCT FROM 'reported_labor_hours_v1'
     AND NOT public.is_reported_labor_property(OLD.property_id) AND NOT public.is_reported_labor_property(NEW.property_id) THEN
    RETURN NEW;  -- fired for a row with a property; not a labor statement
  END IF;
  IF (to_jsonb(NEW) - open_cols) IS DISTINCT FROM (to_jsonb(OLD) - open_cols) THEN
    RAISE EXCEPTION 'a reported labor statement row is immutable; append a successor' USING ERRCODE = '23514';
  END IF;
  IF OLD.is_superseded IS TRUE AND (NEW.is_superseded IS NOT TRUE
      OR NEW.superseded_by IS DISTINCT FROM OLD.superseded_by OR NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
    RAISE EXCEPTION 'reported labor statement row already superseded' USING ERRCODE = '23514';
  END IF;
  IF NEW.is_superseded IS TRUE AND OLD.is_superseded IS NOT TRUE AND NOT EXISTS (
       SELECT 1 FROM public.vehicle_observations n WHERE n.id = NEW.superseded_by AND n.id <> OLD.id
         AND n.extraction_method = OLD.extraction_method
         AND n.structured_data ->> 'source_table' = OLD.structured_data ->> 'source_table'
         AND n.structured_data ->> 'source_row_id' = OLD.structured_data ->> 'source_row_id') THEN
    RAISE EXCEPTION 'a reported labor statement row is superseded only by a statement from the same source row' USING ERRCODE = '23514';
  END IF;
  IF NEW.is_superseded IS NOT TRUE AND (NEW.superseded_by IS NOT NULL OR NEW.superseded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a reported labor statement row is superseded only by its successor' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_reported_labor_statement_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
BEGIN
  RAISE EXCEPTION 'a reported labor statement row is never deleted; withdraw it with a successor' USING ERRCODE = '23514';
END $function$;

DROP TRIGGER IF EXISTS trg_admit_reported_labor_statement ON public.vehicle_observations;
CREATE TRIGGER trg_admit_reported_labor_statement BEFORE INSERT ON public.vehicle_observations FOR EACH ROW
  WHEN (NEW.extraction_method = 'reported_labor_hours_v1' OR (NEW.structured_data ->> 'contract') = 'reported_labor_hours_v1'
        OR NEW.property_id IS NOT NULL)
  EXECUTE FUNCTION public.admit_reported_labor_statement();
DROP TRIGGER IF EXISTS trg_guard_reported_labor_statement_update ON public.vehicle_observations;
CREATE TRIGGER trg_guard_reported_labor_statement_update BEFORE UPDATE ON public.vehicle_observations FOR EACH ROW
  WHEN (OLD.extraction_method = 'reported_labor_hours_v1' OR NEW.extraction_method = 'reported_labor_hours_v1'
        OR (OLD.structured_data ->> 'contract') = 'reported_labor_hours_v1' OR (NEW.structured_data ->> 'contract') = 'reported_labor_hours_v1'
        OR OLD.property_id IS DISTINCT FROM NEW.property_id)
  EXECUTE FUNCTION public.guard_reported_labor_statement_update();
DROP TRIGGER IF EXISTS trg_guard_reported_labor_statement_delete ON public.vehicle_observations;
CREATE TRIGGER trg_guard_reported_labor_statement_delete BEFORE DELETE ON public.vehicle_observations FOR EACH ROW
  WHEN (OLD.extraction_method = 'reported_labor_hours_v1' OR (OLD.structured_data ->> 'contract') = 'reported_labor_hours_v1')
  EXECUTE FUNCTION public.guard_reported_labor_statement_delete();

COMMIT;
