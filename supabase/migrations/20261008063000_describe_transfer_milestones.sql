-- Describe transfer_milestones: the 12 columns without a comment (1 of 13 had one, required, written by the creating
-- migration 20260226200000_ownership_transfers.sql and kept unchanged; catalog count on prod, 2026-10-07) and a corrected
-- table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table in the atlas: 2,606,482 rows on 2026-10-07 17:41Z by exact count (the
-- atlas estimate of 2,380,800 is a stale pg_class.reltuples); 18 rows arrive with every newly sold auction lot (778
-- transfers in the 24 hours to 17:43Z).
--
-- METHOD (read 2026-10-07 17:40-17:55Z UTC):
--   Columns, types, enum labels, defaults, constraints (with convalidated), indexes, triggers, policies, RLS, grants
--   (has_table_privilege and relacl for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_enum, pg_constraint, pg_indexes, pg_trigger, pg_policy, pg_class and pg_description; foreign keys in
--   (transfer_communications) from pg_constraint; views from pg_depend (none). Exact over the whole table (279 MB heap,
--   read only): the counts by milestone_type, status, created month and updated month; the fills; the clock ranges; the
--   rows past their deadline at insert and now; the steps per transfer; the transfers without steps and the status of the
--   transfers with skipped or completed steps by a join to ownership_transfers; the seeding lag (created_at minus the
--   completed_at of agreement_reached). On a 1% sample (TABLESAMPLE SYSTEM (1) REPEATABLE (20261007)): deadline_at minus the
--   sale date per step code. What anon can read comes from a count under SET LOCAL ROLE anon in a read-only transaction.
--   "Filled" means non-NULL.
--   Writers and readers from code at origin/main e91b83cc0 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; git history for the deleted functions): the creating migration
--   20260226200000_ownership_transfers.sql and 20260226220000_transfer_automation.sql (both in prod migration history);
--   20261006064500_describe_ownership_transfers.sql; 20261007002507_declare_table_owners_1.sql; the web pages
--   nuke_frontend/src/pages/TransferPartyPage.tsx and nuke_frontend/src/pages/admin/TransfersDashboard.tsx; the edge
--   functions transfer-automator, transfer-advance, transfer-status-api and notify-transfer-parties as last committed
--   (9871ee4fb^, removed from main by 9871ee4fb on 2026-03-31) and the deployed source of transfer-automator (version 57,
--   2026-02-27 11:40Z), transfer-advance (version 54, 2026-02-26 16:08Z) and notify-transfer-parties (version 50), read
--   through the management API. Bodies read with pg_get_functiondef: the 2 live functions whose body names the table
--   (transfer_staleness_sweep and auto_complete_transfer_obligation), the trigger functions transfer_milestone_completed
--   and auto_create_transfer_on_auction_close, with their EXECUTE grants and triggers; cron.job (transfer-staleness-sweep,
--   jobid 189, inactive) and cron.job_run_details; write_receipts (no rows); pg_stat_user_tables; pipeline_registry (1 row;
--   none is added or changed here).
-- LIMITS:
--   Who wrote the skip statement of 2026-02-27 00:33Z and the hand-built transfer of 2026-02-26 is not recorded. Why no
--   transfer was seeded from 2026-04-14 to 2026-07-09 and from 2026-07-28 to 2026-09-27, and why 29 transfers have no
--   step, is not recorded. When cron job 189 was made inactive is not recorded (cron.job_run_details keeps its last 8 runs,
--   all failed, the last 2026-04-25 00:00Z). The deployed sources were read, not probed; the deployment of
--   transfer-status-api was not checked. pg_stat_user_tables counters began at the last server start (2026-09-29 09:20Z),
--   and the reads of this session added sequential and index scans to them after 17:40Z. Transfers involve private
--   people: quoted values are step and status codes, column and function names and counts only; no transfer, vehicle or
--   user id, name, contact, lot number, price or note text.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Ordered progress steps for an ownership transfer. Sequence determines display order in the progress
--   bar." Both sentences stay. Added: the grain, the writers and their windows, what each status means on this data (no
--   step besides agreement_reached has been completed by a party; overdue stopped on 2026-03-31), liveness, readers and
--   access, including the deployed edge functions that write it without a caller check.
--   Column required: unchanged.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.transfer_milestones IS
'Ordered progress steps for an ownership transfer. Sequence determines display order in the progress bar. One row per step of one transfer (UNIQUE transfer_id, milestone_type and UNIQUE transfer_id, sequence; grain: one step of one transfer). 2,606,482 rows on 2026-10-07 17:41Z (exact) for 144,804 of the 144,833 ownership_transfers: pending 1,727,866, overdue 706,926, completed 144,789, skipped 26,901; in_progress and blocked never occur. Writers. (1) The edge function transfer-automator (deployed version 57 of 2026-02-27; source removed from main by 9871ee4fb), action seed_from_auction, which the trigger auto_create_transfer_on_auction_close calls through net.http_post when an auction_events row first becomes sold (not when the transaction sets app.seed_transfers off): it inserts the 18 steps of its template for the new transfer (sequence 10 to 180, status pending, deadline_at the sale date plus 1 to 60 days; its 3 shipping steps were never seeded) and then marks agreement_reached completed at the sale date, logging but not checking either write. 144,803 transfers: 32,742 seeded 2026-02-26 to 02-28, 37,222 in 2026-03, 8,343 on 2026-04-01 to 04-14, 23,015 on 2026-07-09 to 07-28, 42,184 on 2026-09-27 to 09-30 and 1,299 since 2026-10-01 (778 in the 24 hours to 17:43Z); none between those windows. 18 transfers seeded 2026-10-06 23:40-23:42Z kept agreement_reached pending. (2) The overdue sweep, transfer_staleness_sweep (SQL, SECURITY DEFINER; cron job transfer-staleness-sweep, jobid 189, every 4 hours, inactive, its last recorded runs failed with job startup timeout up to 2026-04-25) or the staleness_sweep action of transfer-automator, set 706,926 past-deadline rows overdue between 2026-02-26 19:55Z and 2026-03-31 12:00Z. Nothing has marked a row overdue since, so 1,672,100 pending rows are past their deadline (2026-10-07): overdue only says the deadline passed before 2026-03-31. (3) One statement on 2026-02-27 00:33Z, writer not recorded, set every step after agreement_reached skipped on 1,582 transfers that are completed; 123 other completed transfers keep 17 overdue steps each. (4) One transfer built by hand on 2026-02-26 with 28 steps (every step code, sequence 1 to 28, no deadlines, 15 notes); its 5 completed steps besides agreement_reached, two of them advanced from text messages by the edge function transfer-advance (deployed, version 54; source removed by 9871ee4fb), are the only completions that are not the seeding of agreement_reached. auto_complete_transfer_obligation() names the table, but no trigger calls it and the table transfer_obligations it updates does not exist. Liveness: pg_stat_user_tables counts 192,852 inserts, 10,696 updates and 0 deletes since the server last started (2026-09-29 09:20Z; read 17:45Z): 10,714 seeded transfers of 18 steps and their agreement_reached completions, less the 18 that did not land; no other step has moved since. Triggers: trg_transfer_milestone_completed (AFTER UPDATE, row) sets ownership_transfers.last_milestone_at to now() when a step becomes completed; trg_transfer_milestones_updated_at (BEFORE UPDATE, set_updated_at) sets updated_at. Readers: transfer-automator (get_transfer), transfer-advance (get_next_milestone and its message classifier), transfer-status-api (removed from main; deployment not checked), transfer_staleness_sweep, and the web pages TransferPartyPage.tsx (REST with the anon key, which RLS answers with no rows) and admin/TransfersDashboard.tsx (the signed-in client, so a user sees only the transfers it is a party to). No view, write receipt or active cron job. pipeline_registry holds one table-level row (owner transfer-automator, do_not_write_directly true). Foreign keys: transfer_id references ownership_transfers(id) ON DELETE CASCADE and completed_by_user_id references auth.users(id) ON DELETE SET NULL (validated); transfer_communications.linked_milestone_id references id ON DELETE SET NULL. Access: RLS is on; anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE; the policies let a party of the transfer (from_user_id or to_user_id equal to auth.uid()) read its steps and update every column of them, whichever party the step belongs to, with no insert or delete policy; 3 transfers and 64 steps have a party account (2026-10-07). anon reads 0 rows (counted under SET LOCAL ROLE anon, 2026-10-07). Paths around RLS: the deployed edge functions transfer-advance and transfer-automator run with the service role, have verify_jwt off and check no caller (read through the management API, 2026-10-07, not probed): any POST can complete any step of any transfer with a completion time, user id and note of its choosing (transfer-advance advance_manual), seed a transfer with 18 steps for any vehicle (transfer-automator seed_from_listing) or mark every past-deadline step overdue (staleness_sweep). Clocks: created_at is the seeding time; deadline_at is derived from the sale date; completed_at on agreement_reached is the sale date (the lot end, or the auction_events row write time when the end is unknown), not a moment a party confirmed; updated_at is the last write.';

