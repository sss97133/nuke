-- 20261007130000_create_organization_batch.sql
--
-- A declared, service-role BATCH organization creator keyed by canonical domain — the batch sibling of
-- create-org-from-url (which requires a signed-in user and 401s a service-role bearer). Memo:
-- ~/nuke-logs/nsf-awards-20261007/ORG_CREATOR_PREMINT_MEMO.md (SCHEMA_LAW pre-mint, numbers live 2026-10-07).
--
-- WHY: no declared service-role org creator exists; three ad-hoc seed scripts (load-perplexity-orgs.ts,
-- stbarth/seed-publishers.mjs, create-forum-orgs.js) batch-insert orgs with no shared canonicalization, receipt,
-- registry row or staged keys — the duplication SCHEMA_LAW §1 exists to stop. resolve_organization_from_url was
-- retired 2026-10-07 (#770) because a scheme-less website matched 232 nsf.gov rows (wrong org). The funding stack
-- S61 needs 2,802 NSF awardee firms + 252 institutions as org rows; 0 exist today.
--
-- SCOPE / OWNER GATE: organizations is 100% automotive today (1,328 domains). This function is BUILT, NOT RUN.
-- Creating non-automotive federal-awardee rows is a scope expansion the owner approves before any batch runs, and
-- rows are created is_public=false so nothing lands on /org/:id until the owner flips them (a separate, gated step).
--
-- GRAMMAR (SPEC §0, no baked taxonomy): the row is the entity key only — business_name (NOT NULL) + canonical
-- website + city/state/zip/country. business_type stays NULL. Facts (award, DUNS/UEI, employee count, institution)
-- are observations: staged in metadata.external_keys with the DNA grammar until a fact class earns a column; the
-- flat metadata.duns mirrors the staged key for the partial unique index (a separate migration, CONCURRENTLY).
--
-- IDEMPOTENCY (COALESCE-fill only; never blind INSERT; merges are a human act, not this function):
--   1. canonical website (https + no-www + origin) via a variant lookup (http/https, www, trailing slash);
--   2. else metadata.duns (for firms with no website);
--   3. name+state is a lookup for enrich only, never a create key.
--   DUNS matching a row with a DIFFERENT domain: do not merge; count a conflict; leave that row untouched.
--   force_new bypasses the lookup (operator only).

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.create_organization_batch(
  p_orgs jsonb,
  p_source_slug text,
  p_force_new boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_writer constant text := 'create-organization-batch';
  v_prev_writer text := current_setting('app.writer', true);
  cand jsonb;
  v_name text;
  v_host text;
  v_canon text;
  v_duns text;
  v_uei text;
  v_org_id uuid;
  v_existing_website text;
  v_created integer := 0;
  v_enriched integer := 0;
  v_conflicts integer := 0;
  v_skipped integer := 0;
  v_ext_entry jsonb;
BEGIN
  IF p_orgs IS NULL OR jsonb_typeof(p_orgs) <> 'array' THEN
    RAISE EXCEPTION 'create_organization_batch: p_orgs must be a jsonb array';
  END IF;
  IF jsonb_array_length(p_orgs) > 5000 THEN
    RAISE EXCEPTION 'create_organization_batch: batch too large (%), cap 5000', jsonb_array_length(p_orgs);
  END IF;
  IF coalesce(btrim(p_source_slug), '') = '' THEN
    RAISE EXCEPTION 'create_organization_batch: p_source_slug required';
  END IF;

  PERFORM set_config('app.writer', c_writer, true);

  FOR cand IN SELECT * FROM jsonb_array_elements(p_orgs)
  LOOP
    v_name := nullif(btrim(cand->>'business_name'), '');
    v_duns := nullif(btrim(cand->>'duns'), '');
    v_uei  := nullif(btrim(cand->>'uei'), '');

    -- Canonicalize the website to https + no-www + origin (host only).
    v_host := lower(coalesce(cand->>'website', ''));
    v_host := regexp_replace(v_host, '^https?://', '', 'i');   -- scheme
    v_host := regexp_replace(v_host, '/.*$', '');              -- path/query
    v_host := regexp_replace(v_host, ':[0-9]+$', '');          -- port
    v_host := regexp_replace(v_host, '^www\.', '');            -- www
    v_host := nullif(btrim(v_host), '');
    v_canon := CASE WHEN v_host IS NULL THEN NULL ELSE 'https://' || v_host END;

    -- A row needs a canonical key: a website or a DUNS. Name-only candidates are skipped (no create).
    IF v_canon IS NULL AND v_duns IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    IF v_name IS NULL THEN
      v_skipped := v_skipped + 1;   -- business_name is NOT NULL; cannot create without it
      CONTINUE;
    END IF;

    v_org_id := NULL;
    v_existing_website := NULL;

    IF NOT p_force_new THEN
      -- 1. website variant lookup
      IF v_canon IS NOT NULL THEN
        SELECT id, website INTO v_org_id, v_existing_website FROM public.organizations
        WHERE website = ANY (ARRAY[
          v_canon, v_canon || '/',
          'http://' || v_host, 'http://' || v_host || '/',
          'https://www.' || v_host, 'https://www.' || v_host || '/',
          'http://www.' || v_host, 'http://www.' || v_host || '/'
        ])
        LIMIT 1;
      END IF;
      -- 2. DUNS lookup (only when no website match)
      IF v_org_id IS NULL AND v_duns IS NOT NULL THEN
        SELECT id, website INTO v_org_id, v_existing_website FROM public.organizations
        WHERE metadata->>'duns' = v_duns
        LIMIT 1;
        -- DUNS matched a row that already has a DIFFERENT canonical domain -> conflict, do not merge.
        IF v_org_id IS NOT NULL AND v_canon IS NOT NULL AND v_existing_website IS NOT NULL
           AND v_existing_website <> v_canon THEN
          v_conflicts := v_conflicts + 1;
          CONTINUE;
        END IF;
      END IF;
    END IF;

    v_ext_entry := jsonb_strip_nulls(jsonb_build_object(
      'duns', v_duns, 'uei', v_uei));

    IF v_org_id IS NOT NULL THEN
      -- ENRICH: COALESCE-fill nulls only; merge metadata; append external_keys; never overwrite a set field.
      UPDATE public.organizations o SET
        business_name = coalesce(o.business_name, v_name),
        website       = coalesce(o.website, v_canon),
        city          = coalesce(o.city, nullif(btrim(cand->>'city'), '')),
        state         = coalesce(o.state, nullif(btrim(cand->>'state'), '')),
        zip_code      = coalesce(o.zip_code, nullif(btrim(cand->>'zip_code'), '')),
        metadata = coalesce(o.metadata, '{}'::jsonb)
          || jsonb_build_object('duns', coalesce(o.metadata->>'duns', v_duns))
          || jsonb_build_object('external_keys',
               coalesce(o.metadata->'external_keys', '[]'::jsonb)
               || CASE WHEN v_duns IS NOT NULL AND NOT (coalesce(o.metadata->'external_keys','[]'::jsonb) @> jsonb_build_array(jsonb_build_object('key','duns','value',v_duns)))
                       THEN jsonb_build_array(jsonb_build_object('key','duns','value',v_duns,'source',p_source_slug,'observed_at',now()))
                       ELSE '[]'::jsonb END)
      WHERE o.id = v_org_id;
      v_enriched := v_enriched + 1;
    ELSE
      -- CREATE: entity key only; is_public=false; business_type NULL; no user stamps; staged keys in metadata.
      INSERT INTO public.organizations (
        business_name, website, city, state, zip_code, country, is_public, business_type,
        discovered_via, metadata)
      VALUES (
        v_name, v_canon,
        nullif(btrim(cand->>'city'), ''), nullif(btrim(cand->>'state'), ''), nullif(btrim(cand->>'zip_code'), ''),
        coalesce(nullif(btrim(cand->>'country'), ''), 'US'),
        false, NULL,
        'declared-source:' || p_source_slug,
        jsonb_strip_nulls(jsonb_build_object(
          'duns', v_duns,
          'org_intake', jsonb_build_object('source', p_source_slug, 'created_at', now()),
          'external_keys', CASE WHEN v_duns IS NOT NULL OR v_uei IS NOT NULL
            THEN jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                   'key', CASE WHEN v_duns IS NOT NULL THEN 'duns' ELSE 'uei' END,
                   'value', coalesce(v_duns, v_uei), 'source', p_source_slug,
                   'method', 'declared-source-reader@v0', 'observed_at', now(), 'trust', 'T2')))
            ELSE NULL END)));
      v_created := v_created + 1;
    END IF;
  END LOOP;

  IF v_created + v_enriched > 0 THEN
    INSERT INTO public.write_receipts (at, tbl, op, rows, writer, db_role, app_name, txid)
    VALUES (now(), 'organizations', 'INSERT', v_created + v_enriched, c_writer, current_user,
            current_setting('application_name', true), txid_current());
  END IF;

  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);

  RETURN jsonb_build_object('created', v_created, 'enriched', v_enriched,
                            'conflicts', v_conflicts, 'skipped_no_key', v_skipped,
                            'input', jsonb_array_length(p_orgs));
