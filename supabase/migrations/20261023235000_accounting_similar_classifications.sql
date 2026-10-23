BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '1s';

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- A comparable form of a bank or ledger description for "similar transactions": the part before the first ' | '
-- (PayPal exports follow the merchant with the transaction type), lower-cased, digits removed (dates, card suffixes,
-- order and reference numbers), a short channel prefix such as "visa - " dropped, separators collapsed.
CREATE OR REPLACE FUNCTION public.accounting_description_key(p_description text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT nullif(btrim(regexp_replace(regexp_replace(regexp_replace(lower(split_part(coalesce(p_description, ''), ' | ', 1)),
    '[0-9]+', ' ', 'g'), '^[a-z ]{1,8} - ', ''), '[\s/*]+', ' ', 'g')), '')
$$;

-- Trigram lookup of accounting records by that key. Partial: only lines that carry an accounting record.
CREATE INDEX IF NOT EXISTS idx_fline_accounting_description_trgm ON public.financial_document_lines
  USING gin (public.accounting_description_key(attributes->'accounting_record'->>'description') public.gin_trgm_ops)
  WHERE attributes ? 'accounting_record';

-- How the book classified the transactions most like a description: the section/category pairs of the most similar
-- classified current records (pg_trgm similarity of the keys, at least 0.3), with how many and how close. Context for a
-- reviewer choosing, never a decision. Measured live 2026-10-23 as the reviewer of the owner book: 0.5-0.7 s.
-- SECURITY INVOKER under the financial_* row policies; writes nothing.
CREATE OR REPLACE FUNCTION public.accounting_similar_classifications(p_owner_id uuid, p_description text, p_exclude_source_key text DEFAULT NULL, p_limit integer DEFAULT 25)
RETURNS TABLE(section text, category text, records integer, similarity real)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH target AS (SELECT public.accounting_description_key(p_description) AS k),
  near AS (
    SELECT l.attributes->'accounting_record'->>'section' AS section, coalesce(l.attributes->'accounting_record'->>'category', '') AS category,
           public.similarity(public.accounting_description_key(l.attributes->'accounting_record'->>'description'), t.k) AS s
    FROM public.financial_document_lines l CROSS JOIN target t
    WHERE l.owner_id = p_owner_id AND l.attributes ? 'accounting_record' AND length(coalesce(t.k, '')) >= 3
      AND public.accounting_description_key(l.attributes->'accounting_record'->>'description') OPERATOR(public.%) t.k
      AND l.attributes->'accounting_record'->>'section' IS NOT NULL
      AND l.attributes->'accounting_record'->>'source_key' IS DISTINCT FROM p_exclude_source_key
      AND EXISTS (SELECT 1 FROM public.financial_document_extractions e
                   WHERE e.owner_id = l.owner_id AND e.document_id = l.document_id
                     AND e.extraction_run_id::text = l.attributes->>'extraction_run_id' AND NOT e.is_superseded)
    ORDER BY s DESC LIMIT least(greatest(coalesce(p_limit, 25), 1), 100)
  )
  SELECT near.section, near.category, count(*)::integer, round(avg(near.s)::numeric, 2)::real
  FROM near GROUP BY near.section, near.category ORDER BY count(*) DESC, avg(near.s) DESC;
$$;

COMMENT ON FUNCTION public.accounting_similar_classifications(uuid, text, text, integer) IS
  'Section/category pairs of the classified current records most similar to a description (pg_trgm on accounting_description_key); context for reviewers, security invoker.';

REVOKE ALL ON FUNCTION public.accounting_similar_classifications(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accounting_similar_classifications(uuid, text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_description_key(text) TO authenticated, service_role;

COMMIT;
