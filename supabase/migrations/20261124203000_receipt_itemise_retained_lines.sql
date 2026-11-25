-- Receipt lines that were read but never itemised: a scheduled fold moves them from the receipt's own stored reading
-- into receipt_items, so the readers that join receipt_items (build reconstruction, labor appraisal, part evidence,
-- organisation supply kinds) see that paper.
--
-- Measured 2026-11-24 (scripts/data/q.sh; population = receipts with a non-retired 'linked' receipt_vehicle_links row,
-- not superseded, no duplicate_of): 255 live linked receipts, 142 with 0 receipt_items. 116 of the 142 already hold
-- 338 lines inside their own extraction (raw_extraction.what.items from the 2025-10..2026-01 vehicle_documents upload
-- reader; raw_extraction.items; raw_extraction.data.line_items from the 2026-04-27 laptop OCR batch and
-- raw_json.data_v2.line_items from its 2026-05-01 re-extraction). The only step that ever moved such lines into
-- receipt_items was a hand run (2026-05-03, 2026-05-08). Nothing scheduled did. This makes it a rule table and a fold.
--
--   receipt_line_sources (rule rows): where a writer leaves a receipt's lines, in which order to trust them, and which
--     keys of a line element carry each receipt_items column. A new writer shape is a row, not a code change.
--     requires_reconcile: the source is used only when its lines sum to the document (lines + tax = total, or lines =
--     subtotal, within 1 %). Set for the regex OCR source: 4 of its 27 arrays reconciled on 2026-11-24.
--   receipt_itemisation_outcomes (grain: one receipt): what the fold decided for the receipt's current reading
--     (input_md5 of raw_extraction + raw_json, so a re-read reopens it). Outcomes other than 'itemised' are the work
--     list for a re-read: no_lines_held, held_unreconciled, held_would_contradict_total, refused_private_text,
--     held_same_file_sibling (sibling_receipt_id -> receipts: another live reading of the same original file already
--     carries the lines; the hold reopens by itself when that sibling stops being live or loses its lines).
--   receipt_items.line_source -> receipt_line_sources(source_key): which retained reading a line came from. NULL = the
--     line was written by the landing writer itself (land_document_pages, auto-sort-photos).
--   receipt_itemise_retained(p_limit, p_run): the fold. Service role and cron only. Per receipt (row locked, SKIP
--     LOCKED): the first active source by priority with >= 1 described line wins. Hours and performer are never taken
--     from a retained reading (only a landing writer that asked for printed hours writes them). Lines are refused when
--     they carry a card number or an e-mail address (the land_document_pages guard). A receipt is held, not itemised,
--     when its lines would flip its amount check to implausible (total above 3 x (lines + tax) + 50), because that
--     trigger holds the vehicle link and a partial reading is not evidence the total is wrong.
--   cron receipt-itemise-retained (hourly): new links and new readings are itemised without an agent.
--
-- Side effects are the existing triggers' own: each inserted line re-runs the receipt's amount check, document kind,
-- duplicate flag and catalog enqueue (receipt_items_recheck_amount). Simulated by SELECT on 2026-11-24 over the 142:
-- 49 receipts itemised (142 lines), 50 held as same-file siblings (163 lines that another reading of the same file
-- already carries or will carry), 1 held (would contradict its total), 0 links retired or held, 0 new duplicates. The backfill below asserts the live linked count does not fall.
-- Contract: supabase/sql/test_receipt_itemise_retained_lines.sql (PG17).
-- Revert: supabase/sql/revert_20261124203000_receipt_itemise_retained_lines.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '240s';

