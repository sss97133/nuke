-- retire_rows: the sanctioned way to take rows out of a live table, whole, into superseded_rows.
--
-- WHY (2026-09-28): two kinds of wrong auction_comments rows had no writer that could take them off a vehicle:
--   * copies on the wrong car — three pcarmarket listings carried another car's BaT comments (a 1965 356SC held
--     the 76 comments of lot 1999-porsche-boxster-42); that lot is now its own vehicle with its own comments;
--   * duplicates — rows written before bat_comment_id existed are invisible to the reader's dedupe, so a re-read
--     writes the same comment again (the 1934 Lagonda 5ade419b: 99 rows for BaT's 60 comments; the lead measured
--     1,924 such rows on 65 re-read lots, 2026-09-27). The page dedupes on display; the data did not.
-- Each row goes to superseded_rows (row_data, citation, reason, who) and leaves the table in one statement;
-- restore = re-insert row_data. Allowed tables are listed explicitly: auction_comments has no inbound foreign
-- keys and only AFTER INSERT triggers (checked 2026-09-28). Add a table only after checking the same for it.
-- Cited source + reason required; service role only; <= 1000 ids per call.

CREATE OR REPLACE FUNCTION public.retire_rows(
  p_table       text,
  p_ids         uuid[],
  p_source      jsonb,
  p_reason      text,
  p_asserted_by text DEFAULT 'agent'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_requested int := coalesce(array_length(p_ids, 1), 0);
  v_retired   int := 0;
BEGIN
  IF p_table IS NULL OR p_table NOT IN ('auction_comments') THEN
    RAISE EXCEPTION 'retire_rows: table % not allowed (auction_comments)', p_table;
  END IF;
  IF p_source IS NULL OR coalesce(p_source ->> 'ref', '') = '' THEN
    RAISE EXCEPTION 'retire_rows: a cited source (p_source.ref) is required';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'retire_rows: a reason is required';
  END IF;
  IF v_requested > 1000 THEN
    RAISE EXCEPTION 'retire_rows: at most 1000 ids per call (got %)', v_requested;
  END IF;

  EXECUTE format(
    'WITH gone AS (DELETE FROM %I t WHERE t.id = ANY($1) RETURNING t.*)
     INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
     SELECT %L, g.id, to_jsonb(g), $2, $3, $4 FROM gone g', p_table, p_table)
  USING p_ids, p_asserted_by, p_source, p_reason;
  GET DIAGNOSTICS v_retired = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'table', p_table, 'requested', v_requested, 'retired', v_retired,
    'asserted_by', p_asserted_by);
END;
$fn$;

REVOKE ALL ON FUNCTION public.retire_rows(text, uuid[], jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retire_rows(text, uuid[], jsonb, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retire_rows(text, uuid[], jsonb, text, text) TO service_role;

COMMENT ON FUNCTION public.retire_rows(text, uuid[], jsonb, text, text) IS
  'Sanctioned retirement of whole rows from an allowed live table (auction_comments) into superseded_rows: row_data, citation, reason, asserted_by; restore = re-insert row_data. Cited source and reason required; service role only; <= 1000 ids per call.';

-- column comments for the archive (schema atlas)
COMMENT ON COLUMN public.superseded_rows.source_table  IS 'Live table the row was retired from.';
COMMENT ON COLUMN public.superseded_rows.row_id        IS 'The row''s primary key in source_table.';
COMMENT ON COLUMN public.superseded_rows.row_data      IS 'The whole row as it was (to_jsonb); restore re-inserts it.';
COMMENT ON COLUMN public.superseded_rows.superseded_at IS 'When the sanctioned writer retired it.';
COMMENT ON COLUMN public.superseded_rows.asserted_by   IS 'Who asserted the retirement (session / writer tag).';
COMMENT ON COLUMN public.superseded_rows.source        IS 'The citation: {type, ref, ...} of the document that shows the row was wrong.';
COMMENT ON COLUMN public.superseded_rows.reason        IS 'Why it was retired, in words.';
COMMENT ON COLUMN public.superseded_rows.restored_at   IS 'Set when row_data is put back into source_table.';
