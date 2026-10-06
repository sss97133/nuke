-- Describe ownership_transfers: table purpose with its clocks, and the 24 undescribed columns (3 of 27 described
-- before: trigger_id, stalled_at, public_visibility; those three are left as they are).
-- Lane C (cartographer), night shift 2026-10-05. Comments only. No contact values were read or written here.
--
-- EVIDENCE (read 2026-10-06 UTC):
--   Writer: edge function transfer-automator, action seed_from_auction, called through pg_net by trigger
--   auto_create_transfer_on_auction_close on auction_events when outcome becomes sold. The function source was
--   removed from the repo in 9871ee4fb (2026-03-31) but is still deployed (POST probe without auth: HTTP 500, not
--   404) and still writing: rows created up to 2026-10-05. Field mapping from its last repo version (9871ee4fb^):
--   agreed_price = winning_bid else high_bid; sale_date = auction_end_date else auction_events.updated_at;
--   from/to identity resolved from seller_name and winning_bidder; inbox_email = t-<short id>@nuke.ag; status
--   in_progress; milestones in transfer_milestones. Its staleness_sweep sets status stalled and stalled_at.
--   Full-table profile (144,005 rows): every row trigger_type auction, trigger_table auction_events, currency USD,
--   public_visibility vague; status in_progress 108,963 (42,681 created in the last 30 d), stalled 33,337 (created
--   2026-02-26 .. 2026-03-17), completed 1,705 (2026-02-26/27). from_identity_id 96,900, to_identity_id 97,398,
--   from_user_id 3, to_user_id 0, completed_at 0, cancelled_at 0; contact columns 0-1 rows each.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

BEGIN;

COMMENT ON TABLE public.ownership_transfers IS
'One row per transfer of a vehicle from seller to buyer (grain: one transfer), tracked from deal to title. Today every row is seeded from a sold auction lot: trigger auto_create_transfer_on_auction_close on auction_events calls the edge function transfer-automator (seed_from_auction), which is deployed but no longer in the repo (removed 9871ee4fb). Event time = sale_date (the lot end time; falls back to the auction_events row write time when the end time is unknown). Ingest time = created_at. Rows are state rows (status moves in place; milestones live in transfer_milestones). Contact and token columns are private: never expose their values.';

COMMENT ON COLUMN public.ownership_transfers.id IS
'Surrogate key of the transfer. Unit: none (uuid). Source: gen_random_uuid() default. Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.vehicle_id IS
'Vehicle transferred, FK to vehicles.id (NOT VALID, ON DELETE RESTRICT). Unit: none. Source: transfer-automator from the auction_events row. Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.from_user_id IS
'Seller as a Nuke account (auth.users.id), when the seller identity is claimed. Unit: none. Source: transfer-automator resolves it from from_identity_id; 3 of 144,005 rows (2026-10-06). Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.to_user_id IS
'Buyer as a Nuke account (auth.users.id), when the buyer identity is claimed. Unit: none. Source: transfer-automator; trigger trg_upgrade_transfers_on_identity_claim fills it on a later claim. 0 rows (2026-10-06). Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.from_identity_id IS
'Seller platform identity, FK to external_identities.id. Unit: none. Source: transfer-automator resolves auction_events.seller_name on the lot platform; 96,900 of 144,005 rows. Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.to_identity_id IS
'Buyer platform identity, FK to external_identities.id. Unit: none. Source: transfer-automator resolves auction_events.winning_bidder (else high_bidder); 97,398 of 144,005 rows. Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.trigger_type IS
'What started the transfer (enum transfer_trigger_type: auction, listing, private_sale, inheritance, gift). Every row is auction (2026-10-06). Unit: none. Source: transfer-automator. Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.trigger_table IS
'Table that trigger_id points into; auction_events on every row (2026-10-06). Unit: none. Source: transfer-automator. Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.agreed_price IS
'Price agreed for the vehicle: auction_events.winning_bid, else high_bid. Unit: currency (USD on every row), hammer price, buyer fee excluded. Source: transfer-automator. Grain: one transfer. Clock: event (value at sale_date).';
COMMENT ON COLUMN public.ownership_transfers.currency IS
'Currency of agreed_price; USD (default) on every row. Unit: ISO currency code. Source: default. Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.status IS
'Transfer state (enum transfer_status: pending, in_progress, completed, cancelled, disputed, stalled). transfer-automator seeds in_progress; its staleness sweep sets stalled. 2026-10-06: in_progress 108,963, stalled 33,337, completed 1,705. Changes fire trg_transfer_status_changed. Unit: none. Grain: one transfer. Clock: n/a (state as of updated_at).';
COMMENT ON COLUMN public.ownership_transfers.sale_date IS
'When the deal was struck: the auction lot end time (auction_events.auction_end_date), or the lot row write time when that is unknown. Unit: timestamptz (UTC). Source: transfer-automator. Grain: one transfer. Clock: event (source sale; ingest-clock fallback).';
COMMENT ON COLUMN public.ownership_transfers.completed_at IS
'When the transfer finished (title received). Unit: timestamptz (UTC). Source: transfer milestone flow; NULL on every row, including the 1,705 completed ones (2026-10-06). Grain: one transfer. Clock: event (would be completion).';
COMMENT ON COLUMN public.ownership_transfers.cancelled_at IS
'When the transfer was cancelled. Unit: timestamptz (UTC). Source: transfer flow; NULL on every row (2026-10-06). Grain: one transfer. Clock: event.';
COMMENT ON COLUMN public.ownership_transfers.last_milestone_at IS
'When the latest transfer_milestones step moved. Unit: timestamptz (UTC). Source: transfer-automator and the milestone flow (the first milestone, agreement reached, completes at sale_date). Grain: one transfer. Clock: derived (latest milestone time).';
COMMENT ON COLUMN public.ownership_transfers.created_at IS
'When the transfer row was inserted. Unit: timestamptz (UTC). Source: default now(); earliest 2026-02-26. Grain: one transfer. Clock: ingest.';
COMMENT ON COLUMN public.ownership_transfers.updated_at IS
'When the transfer row was last written. Unit: timestamptz (UTC). Source: trigger trg_ownership_transfers_updated_at. Grain: one transfer. Clock: ingest.';
COMMENT ON COLUMN public.ownership_transfers.inbox_email IS
'Per-transfer inbound mail address on nuke.ag (t-<short transfer id>), where parties forward transfer paperwork. Not a person contact. Unit: none. Source: transfer-automator. Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.buyer_phone IS
'Buyer phone number. PRIVATE contact data. Unit: none. Source: entered by a party to the transfer; 1 row (2026-10-06). Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.seller_phone IS
'Seller phone number. PRIVATE contact data. Unit: none. Source: entered by a party to the transfer; 0 rows (2026-10-06). Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.buyer_email IS
'Buyer email address. PRIVATE contact data. Unit: none. Source: entered by a party to the transfer; 1 row (2026-10-06). Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.seller_email IS
'Seller email address. PRIVATE contact data. Unit: none. Source: entered by a party to the transfer; 0 rows (2026-10-06). Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.buyer_access_token IS
'Secret token in the buyer link that opens this transfer without an account. A credential: never expose. Unit: none (uuid). Source: gen_random_uuid() default. Grain: one transfer. Clock: n/a.';
COMMENT ON COLUMN public.ownership_transfers.seller_access_token IS
'Secret token in the seller link that opens this transfer without an account. A credential: never expose. Unit: none (uuid). Source: gen_random_uuid() default. Grain: one transfer. Clock: n/a.';

COMMIT;