CREATE TABLE IF NOT EXISTS public.receipt_line_sources (
  source_key text PRIMARY KEY CHECK (source_key ~ '^[a-z_]+(\.[a-z0-9_]+)+$'),
  json_root text NOT NULL CHECK (json_root IN ('raw_extraction', 'raw_json')),
  json_path text[] NOT NULL CHECK (cardinality(json_path) BETWEEN 1 AND 4),
  priority integer NOT NULL UNIQUE,
  requires_reconcile boolean NOT NULL DEFAULT false,
  description_keys text[] NOT NULL CHECK (cardinality(description_keys) >= 1),
  part_number_keys text[] NOT NULL DEFAULT '{}',
  quantity_keys text[] NOT NULL DEFAULT '{}',
  unit_price_keys text[] NOT NULL DEFAULT '{}',
  total_keys text[] NOT NULL DEFAULT '{}',
  category_keys text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.receipt_line_sources IS 'Rule rows: where a receipt writer left the document''s lines inside receipts.raw_extraction / raw_json, the order to trust them (priority, lowest first) and which line-element keys carry each receipt_items column. Read by receipt_itemise_retained(). Grain: one retained-line location. Added 2026-11-24 from the measured shapes of the 142 live linked receipts with no receipt_items.';

INSERT INTO public.receipt_line_sources (source_key, json_root, json_path, priority, requires_reconcile, description_keys, part_number_keys, quantity_keys, unit_price_keys, total_keys, category_keys, note) VALUES
  ('raw_extraction.what.items', 'raw_extraction', '{what,items}', 10, false, '{description}', '{part_number,oem_number}', '{quantity}', '{unit_price}', '{total_price}', '{category}',
   'vehicle_documents upload reader 2025-10..2026-01 (who/what/when/where/why shape). 2026-11-24: 58 zero-line live receipts, 193 lines, 43 reconcile to the total.'),
  ('raw_extraction.items', 'raw_extraction', '{items}', 20, false, '{description}', '{part_number}', '{quantity}', '{unit_price}', '{total_price}', '{}',
   'items+ocr reader 2025-10..2026-01. 2026-11-24: 12 zero-line live receipts, 26 lines, 8 reconcile.'),
  ('raw_extraction.data_v2.line_items', 'raw_extraction', '{data_v2,line_items}', 30, false, '{description}', '{part_number,sku}', '{quantity,qty}', '{unit_price}', '{total_price}', '{category}',
   'LLM re-extraction stored on raw_extraction (2026-05). 2026-11-24: 3 zero-line live receipts, 10 lines, 3 reconcile.'),
  ('raw_json.data_v2.line_items', 'raw_json', '{data_v2,line_items}', 40, false, '{description}', '{part_number,sku}', '{quantity,qty}', '{unit_price}', '{total_price,amount}', '{category}',
   'LLM re-extraction of the 2026-04-27 laptop OCR batch (extractor v2-*, 2026-05-01). 2026-11-24: 28 zero-line live receipts, 85 lines, 8 reconcile by lines+tax, 12 by subtotal.'),
  ('raw_extraction.data.line_items', 'raw_extraction', '{data,line_items}', 50, true, '{description}', '{part_number}', '{quantity}', '{unit_price}', '{total_price}', '{}',
   'Regex lines of the 2026-04-27 laptop OCR batch (engine macos_vision_ocr+regex). Used only when they reconcile: 4 of 27 arrays did on 2026-11-24.'),
  ('raw_extraction.data.items', 'raw_extraction', '{data,items}', 60, false, '{name,description}', '{part_number}', '{quantity}', '{unit_price}', '{total,total_price}', '{}',
   'auto-sort-photos receipt writer (raw_extraction.engine auto-sort-photos): it inserts these lines itself; this row catches a receipt whose line insert failed.')
ON CONFLICT (source_key) DO NOTHING;

ALTER TABLE public.receipt_items
  ADD COLUMN IF NOT EXISTS line_source text REFERENCES public.receipt_line_sources(source_key);
COMMENT ON COLUMN public.receipt_items.line_source IS 'Which retained reading this line was itemised from (receipt_line_sources.source_key), written by receipt_itemise_retained(). NULL = written by the landing writer itself.';
-- One line per number per receipt (held on all 931 rows 2026-11-24); NULL line numbers (auto-sort-photos) stay allowed.
CREATE UNIQUE INDEX IF NOT EXISTS receipt_items_receipt_line_number_key ON public.receipt_items (receipt_id, line_number);

CREATE TABLE IF NOT EXISTS public.receipt_itemisation_outcomes (
  receipt_id uuid PRIMARY KEY REFERENCES public.receipts(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('itemised', 'no_lines_held', 'held_unreconciled', 'held_would_contradict_total', 'refused_private_text', 'held_same_file_sibling')),
  source_key text REFERENCES public.receipt_line_sources(source_key),
  sibling_receipt_id uuid REFERENCES public.receipts(id) ON DELETE SET NULL,
  lines integer NOT NULL DEFAULT 0 CHECK (lines >= 0),
  input_md5 text NOT NULL CHECK (input_md5 ~ '^[a-f0-9]{32}$'),
  run_id text NOT NULL CHECK (length(run_id) BETWEEN 1 AND 120),
  decided_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.receipt_itemisation_outcomes IS 'What receipt_itemise_retained() decided for a receipt''s current stored reading (grain: one receipt; input_md5 = md5 of raw_extraction || raw_json, so a re-read reopens it). Outcomes other than itemised are the re-read work list. Service only; counts are safe to publish, rows are not.';
ALTER TABLE public.receipt_itemisation_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_line_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_itemisation_outcomes, public.receipt_line_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.receipt_itemisation_outcomes, public.receipt_line_sources TO service_role;

-- First non-empty value among a line element's keys.
CREATE OR REPLACE FUNCTION public.receipt_line_pick(p_e jsonb, p_keys text[])
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT v FROM unnest(p_keys) WITH ORDINALITY AS k(key, o)
    CROSS JOIN LATERAL (SELECT nullif(btrim(p_e->>k.key), '') AS v) x
   WHERE jsonb_typeof(p_e) = 'object' AND x.v IS NOT NULL ORDER BY k.o LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.receipt_line_number_value(p_t text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN btrim(p_t) ~ '^-?[0-9]{1,9}(\.[0-9]{1,4})?$' THEN btrim(p_t)::numeric END
$$;

-- Another live linked reading of the same original file (same custodian and file name without its upload-time prefix,
-- or the same stored object) that already carries lines. Measured 2026-11-24: 37 such file groups hold 94 live linked
-- receipts (the same paper uploaded or read more than once, amounts differing so receipts_flag_duplicate missed them).
-- Itemising every reading would count the same lines twice; the fold itemises one and holds the rest on this edge.
CREATE OR REPLACE FUNCTION public.receipt_itemise_sibling(p_receipt uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT o.id
    FROM receipts r
    JOIN receipts o ON o.id <> r.id AND o.user_id IS NOT DISTINCT FROM r.user_id
     AND o.is_superseded IS NOT TRUE AND o.duplicate_of IS NULL
     AND ((regexp_replace(coalesce(r.file_name, ''), '^[0-9]{10,}_', '') <> ''
           AND regexp_replace(coalesce(o.file_name, ''), '^[0-9]{10,}_', '') = regexp_replace(r.file_name, '^[0-9]{10,}_', ''))
          OR (coalesce(r.file_url, '') <> '' AND o.file_url = r.file_url))
   WHERE r.id = p_receipt
     AND EXISTS (SELECT 1 FROM receipt_vehicle_links l WHERE l.receipt_id = o.id AND l.status = 'linked' AND l.retired_at IS NULL)
     AND EXISTS (SELECT 1 FROM receipt_items i WHERE i.receipt_id = o.id)
   ORDER BY o.created_at, o.id
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.receipt_itemise_retained(p_limit integer DEFAULT 50, p_run text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_run text := coalesce(nullif(p_run, ''), 'receipt-itemise-retained:' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS'));
  r record; s record;
  v_md5 text; v_arr jsonb; v_n int; v_sum numeric; v_amt numeric; v_tax numeric;
  v_outcome text; v_source text; v_lines int; v_unreconciled boolean; v_sibling uuid;
  v_counts jsonb := '{}'::jsonb;
BEGIN
  FOR r IN
    SELECT rc.id, rc.raw_extraction, rc.raw_json, coalesce(rc.total_amount, rc.total) AS amt,
           coalesce(rc.tax_amount, rc.tax, 0) AS tax, rc.subtotal
      FROM receipts rc
     WHERE rc.is_superseded IS NOT TRUE AND rc.duplicate_of IS NULL
       AND (rc.raw_extraction IS NOT NULL OR rc.raw_json IS NOT NULL)
       AND EXISTS (SELECT 1 FROM receipt_vehicle_links l WHERE l.receipt_id = rc.id AND l.status = 'linked' AND l.retired_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM receipt_items i WHERE i.receipt_id = rc.id)
       AND NOT EXISTS (SELECT 1 FROM receipt_itemisation_outcomes o WHERE o.receipt_id = rc.id
                        AND o.input_md5 = md5(coalesce(rc.raw_extraction::text, '') || '|' || coalesce(rc.raw_json::text, ''))
                        -- a sibling hold reopens when its sibling stops carrying lines or stops being live
                        AND (o.outcome <> 'held_same_file_sibling' OR receipt_itemise_sibling(rc.id) IS NOT NULL))
     ORDER BY rc.created_at, rc.id
     LIMIT greatest(1, least(coalesce(p_limit, 50), 500))
     FOR UPDATE OF rc SKIP LOCKED
  LOOP
    v_md5 := md5(coalesce(r.raw_extraction::text, '') || '|' || coalesce(r.raw_json::text, ''));
    v_outcome := 'no_lines_held'; v_source := NULL; v_lines := 0; v_unreconciled := false; v_sibling := NULL;
    v_amt := r.amt; v_tax := r.tax;

    FOR s IN SELECT * FROM receipt_line_sources WHERE active ORDER BY priority LOOP
      v_arr := CASE s.json_root WHEN 'raw_extraction' THEN r.raw_extraction #> s.json_path ELSE r.raw_json #> s.json_path END;
      CONTINUE WHEN jsonb_typeof(v_arr) IS DISTINCT FROM 'array';
      SELECT count(*), sum(receipt_line_number_value(receipt_line_pick(e, s.total_keys)))
        INTO v_n, v_sum
        FROM jsonb_array_elements(v_arr) e WHERE receipt_line_pick(e, s.description_keys) IS NOT NULL;
      CONTINUE WHEN v_n = 0;

      IF s.requires_reconcile AND NOT (v_sum IS NOT NULL AND v_amt IS NOT NULL AND (
           abs(v_sum + v_tax - v_amt) <= greatest(0.05, abs(v_amt) * 0.01)
           OR (r.subtotal IS NOT NULL AND abs(v_sum - r.subtotal) <= greatest(0.05, abs(r.subtotal) * 0.01)))) THEN
        v_unreconciled := true;
        CONTINUE;
      END IF;

      v_source := s.source_key; v_lines := v_n;
      v_sibling := receipt_itemise_sibling(r.id);
      IF v_sibling IS NOT NULL THEN
        v_outcome := 'held_same_file_sibling'; v_lines := 0;
      ELSIF EXISTS (SELECT 1 FROM jsonb_array_elements(v_arr) e
                  WHERE regexp_replace(concat_ws(' ', receipt_line_pick(e, s.description_keys), receipt_line_pick(e, s.part_number_keys)),
                                       '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '', 'g')
                        ~ '[0-9]{13,19}|[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}[ -][0-9]{4}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}') THEN
        v_outcome := 'refused_private_text'; v_lines := 0;
      ELSIF v_amt IS NOT NULL AND v_amt <> 0 AND coalesce(v_sum, 0) > 0 AND abs(v_amt) > 3 * (v_sum + v_tax) + 50 THEN
        v_outcome := 'held_would_contradict_total'; v_lines := 0;
      ELSE
        INSERT INTO receipt_items (receipt_id, line_number, description, part_number, category, quantity, unit_price, total_price, line_source)
        SELECT r.id, row_number() OVER (ORDER BY o),
               left(receipt_line_pick(e, s.description_keys), 500),
               left(receipt_line_pick(e, s.part_number_keys), 100),
               left(receipt_line_pick(e, s.category_keys), 60),
               receipt_line_number_value(receipt_line_pick(e, s.quantity_keys)),
               receipt_line_number_value(receipt_line_pick(e, s.unit_price_keys)),
               receipt_line_number_value(receipt_line_pick(e, s.total_keys)),
               s.source_key
          FROM jsonb_array_elements(v_arr) WITH ORDINALITY AS x(e, o)
         WHERE receipt_line_pick(e, s.description_keys) IS NOT NULL;
        v_outcome := 'itemised';
      END IF;
      EXIT;
    END LOOP;

    IF v_outcome = 'no_lines_held' AND v_unreconciled THEN v_outcome := 'held_unreconciled'; END IF;
    INSERT INTO receipt_itemisation_outcomes (receipt_id, outcome, source_key, sibling_receipt_id, lines, input_md5, run_id, decided_at)
    VALUES (r.id, v_outcome, v_source, v_sibling, v_lines, v_md5, v_run, now())
    ON CONFLICT (receipt_id) DO UPDATE SET outcome = EXCLUDED.outcome, source_key = EXCLUDED.source_key, sibling_receipt_id = EXCLUDED.sibling_receipt_id, lines = EXCLUDED.lines,
      input_md5 = EXCLUDED.input_md5, run_id = EXCLUDED.run_id, decided_at = EXCLUDED.decided_at;
    v_counts := jsonb_set(v_counts, ARRAY[v_outcome], to_jsonb(coalesce((v_counts->>v_outcome)::int, 0) + 1));
    IF v_outcome = 'itemised' THEN
      v_counts := jsonb_set(v_counts, '{lines}', to_jsonb(coalesce((v_counts->>'lines')::int, 0) + v_lines));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('run_id', v_run, 'counts', v_counts);
END $$;
COMMENT ON FUNCTION public.receipt_itemise_retained(integer, text) IS 'Fold: itemises a linked receipt''s lines from its own stored reading (receipt_line_sources, by priority) into receipt_items, and records the decision in receipt_itemisation_outcomes. Service role and cron only. Scheduled hourly (cron receipt-itemise-retained).';
REVOKE ALL ON FUNCTION public.receipt_itemise_retained(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_itemise_retained(integer, text) TO service_role;
REVOKE ALL ON FUNCTION public.receipt_line_pick(jsonb, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.receipt_line_number_value(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.receipt_itemise_sibling(uuid) FROM PUBLIC, anon, authenticated;

-- Backfill now, and prove it: the live linked receipt count must not fall.
DO $$
DECLARE before_n int; after_n int; res jsonb;
BEGIN
  SELECT count(DISTINCT l.receipt_id) INTO before_n FROM public.receipt_vehicle_links l WHERE l.status = 'linked' AND l.retired_at IS NULL;
  res := public.receipt_itemise_retained(500, 'receipt-itemise-retained:migration-20261124203000');
  SELECT count(DISTINCT l.receipt_id) INTO after_n FROM public.receipt_vehicle_links l WHERE l.status = 'linked' AND l.retired_at IS NULL;
  IF after_n < before_n THEN
    RAISE EXCEPTION 'receipt_itemise_retained: linked receipts fell from % to % (%)', before_n, after_n, res;
  END IF;
  RAISE NOTICE 'receipt_itemise_retained backfill: % (linked receipts % -> %)', res, before_n, after_n;
END $$;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'receipt-itemise-retained';
    PERFORM cron.schedule('receipt-itemise-retained', '17 * * * *',
      $c$SET statement_timeout = '55s'; SET lock_timeout = '5s'; SELECT public.receipt_itemise_retained(50, NULL)$c$);
  END IF;
END $$;

COMMIT;