END
$fn$;

COMMENT ON FUNCTION public.create_organization_batch(jsonb, text, boolean) IS
'Declared service-role BATCH organization creator keyed by canonical domain (migration 20261007130000; memo ORG_CREATOR_PREMINT_MEMO.md). Batch sibling of create-org-from-url. Per candidate {business_name, website, city, state, zip_code, country, duns, uei}: canonicalizes website to https+no-www+origin, looks up by website variants then metadata.duns, and either COALESCE-fills an existing row (never overwriting a set field; merges metadata; appends external_keys) or inserts the entity key (business_name NOT NULL, is_public=false, business_type NULL, discovered_via=declared-source:<slug>, no user stamps, DUNS/UEI staged in metadata.external_keys with the DNA grammar). A candidate with neither website nor DUNS, or no business_name, is skipped (no create). A DUNS matching a row with a different canonical domain counts a conflict and is left untouched (merges are a human act). force_new bypasses the lookup. One write_receipts row per call; app.writer set in the body and the caller value restored. SECURITY INVOKER; EXECUTE service_role only. Returns {created, enriched, conflicts, skipped_no_key, input}. BUILT NOT RUN pending owner scope approval.';

-- Declared writer of organizations (the table has a writer-hygiene problem; this one is receipted + registered).
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES (
  'organizations', NULL,
  'create-organization-batch',
  'Batch creation/enrichment of organization rows from a declared source (e.g. SBIR/NSF awardees), keyed by canonical domain then metadata.duns. Entity key only (business_name + canonical website); business_type NULL; facts staged in metadata.external_keys. is_public=false at creation. One receipt per batch.',
  false,
  'create_organization_batch(p_orgs jsonb, p_source_slug text, p_force_new boolean) — service_role only; COALESCE-fill, never blind INSERT; force_new the only bypass.')
ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by, description = EXCLUDED.description,
  do_not_write_directly = EXCLUDED.do_not_write_directly, write_via = EXCLUDED.write_via, updated_at = now();

REVOKE ALL ON FUNCTION public.create_organization_batch(jsonb, text, boolean) FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.create_organization_batch(jsonb, text, boolean) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.create_organization_batch(jsonb, text, boolean) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.create_organization_batch(jsonb, text, boolean) TO service_role;
  END IF;
END $grants$;

COMMIT;