-- ── Identity and order ─────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.transfer_milestones.id IS
'Surrogate key of the step, uuid NOT NULL, gen_random_uuid() default, the PRIMARY KEY. 2,606,482 values (2026-10-07 17:41Z). Referenced by transfer_communications.linked_milestone_id (ON DELETE SET NULL), which transfer-advance sets when a classified message completes the step: 2 of the 8 communications (2026-10-07). Unit: none (uuid). Source: column default. Grain: one step of one transfer. Clock: n/a.';
COMMENT ON COLUMN public.transfer_milestones.transfer_id IS
'Transfer the step belongs to: an ownership_transfers.id, uuid NOT NULL, foreign key ON DELETE CASCADE (validated), indexed (idx_transfer_milestones_transfer) and the first column of both UNIQUE keys. 144,804 transfers have steps (2026-10-07): 144,803 with the 18-step template of transfer-automator and 1 built by hand with 28. 29 of the 144,833 transfers have no step; transfer-automator logs a failed insert and continues, and the cause for these 29 is not recorded. Transfers are private: no transfer id is quoted here. Unit: none (uuid). Source: transfer-automator (the transfer it has just created). Grain: one step of one transfer. Clock: n/a.';
COMMENT ON COLUMN public.transfer_milestones.sequence IS
'Display order of the step within its transfer, integer NOT NULL, UNIQUE with transfer_id. The template of transfer-automator numbers its 18 steps 10, 20 to 180 in this order: agreement_reached, contact_exchanged, discussion_complete, deposit_triggered, deposit_sent, deposit_received, deposit_confirmed, inspection_scheduled, inspection_live, inspection_completed, full_payment_triggered, full_payment_sent, full_payment_received, payment_confirmed, title_sent, title_in_transit, title_received, transfer_complete; its shipping steps would take 155, 157 and 165 but were never seeded. The hand-built transfer uses 1 to 28 (2026-10-07). Deadlines do not follow the order (deposit_triggered is due 2 days before discussion_complete). Readers order by it (transfer-advance, transfer-status-api, the web pages). Unit: none (rank). Source: transfer-automator template. Grain: one step of one transfer. Clock: n/a.';
COMMENT ON COLUMN public.transfer_milestones.milestone_type IS
'Step code, enum milestone_type NOT NULL (28 labels), UNIQUE with transfer_id. 18 codes occur once on each of the 144,804 transfers (2026-10-07): the template of transfer-automator, listed under sequence. The other 10 labels (contract_drafted, contract_signed_seller, contract_signed_buyer, insurance_triggered, insurance_confirmed, obligations_defined, obligation_met, shipping_requested, shipping_initiated, vehicle_arrived) occur once each, on the hand-built transfer. transfer-advance classifies inbound messages against these codes, and notify-transfer-parties maps them to the party who must act. Unit: none (enum code). Source: transfer-automator template. Grain: one step of one transfer. Clock: n/a.';

