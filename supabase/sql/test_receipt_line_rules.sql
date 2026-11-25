-- Disposable PG17: receipt line classification as rows (migration 20261124163000_receipt_line_rules).
-- Covers: the legacy CASE bodies, loaded verbatim from migration 20261119200000, and the rule reader return the same
-- system and labor operation for a fixture set that hits every seeded rule plus the order collisions; the migration's
-- own proof block runs over the fixture lines; scoped and proposed rules never reach the text-only wrappers; a pattern
-- that does not compile is refused; anon reads active rules only and cannot write; both wrappers are STABLE.
-- Run from the repo root in an empty database named dm_refinement_<name>. Synthetic fixtures only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.receipt_items') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION public.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;

CREATE TABLE public.labor_operations (
  code text PRIMARY KEY, name text, base_hours numeric NOT NULL, system text,
  model_year_min int, model_year_max int, notes text
);
INSERT INTO public.labor_operations (code, base_hours)
SELECT c, 1 FROM unnest(ARRAY['ELEC-WIRING-HARNESS','ELEC-GAUGES','ELEC-HEADLIGHTS','ELEC-TAILLIGHTS','INT-CARPET-RR',
  'INT-HEADLINER-RR','INT-DOOR-PANELS','INT-SEATS-RR','GLASS-DOOR','MECH-RADIATOR-RR','MECH-BRAKES-FRONT',
  'MECH-SUSPENSION-FRONT','MECH-TRANS-RR','TRIM-BUMPERS-REAR','TRIM-BUMPERS-FRONT','TRIM-GRILLE','TRIM-MIRRORS',
  'BODY-REPLACE-HOOD','BODY-REPLACE-FENDER','BODY-RUST-PANEL']) c;

