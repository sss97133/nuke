-- Plan-B supply in matching: organizations paid for this kind of work before, on open requirements and facility pages.
--
-- Anchored, exactly-once additions to the live readers (the rest of each definition is unchanged and re-created from the
-- live text, so concurrent additive changes by other lanes survive):
--   open_requirements_read: each row gains plan_b_suppliers = requirement_plan_b_suppliers(description + requested
--     material/process labels of its own operation) for tool, equipment, facility and skill requirements ([] for inspection
--     and approval): organizations whose recorded supply kinds match, labelled 'paid for this before on Nuke (n times)'.
--     They are listed beside candidates, never as candidates or offers.
--   facility_read: gains work_recorded_on_nuke = organization_supply_summary(org) (kinds, record counts, first/last dates).
-- Requires 20261020050000_organization_supply_from_receipts.sql. No amounts, payers or record ids.
-- Contract: supabase/sql/test_open_requirements_plan_b_suppliers.sql (PG17, on the job-loop replay).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $edit$
DECLARE
  def text;
  anchor text;
  n integer;
BEGIN
  IF to_regprocedure('public.requirement_plan_b_suppliers(text,integer)') IS NULL
      OR to_regprocedure('public.organization_supply_summary(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Requires 20261020050000_organization_supply_from_receipts.sql';
  END IF;

  def := pg_get_functiondef('public.open_requirements_read(uuid,integer,text)'::regprocedure);
  anchor := $a$'candidates_listed', jsonb_array_length(COALESCE(b.cands, '[]'::jsonb)),$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 OR position('''plan_b_suppliers''' IN def) > 0 THEN
    RAISE EXCEPTION 'open_requirements_read: anchor found % times (or already edited)', n;
  END IF;
  def := replace(def, anchor, $r$'plan_b_suppliers', CASE WHEN b.q->>'requirement_kind' IN ('tool', 'equipment', 'facility', 'skill')
        THEN public.requirement_plan_b_suppliers(concat_ws(' ', b.q->>'description', (SELECT string_agg(concat_ws(' ', sp->>'material_label',
          sp->>'process_label'), ' ') FROM jsonb_array_elements(COALESCE(b.g->'specifications', '[]'::jsonb)) sp
          WHERE sp->>'specification_stage' = 'requested' AND (sp->>'line_item_id' IS NULL OR sp->>'line_item_id' = b.q->>'line_item_id'))), 5)
        ELSE '[]'::jsonb END,
      $r$ || anchor);
  EXECUTE def;

  def := pg_get_functiondef('public.facility_read(uuid)'::regprocedure);
  anchor := $a$'members', members, 'members_unnamed', n_private,$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 OR position('''work_recorded_on_nuke''' IN def) > 0 THEN
    RAISE EXCEPTION 'facility_read: anchor found % times (or already edited)', n;
  END IF;
  def := replace(def, anchor, anchor || $r$
    'work_recorded_on_nuke', public.organization_supply_summary(org.id),$r$);
  EXECUTE def;
END $edit$;

NOTIFY pgrst, 'reload schema';
COMMIT;
