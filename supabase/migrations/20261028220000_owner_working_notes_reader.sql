-- Owner working notes (spreadsheets kept at the time) as context beside the books.
--
-- The notes are admitted through the existing writer ingest_financial_evidence as cells only
-- (working_notes_source, working_notes_table_<i>, working_notes_table_<i>_rows_<k>; written by
-- scripts/books/numbers_working_notes.py). They carry no lines and no accounting records, so no books reader
-- (records, close-out, tax workpapers, vehicle costs) counts them. Trust tier: owner_working_notes_contextual, an
-- attributed claim made at the time, below statements, invoices, receipts and bank lines.
--
-- owner_working_notes reads them back for a vehicle, an organization or related party, and/or a period, as compact
-- keyed rows. It never totals amounts. SECURITY INVOKER: the book's own row policies (owner and accounting
-- delegates) bound every read; anon cannot execute it.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.owner_working_notes(
  p_owner_id uuid,
  p_vehicle_id uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_rows integer DEFAULT 20,
  p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH args AS (
    SELECT least(greatest(coalesce(p_rows, 20), 0), 50) AS nrows,
           least(greatest(coalesce(p_limit, 20), 1), 100) AS nlim,
           coalesce(p_from, '-infinity'::date) AS dfrom,
           coalesce(p_to, 'infinity'::date) AS dto
  ), cells AS MATERIALIZED (
    SELECT e.id, e.document_id, e.field_key, e.value_normalized->'value' AS v
    FROM public.financial_document_extractions e
    WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key LIKE 'working\_notes\_%'
  ), tabs AS (
    SELECT c.id, c.document_id, c.field_key, c.v,
      CASE WHEN c.v->'period'->>'from' ~ '^\d{4}-\d{2}-\d{2}$' THEN (c.v->'period'->>'from')::date END AS pfrom,
      CASE WHEN c.v->'period'->>'to' ~ '^\d{4}-\d{2}-\d{2}$' THEN (c.v->'period'->>'to')::date END AS pto
    FROM cells c WHERE c.field_key ~ '^working_notes_table_[0-9]+$'
  ), matched AS (
    SELECT t.*,
      -- vehicle: named in the table title (all rows), in rows (those rows), or a candidate of an ambiguous mention
      (SELECT CASE WHEN bool_or(k.x->>'vehicle_id' = p_vehicle_id::text AND k.x->>'scope' = 'table') THEN 'table'
                   WHEN bool_or(k.x->>'vehicle_id' = p_vehicle_id::text) THEN 'rows'
                   WHEN bool_or(EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(k.x->'candidates') = 'array'
                                         THEN k.x->'candidates' ELSE '[]' END) c WHERE c->>'vehicle_id' = p_vehicle_id::text)) THEN 'candidate' END
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.v->'keys'->'vehicles') = 'array' THEN t.v->'keys'->'vehicles' ELSE '[]' END)
            WITH ORDINALITY k(x, n)) AS vmatch,
      (SELECT coalesce(array_agg(k.n - 1), '{}')
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.v->'keys'->'vehicles') = 'array' THEN t.v->'keys'->'vehicles' ELSE '[]' END)
            WITH ORDINALITY k(x, n)
       WHERE k.x->>'vehicle_id' = p_vehicle_id::text OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(k.x->'candidates') = 'array'
                                         THEN k.x->'candidates' ELSE '[]' END) c WHERE c->>'vehicle_id' = p_vehicle_id::text)) AS vidx,
      (SELECT coalesce(array_agg(k.n - 1), '{}')
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.v->'keys'->'organizations') = 'array' THEN t.v->'keys'->'organizations' ELSE '[]' END)
            WITH ORDINALITY k(x, n)
       WHERE k.x->>'organization_id' = p_organization_id::text) AS oidx,
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.v->'keys'->'related_parties') = 'array' THEN t.v->'keys'->'related_parties' ELSE '[]' END) r
              WHERE r->>'entity_id' = p_organization_id::text) AS related
    FROM tabs t, args a
    WHERE (t.pfrom IS NULL OR t.pfrom <= a.dto) AND (t.pto IS NULL OR t.pto >= a.dfrom)
  ), kept AS (
    SELECT m.* FROM matched m
    WHERE (p_vehicle_id IS NULL OR m.vmatch IS NOT NULL)
      AND (p_organization_id IS NULL OR m.related OR cardinality(m.oidx) > 0)
  ), ranked AS (
    SELECT k.*, count(*) OVER () AS total,
      row_number() OVER (ORDER BY (k.vmatch = 'candidate') NULLS FIRST, k.pto DESC NULLS LAST, k.document_id, k.field_key) AS rn
    FROM kept k
  ), page AS (
    SELECT r.* FROM ranked r, args a WHERE r.rn <= a.nlim
  ), allrows AS (
    SELECT p.id AS table_cell, x.row
    FROM page p
    CROSS JOIN LATERAL (
      SELECT jsonb_array_elements(CASE WHEN jsonb_typeof(p.v->'rows') = 'array' THEN p.v->'rows' ELSE '[]' END) AS row
      UNION ALL
      SELECT jsonb_array_elements(CASE WHEN jsonb_typeof(c.v->'rows') = 'array' THEN c.v->'rows' ELSE '[]' END)
      FROM cells c
      WHERE c.document_id = p.document_id AND c.field_key LIKE p.field_key || '\_rows\_%'
    ) x
  ), picked AS (
    SELECT p.id AS table_cell, ar.row,
      row_number() OVER (PARTITION BY p.id ORDER BY (ar.row->>'r')::int) AS n,
      count(*) OVER (PARTITION BY p.id) AS matched_rows
    FROM page p JOIN allrows ar ON ar.table_cell = p.id
    WHERE (p_vehicle_id IS NULL OR p.vmatch = 'table'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(ar.row->'v') = 'array' THEN ar.row->'v' ELSE '[]' END) i
                      WHERE i::int = ANY (p.vidx)))
      AND (p_organization_id IS NULL OR p.related
           OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(ar.row->'o') = 'array' THEN ar.row->'o' ELSE '[]' END) i
                      WHERE i::int = ANY (p.oidx)))
      AND (p_from IS NULL AND p_to IS NULL OR ar.row->>'d' IS NULL OR (ar.row->>'d' ~ '^\d{4}-\d{2}-\d{2}$'
           AND (ar.row->>'d')::date BETWEEN (SELECT dfrom FROM args) AND (SELECT dto FROM args)))
  )
  SELECT jsonb_build_object(
    'trust_tier', 'owner_working_notes_contextual',
    'note', 'Owner working notes from the time: context, not books. Amounts are what was written then; never summed.',
    'as_of', now(),
    'filters', jsonb_build_object('vehicle_id', p_vehicle_id, 'organization_id', p_organization_id, 'from', p_from, 'to', p_to),
    'tables_matched', coalesce((SELECT max(total) FROM ranked), 0),
    'tables', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'document_id', p.document_id,
        'cell_id', p.id,
        'field_key', p.field_key,
        'workbook', coalesce(s.v->'artifact'->'workbook'->0->>'name', s.v->'artifact'->>'filename'),
        'location', coalesce(s.v->'artifact'->'workbook'->0->>'location', s.v->'artifact'->>'location'),
        'sheet', p.v->>'sheet',
        'table', p.v->>'table',
        'period', p.v->'period',
        'file_modified_at', s.v->'period'->>'file_modified_at',
        'vehicle_match', p.vmatch,
        'organization_match', CASE WHEN p_organization_id IS NULL THEN NULL WHEN p.related THEN 'related_party' ELSE 'organization' END,
        'header', p.v->'header',
        'rows_total', p.v->'rows_total',
        'rows_matched', coalesce((SELECT max(k.matched_rows) FROM picked k WHERE k.table_cell = p.id), 0),
        'rows', coalesce((SELECT jsonb_agg(k.row ORDER BY k.n) FROM picked k, args a WHERE k.table_cell = p.id AND k.n <= a.nrows), '[]'),
        'keys', jsonb_build_object(
          'vehicles', coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('vehicle_id', x->'vehicle_id', 'label', x->'label',
                         'match', x->'match', 'scope', x->'scope', 'candidates', x->'candidates')))
                       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.v->'keys'->'vehicles') = 'array' THEN p.v->'keys'->'vehicles' ELSE '[]' END) x), '[]'),
          'organizations', coalesce(p.v->'keys'->'organizations', '[]'),
          'related_parties', coalesce(p.v->'keys'->'related_parties', '[]'),
          'deals', coalesce(p.v->'keys'->'deals', '[]'),
          'people', coalesce(p.v->'keys'->'people', '[]'))
      ) ORDER BY p.rn)
      FROM page p LEFT JOIN cells s ON s.document_id = p.document_id AND s.field_key = 'working_notes_source'), '[]'));
$$;

COMMENT ON FUNCTION public.owner_working_notes(uuid, uuid, uuid, date, date, integer, integer) IS
  'Owner working notes (spreadsheets kept at the time) for a vehicle, organization or related party, and/or period: '
  'compact keyed rows from current working_notes_* cells of financial_evidence_v1 documents. Trust tier '
  'owner_working_notes_contextual: context, not books; amounts are never totalled. Bounded: p_limit <= 100 tables, '
  'p_rows <= 50 rows per table. SECURITY INVOKER: owner and accounting delegates only. Writer: '
  'scripts/books/numbers_working_notes.py through ingest_financial_evidence.';

REVOKE ALL ON FUNCTION public.owner_working_notes(uuid, uuid, uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_working_notes(uuid, uuid, uuid, date, date, integer, integer) TO authenticated, service_role;

COMMIT;