CREATE TABLE public.receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid, description text, part_number text,
  total_price numeric, hours numeric, line_date date, performer text
);
CREATE TABLE public.receipts (
  id uuid PRIMARY KEY, vendor_name text, document_kind text, is_superseded boolean, duplicate_of uuid
);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, make text, year int);
CREATE TABLE public.receipt_vehicle_links (
  receipt_id uuid, vehicle_id uuid, status text, retired_at timestamptz
);
CREATE FUNCTION public.receipt_doc_kind_quoted(k text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(k = 'quote', false) $$;
CREATE FUNCTION public.receipt_doc_kind_excluded(k text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(k = 'personal_purchase', false) $$;
CREATE FUNCTION public.receipt_line_kind(d text, pn text, p numeric, h numeric, ld date, perf text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN d ~* '^labor' THEN 'labor' ELSE 'part' END $$;
CREATE TABLE public.evidence_judgment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), question_kind text, params jsonb
);

-- The legacy classifiers, verbatim from the migration that created them.
\set legacy_system `sed -n '/^CREATE OR REPLACE FUNCTION public.receipt_line_system(p_text text)/,/^\$\$;/p' supabase/migrations/20261119200000_vehicle_build_reconstruction.sql`
\set legacy_operation `sed -n '/^CREATE OR REPLACE FUNCTION public.receipt_line_labor_operation(p_text text)/,/^\$\$;/p' supabase/migrations/20261119200000_vehicle_build_reconstruction.sql`
:legacy_system
:legacy_operation
SELECT public.assert(prosrc ~ 'WHEN t ~', 'legacy body loaded: ' || proname)
  FROM pg_proc WHERE proname IN ('receipt_line_system', 'receipt_line_labor_operation');

-- One text per seeded rule, the order collisions, case and empties.
CREATE TABLE public.fx (t text);
INSERT INTO public.fx (t) VALUES
  ('Dash Harness'), ('gauge cluster'), ('sealed beam 7in'), ('tail lamp lens lh'), ('carpet set'), ('headliner'),
  ('door panel kit'), ('seat foam'), ('door glass rh'), ('radiator'), ('brake rotor'), ('ball joint upper'),
  ('clutch kit'), ('rear bumper'), ('front bumper'), ('grille'), ('outside mirror'), ('hood assembly'), ('fender'),
  ('quarter panel lh'),
  ('shop towels'), ('brake fluid'), ('heater core'), ('valve job'), ('hood decal'), ('wiring'), ('air cleaner'),
  ('rear end'), ('windshield seal'), ('console'), ('battery'), ('water pump'), ('fuel pump'), ('master cyl'),
  ('tie rods'), ('shocks'), ('muffler'), ('pilot bearing'), ('emblem'), ('spark plugs'), ('hex bolts'),
  -- collisions: the first branch wins, in both classifiers
  ('radiator hose'), ('radiator assembly'), ('tail lamp housing'), ('harness decal'), ('rr bdy pnl'),
  ('shaker hood'), ('front end suspension rebuild'), ('HEADLINER BOW'), ('flywheel bolts'), ('brake rotor hardware'),
  -- nothing
  ('something unrelated'), (''), (NULL);
CREATE TABLE public.legacy_out AS
  SELECT t, public.receipt_line_system(t) AS s, public.receipt_line_labor_operation(t) AS o FROM public.fx;
INSERT INTO public.receipt_items (description) SELECT t FROM public.fx;
INSERT INTO public.evidence_judgment_requests (question_kind, params)
VALUES ('receipt_part_visible', '{"question_context": {"description": "clutch disc"}}');

\i supabase/migrations/20261124163000_receipt_line_rules.sql

-- 1. Same output, every fixture, both classifiers.
SELECT public.assert(count(*) = 0, 'rule reader differs from legacy on ' || count(*) || ' fixtures')
  FROM public.legacy_out l
 WHERE l.s IS DISTINCT FROM public.receipt_line_system(l.t)
    OR l.o IS DISTINCT FROM public.receipt_line_labor_operation(l.t);

-- 2. Every seeded rule is the first hit of at least one fixture (the fixtures exercise all 42 rows).
SELECT public.assert(count(*) = 42, 'seeded rules: ' || count(*)) FROM public.receipt_line_rules WHERE status = 'active';
SELECT public.assert(count(*) = 0, 'rules no fixture hits: ' || string_agg(r.rule_id, ', '))
  FROM public.receipt_line_rules r
 WHERE NOT EXISTS (SELECT 1 FROM public.fx, LATERAL public.receipt_line_rule_hit(r.classifier, fx.t) h
                    WHERE h.rule_id = r.rule_id);

-- 3. The migration measured the fixture lines and stored it on each rule.
SELECT public.assert((promotion_measure->>'texts_changed')::int = 0 AND (promotion_measure->>'texts_compared')::int > 50,
                     'promotion_measure: ' || promotion_measure::text)
  FROM public.receipt_line_rules WHERE rule_id = 'op.010.elec-wiring-harness';

-- 4. Order collisions keep the CASE order.
SELECT public.assert(public.receipt_line_system('harness decal') = 'trim', 'decal before harness');
SELECT public.assert(public.receipt_line_labor_operation('harness decal') = 'ELEC-WIRING-HARNESS', 'op harness');
SELECT public.assert(public.receipt_line_labor_operation('radiator hose') IS NULL, 'radiator hose is not a radiator R&R');
SELECT public.assert(public.receipt_line_system('radiator hose') = 'cooling', 'radiator hose cooling');

-- 5. Scope: a vendor-scoped active rule applies only through the scoped call; a proposed rule applies nowhere.
INSERT INTO public.labor_operations (code, base_hours) VALUES ('TRIM-SPOILER-RR', 1);
INSERT INTO public.receipt_line_rules (rule_id, classifier, priority, pattern, operation_code, scope_vendor_pattern,
                                       status, source, proposed_by_agent_key, promoted_at)
VALUES ('op.500.trim-spoiler-test', 'labor_operation', 500, '\yrr splr\y', 'TRIM-SPOILER-RR', 'test vendor', 'active',
        'test fixture', 'test', now());
INSERT INTO public.receipt_line_rules (rule_id, classifier, priority, pattern, operation_code, source, proposed_by_agent_key)
VALUES ('op.510.proposed-test', 'labor_operation', 510, '\yspoiler\y', 'TRIM-SPOILER-RR', 'test fixture', 'test');
SELECT public.assert(public.receipt_line_labor_operation('rr splr') IS NULL, 'scoped rule leaked into the text-only wrapper');
SELECT public.assert((SELECT output_key FROM public.receipt_line_rule_hit('labor_operation', 'rr splr', NULL, 'Test Vendor Inc'))
                     = 'TRIM-SPOILER-RR', 'scoped rule applies with its vendor');
SELECT public.assert((SELECT output_key FROM public.receipt_line_rule_hit('labor_operation', 'rr splr', NULL, 'other'))
                     IS NULL, 'scoped rule applies only to its vendor');
SELECT public.assert(public.receipt_line_labor_operation('rear spoiler') IS NULL, 'proposed rule applied');

-- 6. Year and make scope need the caller to pass them.
UPDATE public.receipt_line_rules SET scope_vendor_pattern = NULL, scope_make = 'Pontiac', scope_year_min = 1970,
       scope_year_max = 1981 WHERE rule_id = 'op.500.trim-spoiler-test';
SELECT public.assert((SELECT output_key FROM public.receipt_line_rule_hit('labor_operation', 'rr splr', NULL, NULL, 'pontiac', 1973))
                     = 'TRIM-SPOILER-RR', 'make+year scope applies');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.receipt_line_rule_hit('labor_operation', 'rr splr', NULL, NULL, 'pontiac', 1985)),
                     'year scope excludes 1985');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.receipt_line_rule_hit('labor_operation', 'rr splr', NULL, NULL, NULL, 1973)),
                     'make scope needs a make');

