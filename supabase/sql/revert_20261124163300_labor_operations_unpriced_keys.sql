-- Revert 20261124163300_labor_operations_unpriced_keys: retire any receipt_line_rules row pointing at these codes
-- first (status retired), then remove the rows and restore NOT NULL.
DELETE FROM public.labor_operations WHERE base_hours IS NULL AND code IN ('MECH-BRAKE-BOOSTER-MC','ELEC-BATTERY',
  'ENG-AIR-CLEANER','ENG-IGNITION-WIRES','INT-CONSOLE-RR','INT-SHIFT-BOOT','INT-DOOR-SILL-PLATES','INT-DASH-TRIM',
  'INT-REAR-SEAT-SHELF','INT-DOOR-LOCK-KNOBS','TRIM-SPOILERS','TRIM-TAILLIGHT-BEZELS','TRIM-EMBLEMS-LETTERS','TRIM-DECALS');
ALTER TABLE public.labor_operations DROP CONSTRAINT IF EXISTS labor_operations_unpriced_says_why;
ALTER TABLE public.labor_operations ALTER COLUMN base_hours SET NOT NULL;