-- ── State ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.transfer_milestones.status IS
'State of the step, enum milestone_status NOT NULL, default pending (labels pending, in_progress, completed, skipped, blocked, overdue); the partial indexes idx_transfer_milestones_status and idx_transfer_milestones_deadline cover rows not completed or skipped. Exact (2026-10-07 17:41Z): pending 1,727,866, overdue 706,926, completed 144,789, skipped 26,901; in_progress and blocked 0. completed: agreement_reached on 144,784 transfers (on 144,783 set by transfer-automator at seeding, not by a party; 1 on the hand-built transfer) and 5 other steps of the hand-built transfer. overdue: set only by the sweep (transfer_staleness_sweep or the transfer-automator staleness_sweep action) between 2026-02-26 and 2026-03-31; since then a pending row past its deadline stays pending (1,672,100 rows on 2026-10-07), so overdue and pending differ by when the transfer was seeded, not by progress. skipped: every step after agreement_reached on 1,582 completed transfers, set by one statement on 2026-02-27 00:33Z (writer not recorded), and 7 steps of the hand-built transfer. Writers that can change it: transfer-advance (completed), the sweep (overdue) and a party account through RLS (3 transfers). A change to completed fires trg_transfer_milestone_completed. Unit: none (enum code). Source: transfer-automator, the sweep, transfer-advance. Grain: one step of one transfer. Clock: as of updated_at.';
COMMENT ON COLUMN public.transfer_milestones.deadline_at IS
'When the step is due, timestamptz, nullable: the sale date of the transfer (ownership_transfers.sale_date: the lot end, or the auction_events row write time when the end is unknown) plus the days of the step in the template: agreement_reached 1, contact_exchanged 3, deposit_triggered 5, discussion_complete 7, deposit_sent 7, deposit_received 10, deposit_confirmed 12, inspection_scheduled 14, inspection_live 21, inspection_completed 25, full_payment_triggered 28, full_payment_sent 35, full_payment_received 40, payment_confirmed 42, title_sent 45, title_in_transit 50, title_received 60, transfer_complete 60 (checked against the completed_at of agreement_reached on a 1% sample, 2026-10-07; the JavaScript time strings drop the microseconds). Filled on 2,606,454 rows; NULL on the 28 hand-built rows. Transfers are seeded from old lots too, so 1,242,021 rows were past their deadline when inserted; 1,672,100 pending rows are past it now and 55,751 are not (2026-10-07). Indexed for open rows (idx_transfer_milestones_deadline); the sweep compares it with now(). Unit: timestamptz. Source: transfer-automator (sale date plus template days). Grain: one step of one transfer. Clock: derived (due time from the sale date).';
COMMENT ON COLUMN public.transfer_milestones.completed_at IS
'When the step was completed, as its writer states it, timestamptz, nullable. Filled on 144,789 rows (2026-10-07): agreement_reached on 144,783 seeded transfers, where transfer-automator writes the sale date (the lot end, or the auction_events row write time when the end is unknown; years 2014 to 2026, 93,108 of the completed agreement_reached rows in 2026), not a moment anyone confirmed agreement; and 6 steps of the hand-built transfer, its agreement_reached among them. transfer-advance writes the time its caller gives or its own clock. Seeding lag, created_at minus this value on agreement_reached: median 9 days, a tenth under 10 seconds, a tenth over 1,305 days (2026-10-07). Unit: timestamptz. Source: transfer-automator (sale date) or transfer-advance. Grain: one step of one transfer. Clock: event time (the sale, for agreement_reached).';
COMMENT ON COLUMN public.transfer_milestones.completed_by_user_id IS
'Account that completed the step: an auth.users.id, uuid, nullable, foreign key ON DELETE SET NULL (validated). NULL on all 2,606,482 rows (2026-10-07): transfer-automator never sets it, and transfer-advance writes whatever user id its caller names, unchecked. Unit: none (uuid). Source: transfer-advance (caller-supplied). Grain: one step of one transfer. Clock: n/a.';
COMMENT ON COLUMN public.transfer_milestones.evidence_id IS
'Intended reference to the document that proves the step (creating migration: a foreign key to transfer_documents, added after that table), uuid, nullable. Neither the foreign key nor the table transfer_documents exists on prod, and the column is NULL on every row (2026-10-07). transfer-advance advance_manual writes the value its caller sends; its classifier path leaves it NULL and links the message through transfer_communications.linked_milestone_id instead. Unit: none (uuid). Source: transfer-advance (caller-supplied; never set). Grain: one step of one transfer. Clock: n/a.';
COMMENT ON COLUMN public.transfer_milestones.notes IS
'Free-text note on the step, text, nullable. Filled on 15 rows, all on the hand-built transfer (2026-10-07): explanations of skipped steps, a test note and two notes transfer-advance wrote when it advanced a step from a text message (the prefix Auto-advanced from sms and the classifier reason). They describe a private sale; none is quoted here. transfer-advance advance_manual overwrites it with the caller text or NULL. Unit: none (text). Source: hand entry and transfer-advance. Grain: one step of one transfer. Clock: n/a.';

