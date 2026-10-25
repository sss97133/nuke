-- auction_events whose vehicle_id is not in vehicles (12,217 rows, 11,207 vehicle ids; measured 2026-10-25 read-only).
-- ROOT CAUSE (measured): every orphan row was created 2025-12-03 .. 2026-03-15 (0 after the 2026-09-27 RESTRICT lock),
-- none has a merge record (merge_deleted_rows, vehicle_merge_proposals, merge_proposals, vehicles.merged_into_vehicle_id,
-- auction_events.merged_from_vehicle_id: 0 hits), and ~1/3 of their vehicle ids are also orphaned in vehicle_events.
-- In a sampled 1/8 of ids, 34% of the rows have the same listing URL on a live vehicle and 50% match a live
-- vehicle's discovery_url. So: duplicate vehicles were hard-deleted during the Dec-Mar bulk dedup era with RI
-- triggers off (session_replication_role = replica), without repointing their listings. No merge history -> no
-- cited repoint is possible; URL twins are left as candidates for review (vehicle merges/repoints wait for Skylar).
-- WHY UPDATES FAIL: auction_events_vehicle_id_fkey is NOT VALID but enforced. PostgreSQL skips the FK re-check on
-- an update that leaves vehicle_id unchanged, unless the row version was already written by the same transaction.
-- A single update works. A second update of the same row in one transaction, as batch backfills do, raises 23503.
-- GUARD: the existing FK (20260927170100) already rejects every new orphan from roles that keep RI triggers on.
-- It cannot be VALIDATEd while orphans exist, and no trigger can stop replica-mode writers either, so this file
-- adds no new constraint. It lets record_quarantine hold auction_events rows. The rows are quarantined by
-- run auction_event_orphan_quarantine_v1_20261025 (data step, outside this file; revert
-- supabase/sql/revert_auction_event_orphan_quarantine_v1.sql releases them, no deletes).
-- Revert of this file: none needed (wider CHECK is harmless); to narrow it, first release and archive the rows.
set lock_timeout = '10s';
alter table public.record_quarantine drop constraint if exists record_quarantine_tbl_check;
alter table public.record_quarantine add constraint record_quarantine_tbl_check
  check (tbl in ('vehicles','vehicle_events','auction_events'));
