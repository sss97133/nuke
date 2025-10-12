-- Fix RLS policies to avoid per-row re-evaluation of auth.*() and current_setting()
-- This migration scans all policies in the public schema and rewrites expressions by
-- wrapping function calls with SELECT, per Supabase guidance:
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

DO $$
DECLARE
  r RECORD;
  new_qual TEXT;
  new_check TEXT;
  changed BOOLEAN;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    new_qual := r.qual;
    new_check := r.with_check;
    changed := false;

    -- Wrap auth.*() calls with SELECT in USING clause
    IF new_qual IS NOT NULL AND new_qual ~ 'auth\.[a-zA-Z0-9_]+\(\)' THEN
      new_qual := regexp_replace(new_qual, 'auth\.([a-zA-Z0-9_]+)\(\)', '(select auth.\1())', 'g');
      changed := true;
    END IF;

    -- Wrap auth.*() calls with SELECT in WITH CHECK clause
    IF new_check IS NOT NULL AND new_check ~ 'auth\.[a-zA-Z0-9_]+\(\)' THEN
      new_check := regexp_replace(new_check, 'auth\.([a-zA-Z0-9_]+)\(\)', '(select auth.\1())', 'g');
      changed := true;
    END IF;

    -- Note: We intentionally do not rewrite current_setting() calls because
    -- naive regex replacement may produce malformed SQL. The linter warnings
    -- are primarily about auth.*() usage; we target those safely here.

    -- Apply the updated expressions back to the policy if anything changed
    IF changed THEN
      IF new_qual IS NULL AND new_check IS NOT NULL THEN
        EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)', r.policyname, r.schemaname, r.tablename, new_check);
      ELSIF new_check IS NULL AND new_qual IS NOT NULL THEN
        EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', r.policyname, r.schemaname, r.tablename, new_qual);
      ELSE
        EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)', r.policyname, r.schemaname, r.tablename, new_qual, new_check);
      END IF;
    END IF;
  END LOOP;
END$$;