-- 7. part_number field.
INSERT INTO public.receipt_line_rules (rule_id, classifier, priority, field, pattern, system_key, status, source,
                                       proposed_by_agent_key, promoted_at)
VALUES ('sys.900.pn-test', 'system', 900, 'part_number', '^gm-123', 'body', 'active', 'test fixture', 'test', now());
SELECT public.assert((SELECT output_key FROM public.receipt_line_rule_hit('system', 'unrelated', 'GM-1234')) = 'body',
                     'part_number rule');

-- 8. Refusals: a pattern that does not compile, an output key that is not in the book, two active rules at one priority.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.receipt_line_rules (rule_id, classifier, priority, pattern, system_key, source, proposed_by_agent_key)
    VALUES ('sys.901.bad', 'system', 901, '(unclosed', 'body', 'test', 'test');
    RAISE EXCEPTION 'FAIL: bad regex accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.receipt_line_rules (rule_id, classifier, priority, pattern, operation_code, source, proposed_by_agent_key)
    VALUES ('op.902.bad', 'labor_operation', 902, 'x', 'NOT-A-CODE', 'test', 'test');
    RAISE EXCEPTION 'FAIL: unknown operation accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.receipt_line_rules (rule_id, classifier, priority, pattern, system_key, status, source,
                                           proposed_by_agent_key, promoted_at)
    VALUES ('sys.903.dup', 'system', 10, 'x', 'body', 'active', 'test', 'test', now());
    RAISE EXCEPTION 'FAIL: duplicate active priority accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.receipt_line_rules (rule_id, classifier, priority, pattern, system_key, status, source, proposed_by_agent_key)
    VALUES ('sys.904.unpromoted', 'system', 904, 'x', 'body', 'active', 'test', 'test');
    RAISE EXCEPTION 'FAIL: active rule without promotion accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- 9. Volatility: the wrappers read a table, so they are STABLE, not IMMUTABLE.
SELECT public.assert(provolatile = 's', proname || ' is ' || provolatile::text)
  FROM pg_proc WHERE proname IN ('receipt_line_system', 'receipt_line_labor_operation', 'receipt_line_rule_hit');

-- 10. Logged out: anon classifies through the wrappers, sees active rules only, writes nothing.
SET ROLE anon;
SELECT public.assert(public.receipt_line_system('brake rotor') = 'brakes', 'anon system');
SELECT public.assert(public.receipt_line_labor_operation('clutch kit') = 'MECH-TRANS-RR', 'anon operation');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.receipt_line_rules WHERE status <> 'active'), 'anon sees a proposed rule');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.receipt_line_rules (rule_id, classifier, priority, pattern, system_key, source, proposed_by_agent_key)
    VALUES ('sys.905.anon', 'system', 905, 'x', 'body', 'test', 'test');
    RAISE EXCEPTION 'FAIL: anon wrote a rule';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- gaps: the unmatched fold (migration 20261124163100).
