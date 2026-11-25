-- Re-reading a held receipt's own paper: a work list the subscription document reader takes, and the writer that stores
-- the new reading beside the old one so the itemise fold (receipt_itemise_retained, cron :17) reopens the receipt.
--
-- Measured 2026-11-25 (scripts/data/q.sh): 38 live linked receipts carry fold outcome no_lines_held (23: the reader
-- returned no lines) or held_unreconciled (15: regex OCR lines that do not add up to the paper's own total). No job
-- re-reads a receipt's file: subscription-document-reader reads photo frames only. Their bytes: 3 in storage, 33 only
-- on the owner's Mac (the original image named by raw_extraction.source_file or by an absolute file_url), 2 obs://
-- (derived from an observation, no file). A frame with the same IMG name is not used: a name is not the same bytes,
-- and the frame route would land a second receipt.
--
--   receipt_line_sources 'raw_extraction.reread.line_items' (priority 25): the fold reads the re-read's lines.
--   receipt_reread_worklist (view, service only): receipt, owner, source_kind storage|local, source, reason. A receipt
--     leaves it once raw_extraction.reread holds a reading of the current prompt version, or once the fold itemises it.
--   receipt_record_reread(receipt, extraction, reader, source) (service only): refuses card numbers and e-mail
--     addresses and caps size; ADDS raw_extraction.reread = {extraction, reader, prompt_version, source, read_at}; a
--     previous reread moves to raw_extraction.reread_history. No other key of the stored reading changes. The existing
--     triggers recompute amount_check and document_kind; the fold's input md5 changes, so it decides again at :17.
-- Contract: supabase/sql/test_receipt_reread_worklist.sql (PG17). Revert: supabase/sql/revert_20261124207000_receipt_reread_worklist.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

INSERT INTO public.receipt_line_sources (source_key, json_root, json_path, priority, requires_reconcile, description_keys,
  part_number_keys, quantity_keys, unit_price_keys, total_keys, category_keys, note)
VALUES ('raw_extraction.reread.line_items', 'raw_extraction', '{reread,extraction,line_items}', 25, false, '{description}',
  '{part_number}', '{quantity}', '{unit_price}', '{amount,total_price}', '{}',
  'Re-read of the receipt''s own paper by subscription-document-reader (claude -p on the owner''s subscription), stored by receipt_record_reread. 2026-11-25: work list 36 receipts.')
ON CONFLICT (source_key) DO NOTHING;

CREATE OR REPLACE VIEW public.receipt_reread_worklist WITH (security_invoker = true) AS
WITH live AS (
  SELECT r.*, o.outcome
    FROM public.receipts r
    JOIN public.receipt_itemisation_outcomes o ON o.receipt_id = r.id
   WHERE o.outcome IN ('no_lines_held', 'held_unreconciled')
     AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.receipt_items i WHERE i.receipt_id = r.id)
     AND EXISTS (SELECT 1 FROM public.receipt_vehicle_links l WHERE l.receipt_id = r.id AND l.status = 'linked' AND l.retired_at IS NULL)
     AND coalesce(r.raw_extraction #>> '{reread,prompt_version}', '') <> 'document-read-v1')
SELECT live.id AS receipt_id, coalesce(live.user_id, live.created_by) AS user_id, live.outcome AS reason,
       CASE WHEN live.file_url ~ '/storage/v1/object/' THEN 'storage'
            WHEN coalesce(live.raw_extraction->>'source_file', '') ~ '^/' OR live.file_url ~ '^/' THEN 'local' END AS source_kind,
       CASE WHEN live.file_url ~ '/storage/v1/object/' THEN live.file_url
            WHEN coalesce(live.raw_extraction->>'source_file', '') ~ '^/' THEN live.raw_extraction->>'source_file'
            WHEN live.file_url ~ '^/' THEN live.file_url END AS source,
       live.file_name
  FROM live
 WHERE live.file_url ~ '/storage/v1/object/' OR coalesce(live.raw_extraction->>'source_file', '') ~ '^/' OR live.file_url ~ '^/';
REVOKE ALL ON public.receipt_reread_worklist FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.receipt_reread_worklist TO service_role;
COMMENT ON VIEW public.receipt_reread_worklist IS 'Live linked receipts the itemise fold held with no usable lines (no_lines_held, held_unreconciled) whose own paper can be re-read: source_kind storage (URL) or local (absolute path on the owner''s Mac). Taken by subscription-document-reader; a row leaves once receipt_record_reread stores a document-read-v1 reading or the fold itemises it. Service only.';

CREATE OR REPLACE FUNCTION public.receipt_record_reread(p_receipt uuid, p_extraction jsonb, p_reader text, p_source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_prev jsonb; v_txt text;
BEGIN
  IF p_extraction IS NULL OR jsonb_typeof(p_extraction) <> 'object' THEN RAISE EXCEPTION 'reread: extraction must be an object'; END IF;
  IF octet_length(p_extraction::text) > 200000 THEN RAISE EXCEPTION 'reread: extraction too large'; END IF;
  IF p_extraction ? 'line_items' AND jsonb_typeof(p_extraction->'line_items') <> 'array' THEN RAISE EXCEPTION 'reread: line_items must be an array'; END IF;
  IF nullif(btrim(coalesce(p_reader, '')), '') IS NULL THEN RAISE EXCEPTION 'reread: reader required'; END IF;
  v_txt := p_extraction::text;
  IF v_txt ~ '\m[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{3,4}\M' OR v_txt ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' THEN
    RETURN jsonb_build_object('stored', false, 'reason', 'refused_private_text');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.receipt_reread_worklist w WHERE w.receipt_id = p_receipt) THEN
    RETURN jsonb_build_object('stored', false, 'reason', 'not_on_worklist');
  END IF;
  SELECT r.raw_extraction->'reread' INTO v_prev FROM public.receipts r WHERE r.id = p_receipt FOR UPDATE;
  UPDATE public.receipts r
     SET raw_extraction = coalesce(r.raw_extraction, '{}'::jsonb)
           || jsonb_build_object('reread', jsonb_build_object('extraction', p_extraction, 'reader', p_reader,
                'prompt_version', 'document-read-v1', 'source', p_source, 'read_at', now()))
           || CASE WHEN v_prev IS NULL THEN '{}'::jsonb
                   ELSE jsonb_build_object('reread_history', coalesce(r.raw_extraction->'reread_history', '[]'::jsonb) || jsonb_build_array(v_prev)) END
   WHERE r.id = p_receipt;
  RETURN jsonb_build_object('stored', true, 'lines', coalesce(jsonb_array_length(p_extraction->'line_items'), 0));
END $$;
REVOKE ALL ON FUNCTION public.receipt_record_reread(uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_record_reread(uuid, jsonb, text, text) TO service_role;

DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.receipt_reread_worklist;
  RAISE NOTICE 'receipt_reread_worklist: % receipts', n;
END $$;

COMMIT;