-- ── Clocks ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.transfer_milestones.created_at IS
'When the step was inserted, timestamptz NOT NULL, default now() (database clock; transfer-automator does not send it), so the 18 steps of a seeded transfer share the time of its insert. 2026-02-26 15:27Z to now (2026-10-07 17:45Z); by month (2026-10-07 17:41Z): 2026-02 589,366, 03 669,996, 04 150,174, 07 414,270, 09 759,312, 10 23,364; none in 2026-05, 06 and 08. Unit: timestamptz. Source: column default. Grain: one step of one transfer. Clock: ingest time (seeding).';
COMMENT ON COLUMN public.transfer_milestones.updated_at IS
'When the row was last written, timestamptz NOT NULL, default now(). The trigger trg_transfer_milestones_updated_at (BEFORE UPDATE, set_updated_at) sets it on every update, and transfer_staleness_sweep sets it too. Within a second of created_at on 1,865,348 rows, which were never updated or were completed at seeding; later on 741,134 (2026-10-07 17:41Z): the overdue sweep (2026-02-26 19:55Z to 2026-03-31 12:00Z), the skip statement (2026-02-27 00:33Z) and seeding completions that landed more than a second after the insert. Unit: timestamptz. Source: trigger (now()). Grain: one step of one transfer. Clock: write time (last update).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.transfer_milestones'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'transfer_milestones: every column has a comment';
  ELSE
    RAISE NOTICE 'transfer_milestones columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