\i supabase/migrations/20261124163100_receipt_line_gaps.sql
DELETE FROM public.receipt_line_rules WHERE status <> 'active' OR rule_id LIKE '%test%';
INSERT INTO public.vehicles VALUES ('00000000-0000-0000-0000-0000000000a1', 'Pontiac', 1973),
                                   ('00000000-0000-0000-0000-0000000000a2', 'Chevrolet', 1977);
INSERT INTO public.receipts VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'Vendor One', 'parts_service', false, NULL),
  ('00000000-0000-0000-0000-0000000000b2', 'Vendor Two', 'unknown', false, NULL),
  ('00000000-0000-0000-0000-0000000000b3', 'Pet Shop', 'personal_purchase', false, NULL),
  ('00000000-0000-0000-0000-0000000000b4', 'Vendor One', 'parts_service', true, NULL),
  ('00000000-0000-0000-0000-0000000000b5', 'Vendor Two', 'parts_service', false, NULL);
INSERT INTO public.receipt_vehicle_links VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'linked', NULL),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 'linked', NULL),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1', 'linked', NULL),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a1', 'linked', NULL),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000a1', 'retired', now());
DELETE FROM public.receipt_items;
INSERT INTO public.receipt_items (id, receipt_id, description) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'clutch kit'),          -- classified
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', 'rear spoiler decal'),  -- trim, no op
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b2', 'wing mount'),          -- no system
  ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000b2', 'spoiler blade'),       -- trim, no op, second car
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000b2', 'hex bolts'),           -- hardware
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000b2', 'labor install'),       -- not a part
  ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-0000000000b3', 'dog food'),            -- excluded kind
  ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000b4', 'spoiler'),             -- superseded
  ('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-0000000000b5', 'spoiler');             -- retired link
SELECT public.assert(count(*) = 5, 'gap population: ' || count(*)) FROM public.receipt_line_gaps;
SELECT public.assert(gap IS NULL AND operation_code = 'MECH-TRANS-RR' AND operation_rule_id = 'op.130.mech-trans-rr',
                     'classified line') FROM public.receipt_line_gaps WHERE item_id = '00000000-0000-0000-0000-0000000000c1';
SELECT public.assert(gap = 'no_operation' AND system_key = 'trim', 'trim gap')
  FROM public.receipt_line_gaps WHERE item_id = '00000000-0000-0000-0000-0000000000c2';
SELECT public.assert(gap = 'no_system', 'no system') FROM public.receipt_line_gaps WHERE item_id = '00000000-0000-0000-0000-0000000000c3';
SELECT public.assert(gap = 'no_operation_expected', 'hardware') FROM public.receipt_line_gaps WHERE item_id = '00000000-0000-0000-0000-0000000000c4';
-- The worklist puts the word two vehicles share first.
SELECT public.assert(term = 'spoiler' AND vehicles = 2 AND lines = 2, 'top term: ' || term)
  FROM (SELECT * FROM public.receipt_line_gap_terms LIMIT 1) t;
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.receipt_line_gap_terms WHERE term IN ('dog', 'food', 'hex', 'bolts')),
                     'excluded or expected lines leaked into the worklist');
-- A scoped rule fills a gap only for its vendor's lines.
INSERT INTO public.labor_operations (code, base_hours) VALUES ('TRIM-SPOILER-RR', 1) ON CONFLICT DO NOTHING;
INSERT INTO public.receipt_line_rules (rule_id, classifier, priority, pattern, operation_code, scope_vendor_pattern,
                                       status, source, proposed_by_agent_key, promoted_at)
VALUES ('op.600.spoiler-vendor-two', 'labor_operation', 600, '\yspoiler\y', 'TRIM-SPOILER-RR', 'vendor two', 'active',
        'test fixture', 'test', now());
SELECT public.assert(gap IS NULL, 'scoped rule fills its vendor line') FROM public.receipt_line_gaps WHERE item_id = '00000000-0000-0000-0000-0000000000c9';
SELECT public.assert(gap = 'no_operation', 'scoped rule leaves the other vendor') FROM public.receipt_line_gaps WHERE item_id = '00000000-0000-0000-0000-0000000000c2';
SET ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM public.receipt_line_gaps;
    RAISE EXCEPTION 'FAIL: anon read receipt_line_gaps';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.receipt_line_gap_counts;
    RAISE EXCEPTION 'FAIL: anon read receipt_line_gap_counts';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- promote: the gate (migration 20261124163200).
