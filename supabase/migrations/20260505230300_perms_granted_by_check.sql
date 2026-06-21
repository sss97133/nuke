-- vehicle_user_permissions: enforce granted_by IS NOT NULL on all new writes.
--
-- The 2026-03-09 backfill that mass-attributed Skylar as OWNER on 19
-- vehicles he uploaded for research was identifiable precisely because
-- the rows had granted_by IS NULL. If granted_by had been required —
-- even to a system user — the script would have had to declare its
-- author. Auditing scripts after the fact is a poor substitute for
-- forcing them to identify themselves.
--
-- Approach: CHECK constraint with NOT VALID. New INSERTs and UPDATEs
-- where granted_by IS NULL will be rejected. Existing rows with NULL
-- granted_by are exempt until VALIDATE CONSTRAINT is called — the
-- backfill-then-validate sequence is intentionally deferred so cleanup
-- of legacy data can happen on its own pace without blocking this
-- structural guarantee.
--
-- Per .claude/rules/platform-hygiene.md: justification in migration
-- comment. Per agent-trust-invariants: no destructive change to
-- existing data; only a forward-looking guarantee.

ALTER TABLE public.vehicle_user_permissions
  ADD CONSTRAINT chk_granted_by_not_null
  CHECK (granted_by IS NOT NULL)
  NOT VALID;

COMMENT ON CONSTRAINT chk_granted_by_not_null ON public.vehicle_user_permissions IS
  'Forward-looking: new INSERTs/UPDATEs must declare granted_by. Run VALIDATE CONSTRAINT after backfilling legacy NULL rows.';
