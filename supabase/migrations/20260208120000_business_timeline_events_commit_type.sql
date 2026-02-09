-- Allow business_timeline_events to represent git commits (e.g. Nuke Ltd org timeline mirroring /nuke repo).

DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid = 'public.business_timeline_events'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%event_type%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.business_timeline_events DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE business_timeline_events
  ADD CONSTRAINT business_timeline_events_event_type_check
  CHECK (event_type IN (
    'founded', 'incorporated', 'license_acquired', 'facility_move', 'equipment_purchase',
    'employee_hired', 'employee_terminated', 'partnership', 'acquisition', 'certification',
    'award_received', 'milestone_reached', 'expansion', 'renovation', 'sale_listing',
    'ownership_transfer', 'closure', 'rebranding', 'commit', 'other'
  ));

-- Optional: allow created_by to be NULL for system-synced events (e.g. commits from git).
-- Keeps NOT NULL for now; script will use org owner as created_by.
-- COMMENT ON COLUMN business_timeline_events.created_by IS 'User who created the event; for commit events, use org owner.';