\i supabase/migrations/20261124163200_receipt_line_rule_promote.sql
DELETE FROM public.receipt_line_rules WHERE rule_id = 'op.600.spoiler-vendor-two';
INSERT INTO public.labor_operations (code, base_hours) VALUES ('TRIM-WING-RR', 1);
-- A rule that fills only cited lines is promoted.
SELECT public.assert(m->>'decision' = 'promoted' AND (m->>'lines_filled')::int = 2, 'spoiler rule: ' || m::text)
  FROM public.receipt_line_rule_propose('op.700.spoiler', 'labor_operation', 700, '\yspoiler\y', 'TRIM-SPOILER-RR',
         'test: worklist term spoiler', 'test',
         ARRAY['00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c9']::uuid[]) m;
SELECT public.assert(status = 'active' AND promoted_at IS NOT NULL, 'promoted rule active')
  FROM public.receipt_line_rules WHERE rule_id = 'op.700.spoiler';
SELECT public.assert(gap IS NULL, 'gap closed by promotion') FROM public.receipt_line_gaps WHERE item_id = '00000000-0000-0000-0000-0000000000c2';
-- Too broad: fills a line it did not cite.
SELECT public.assert(m->>'decision' = 'rejected' AND m->'reasons' ? 'fills_lines_not_in_evidence', 'broad rule: ' || m::text)
  FROM public.receipt_line_rule_propose('op.710.any', 'labor_operation', 710, '.', 'TRIM-WING-RR', 'test', 'test',
         ARRAY['00000000-0000-0000-0000-0000000000c3']::uuid[]) m;
SELECT public.assert(status = 'rejected', 'broad rule rejected') FROM public.receipt_line_rules WHERE rule_id = 'op.710.any';
-- Steals a keyed line (earlier priority over the clutch rule) without superseding it.
SELECT public.assert(m->>'decision' = 'rejected' AND m->'reasons' ? 'changes_classified_lines', 'stealing rule: ' || m::text)
  FROM public.receipt_line_rule_propose('op.005.clutch-steal', 'labor_operation', 5, '\y(clutch|wing)\y', 'TRIM-WING-RR', 'test', 'test',
         ARRAY['00000000-0000-0000-0000-0000000000c3']::uuid[]) m;
-- Fills nothing / no evidence.
SELECT public.assert(m->'reasons' ? 'fills_no_line' AND m->'reasons' ? 'no_evidence_item_ids', 'empty rule: ' || m::text)
  FROM public.receipt_line_rule_propose('op.720.none', 'labor_operation', 720, 'zzzz', 'TRIM-WING-RR', 'test', 'test', '{}') m;
-- Priority taken.
SELECT public.assert(m->'reasons' ? 'priority_taken', 'priority: ' || m::text)
  FROM public.receipt_line_rule_propose('op.730.wing', 'labor_operation', 700, '\ywing\y', 'TRIM-WING-RR', 'test', 'test',
         ARRAY['00000000-0000-0000-0000-0000000000c3']::uuid[]) m;
-- A supersession may change the lines of the rule it replaces, and only those.
SELECT public.assert(m->>'decision' = 'promoted' AND (m->>'lines_changed')::int = 1, 'supersede: ' || m::text)
  FROM public.receipt_line_rule_propose('op.131.clutch-wing', 'labor_operation', 131, '\y(clutch kit|wing)\y', 'TRIM-WING-RR',
         'test', 'test', ARRAY['00000000-0000-0000-0000-0000000000c3']::uuid[],
         p_supersedes_rule_id => 'op.130.mech-trans-rr') m;
SELECT public.assert(status = 'retired', 'superseded rule retired') FROM public.receipt_line_rules WHERE rule_id = 'op.130.mech-trans-rr';
SELECT public.assert(operation_code = 'TRIM-WING-RR', 'superseding rule keys the line')
  FROM public.receipt_line_gaps WHERE item_id = '00000000-0000-0000-0000-0000000000c1';
-- Only the service role calls the gate.
SET ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.receipt_line_rule_promote('op.700.spoiler');
    RAISE EXCEPTION 'FAIL: anon ran the gate';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

\echo 'test_receipt_line_rules: PASS'
