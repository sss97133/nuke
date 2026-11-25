-- Labor book keys with no book hours, so fitted pieces can be keyed without inventing a number.
--
-- Why: on the proof car 24 of 31 parts witnessed fitted (receipt_part_visible, installed = yes) match no
-- labor_operations code, because the book (64 rows, truck-shaped) has no operation for a spoiler, a decal, a console,
-- a sill plate. Keying them needs an operation row; giving it hours would be a number nobody observed. So
-- base_hours may now be NULL, and a NULL-hours row must say why in notes (constraint). Hours arrive later from an
-- observed baseline (ta-labor L8), never by default.
--
-- Readers of base_hours and what NULL does to each (checked live 2026-11-24):
--   vehicle_labor_appraisal              base_h IS NULL -> pieces_unmatched with operation_code, hours NULL (existing branch)
--   vehicle_build_reconstruction         sums skip NULL; the operation lists with hours NULL
--   estimate_labor_from_description      filters model_year_min <= year: these rows have NULL years, never returned
--   listing_plan_resolve_target / scripts/discovery/buying-evidence-plan.mjs
--                                        resolve only codes in the reviewed keyword table; none of these is there. The
--                                        script now returns typical null (not 0) for a NULL row.
--   compute_receipt_item_labor_value     joins labor_operations.id, a column that does not exist: unreachable today
-- No receipt line maps to these codes until a receipt_line_rules row is promoted through receipt_line_rule_promote.
-- Revert: supabase/sql/revert_20261124163300_labor_operations_unpriced_keys.sql.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.labor_operations ALTER COLUMN base_hours DROP NOT NULL;
ALTER TABLE public.labor_operations ADD CONSTRAINT labor_operations_unpriced_says_why
  CHECK (base_hours IS NOT NULL OR nullif(btrim(notes), '') IS NOT NULL);
COMMENT ON COLUMN public.labor_operations.base_hours IS
  'Book hours for the operation, or NULL when no observed or cited hours exist yet (notes says why). A NULL is unknown, never zero: readers show the operation as keyed and unpriced.';

INSERT INTO public.labor_operations (code, name, system, base_hours, model_year_min, model_year_max, notes)
SELECT c, n, s, NULL, NULL, NULL,
       'Classification key added 2026-11-24 so fitted pieces key to an operation. No book hours recorded: hours come from an observed baseline, never a default.'
  FROM (VALUES
    ('MECH-BRAKE-BOOSTER-MC', 'Brake booster / master cylinder R&R', 'brakes'),
    ('ELEC-BATTERY', 'Battery R&R', 'electrical'),
    ('ENG-AIR-CLEANER', 'Air cleaner assembly R&R', 'mechanical'),
    ('ENG-IGNITION-WIRES', 'Ignition wires / separators R&R', 'mechanical'),
    ('INT-CONSOLE-RR', 'Console R&R', 'interior'),
    ('INT-SHIFT-BOOT', 'Shift boot R&R', 'interior'),
    ('INT-DOOR-SILL-PLATES', 'Door sill plates R&R (pair)', 'interior'),
    ('INT-DASH-TRIM', 'Dash trim pieces R&R (grab handle, emblem, control lens)', 'interior'),
    ('INT-REAR-SEAT-SHELF', 'Rear seat shelf / package tray R&R', 'interior'),
    ('INT-DOOR-LOCK-KNOBS', 'Door lock knobs R&R (pair)', 'interior'),
    ('TRIM-SPOILERS', 'Spoiler R&R', 'trim'),
    ('TRIM-TAILLIGHT-BEZELS', 'Taillight bezels R&R', 'trim'),
    ('TRIM-EMBLEMS-LETTERS', 'Emblems / letters R&R', 'trim'),
    ('TRIM-DECALS', 'Decals apply', 'trim')
  ) AS v(c, n, s)
ON CONFLICT (code) DO NOTHING;
