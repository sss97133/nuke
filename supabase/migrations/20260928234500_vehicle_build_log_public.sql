-- vehicle_build_log_public(): the build log a visitor may see, with the money and people masked.
-- Second half of option A (Skylar, 2026-09-28: "fix it correctly; that data is foundational to
-- financial models"). 20260928233000 made work records owner-only for non-owners; this returns the
-- work itself (what was done, when, by which supplier, how many labor minutes) for a public vehicle.
-- The records are not changed: owners and service_role (financial models) still read every field.
--
-- Rules:
--  - Only work_record rows that are not superseded.
--  - Receipts stay owner-only (rows with receipt_id, invoice_number or file_url): their text is read off
--    paper and carries personal spending (the K5's receipts include a lunch receipt and a furniture
--    store) and vendor addresses.
--  - Billing headers (subject 'client_invoice') stay owner-only.
--  - Fields come from an allow-list (item/task/title/work_performed, category, supplier, labor_minutes,
--    build_stage/phase, date). Any field not on the list is never returned, including new ones.
--  - Every returned text passes public_text(): dropped if it carries an amount, invoice, billed, paid,
--    payment, card, client, customer, an email or a phone number.
--  - Visibility: the vehicle is public, or the caller is its user, owner or uploader. SECURITY DEFINER,
--    so the filter is written here, not left to row security.
--
-- SCHEMA_LAW pre-mint checklist:
--  1. Search 2026-09-28: no public or masked build-log reader exists; the vehicle page read
--     vehicle_observations directly. Nearest: observation_is_public() (the marking this complements).
--  2. Not a fact class: a masked read model.  3. Writes no testimony.  4. Functions only.
--  5. Read-only.  6. No writers.  7. CI-applied; EXECUTE granted to anon and authenticated explicitly.

SET statement_timeout = '60s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.public_text(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p IS NULL OR btrim(p) = '' THEN NULL
    WHEN p ~* '(\$\s?[0-9]|invoice|billed|\mpaid\M|payment|\mcard\M|client|customer|@|\m\d{3}[-.\s]\d{3}[-.\s]\d{4}\M)' THEN NULL
    ELSE left(btrim(p), 300)
  END;
$$;

COMMENT ON FUNCTION public.public_text(text) IS
  'Returns the text only when it is safe to show anyone: no amount, invoice, billed, paid, payment, card, client, customer, email or phone number; else NULL. Trimmed to 300 characters. 2026-09-28.';

CREATE OR REPLACE FUNCTION public.vehicle_build_log_public(p_vehicle_id uuid)
RETURNS TABLE (
  observation_id uuid,
  done_on        date,
  item           text,
  category       text,
  supplier       text,
  labor_minutes  numeric,
  build_stage    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.id,
         COALESCE(CASE WHEN o.structured_data->>'transaction_date' ~ '^\d{4}-\d{2}-\d{2}'
                       THEN left(o.structured_data->>'transaction_date', 10)::date END,
                  o.observed_at::date),
         public.public_text(COALESCE(o.structured_data->>'item', o.structured_data->>'task',
                                     o.structured_data->>'title', o.structured_data->>'work_performed')),
         public.public_text(o.structured_data->>'category'),
         public.public_text(o.structured_data->>'supplier'),
         CASE WHEN o.structured_data->>'labor_minutes' ~ '^\d+(\.\d+)?$'
              THEN (o.structured_data->>'labor_minutes')::numeric END,
         public.public_text(COALESCE(o.structured_data->>'build_stage', o.structured_data->>'phase'))
  FROM public.vehicle_observations o
  JOIN public.vehicles v ON v.id = o.vehicle_id
  WHERE o.vehicle_id = p_vehicle_id
    AND o.kind = 'work_record'
    AND o.is_superseded IS NOT TRUE
    AND jsonb_typeof(o.structured_data) = 'object'
    AND NOT (o.structured_data ?| ARRAY['receipt_id', 'invoice_number', 'file_url'])
    AND COALESCE(o.structured_data->>'subject', '') <> 'client_invoice'
    AND COALESCE(o.structured_data->>'item', o.structured_data->>'task', o.structured_data->>'title',
                 o.structured_data->>'work_performed', o.structured_data->>'category') IS NOT NULL
    AND v.deleted_at IS NULL
    AND (v.is_public = true
         OR v.user_id = (SELECT auth.uid())
         OR v.owner_id = (SELECT auth.uid())
         OR v.uploaded_by = (SELECT auth.uid()))
  ORDER BY 2 DESC NULLS LAST, 1;
$$;

COMMENT ON FUNCTION public.vehicle_build_log_public(uuid) IS
  'The build log a visitor may see: work records of a public vehicle with money and people masked (allow-listed fields, public_text() on every text; receipts and billing headers excluded). Owners and service_role read vehicle_observations for everything. 2026-09-28.';

REVOKE ALL ON FUNCTION public.public_text(text), public.vehicle_build_log_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_text(text), public.vehicle_build_log_public(uuid)
  TO anon, authenticated, service_role;
