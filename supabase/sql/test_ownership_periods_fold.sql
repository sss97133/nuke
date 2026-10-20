-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_ownership_fold -f this-file.sql
-- Contract for 20261020330000_ownership_periods_fold.sql. Synthetic rows only; never production.
--   * the migration applies twice;
--   * a vehicle with three sold lots whose chain continues (each seller is the previous winner) folds to the first
--     seller (start unknown), then one period per winner, each ending at the next lot, the last one current;
--   * a sold lot is a recorded sale: when the next listing (any outcome) is by the same seller, no period starts for the
--     winner, the lot is flagged relist_same_seller, and the seller keeps holding (a held period when no sale after it
--     handed the vehicle on); when the next listing is by the winner, the period says confirmed_next_lot, otherwise
--     recorded; an unsold lot with no clock is listed and not used;
--   * every lot gets a link state against the lot before it (first, continuity, break, relist_same_seller, prev_not_sold,
--     unkeyed, undated, date_error), reported and never stored;
--   * a seller who is not the previous winner keeps both periods, marks the earlier end unknown, and flags both
--     sides handover_unobserved with the neighbouring lot; no bridge is invented;
--   * a lot that is not sold is never read; a lot whose seller or winner is unkeyed flags party_unkeyed;
--   * one lot recorded twice with the same parties is read once and flagged; with different parties, the vehicle is
--     not folded; two lots on one clock, or a sold lot with no clock at all, do not fold the vehicle either;
--   * the clock falls back to vehicle_events.sold_at and says so;
--   * a claimed identity resolves to its profile in v_vehicle_owner_periods and never in the profile-keyed columns;
--   * a user-keyed current owner is neither ended by the fold nor does it end a fold row, and v_vehicle_ownership_status
--     keeps showing the user's owner;
--   * a signed-in vehicle uploader cannot write or alter a fold row;
--   * fold rows are private: anon and authenticated read none of them (the user-keyed rows stay visible), the reader view,
--     the flag table and the fold, plan, party and relabel functions are not reachable by them, service_role holds them;
--   * a re-run with the same inputs writes nothing; changed inputs supersede (the old row is kept, pointed at its
--     replacement) and one current period per vehicle remains; a dry run writes nothing; the cursor pages through;
--   * ownership_fold_party() is the join point: a bridge that maps one handle to another closes the chain;
--   * auction-seeded in_progress transfers with no observed milestone move to recorded_unconfirmed with their open
--     milestones not_observable; transfers with observed progress or communications stay in_progress.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicle_ownerships') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.fails(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS % (%)', label, SQLERRM; RETURN; END;
  RAISE EXCEPTION 'Contract failed: % (statement succeeded)', label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(text, boolean), pg_temp.fails(text, text) TO anon, authenticated, service_role;

-- auth.uid() as Supabase defines it
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- what the migration reads and alters, with their live shapes (2026-10-20)
CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year int, make text, model text, vin text, is_public boolean, uploaded_by uuid);
CREATE TABLE public.external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text NOT NULL, handle text NOT NULL, claimed_by_user_id uuid,
  claim_confidence integer, UNIQUE (platform, handle));
CREATE TABLE public.ownership_verifications (
  id uuid PRIMARY KEY, vehicle_id uuid, user_id uuid, status text, verification_category text, approved_at timestamptz);
CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source text, source_url text, outcome text,
  auction_end_date timestamptz, seller_external_identity_id uuid, winning_bidder_external_identity_id uuid);
CREATE TABLE public.vehicle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_url text, sold_at timestamptz, ended_at timestamptz);
CREATE TABLE public.vehicle_ownerships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  owner_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'owner', is_current boolean NOT NULL DEFAULT true,
  start_date date, end_date date, proof_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  ownership_type text, verification_id uuid REFERENCES public.ownership_verifications(id) ON DELETE SET NULL,
  authority_score integer,
  CONSTRAINT vehicle_ownerships_authority_score_check CHECK (authority_score IS NULL OR (authority_score >= 0 AND authority_score <= 100)),
  CONSTRAINT vehicle_ownerships_ownership_type_check CHECK (ownership_type IS NULL OR ownership_type IN ('legal_title', 'physical_possession', 'operational_custody', 'claimed_unverified')));
CREATE INDEX idx_vehicle_ownerships_current ON public.vehicle_ownerships (vehicle_id, is_current);
CREATE INDEX idx_vehicle_ownerships_owner ON public.vehicle_ownerships (owner_profile_id);
CREATE FUNCTION public.set_single_current_owner() RETURNS trigger LANGUAGE plpgsql AS $function$
begin
  if NEW.is_current then
    update public.vehicle_ownerships
       set is_current = false, end_date = coalesce(end_date, NEW.start_date)
     where vehicle_id = NEW.vehicle_id and id <> NEW.id and is_current = true;
  end if;
  NEW.updated_at := now();
  return NEW;
end; $function$;
CREATE TRIGGER trg_single_current_owner BEFORE INSERT OR UPDATE ON public.vehicle_ownerships
  FOR EACH ROW EXECUTE FUNCTION public.set_single_current_owner();
ALTER TABLE public.vehicle_ownerships ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_ownerships_public_read ON public.vehicle_ownerships FOR SELECT
  USING ((EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_ownerships.vehicle_id AND COALESCE(v.is_public, true) = true))
         OR owner_profile_id = (SELECT auth.uid()));
CREATE POLICY vehicle_ownerships_owner_write ON public.vehicle_ownerships FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_ownerships.vehicle_id AND v.uploaded_by = (SELECT auth.uid())));
CREATE POLICY vehicle_ownerships_owner_update ON public.vehicle_ownerships FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_ownerships.vehicle_id AND v.uploaded_by = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_ownerships.vehicle_id AND v.uploaded_by = (SELECT auth.uid())));
CREATE VIEW public.v_vehicle_ownership_status WITH (security_invoker = true) AS
 SELECT v.id AS vehicle_id, v.year, v.make, v.model, v.vin, ov_title.user_id AS title_holder_id, ov_title.status AS title_status,
    ov_title.approved_at AS title_verified_at, vo.owner_profile_id AS current_owner_id, vo.ownership_type, vo.authority_score,
    vo.start_date AS ownership_start, NULL::uuid AS likely_possessor_id,
    CASE WHEN ov_title.user_id IS NOT NULL AND vo.owner_profile_id IS NOT NULL AND ov_title.user_id <> vo.owner_profile_id THEN true ELSE false END AS has_ownership_conflict
   FROM vehicles v
     LEFT JOIN ownership_verifications ov_title ON ov_title.vehicle_id = v.id AND ov_title.status = 'approved' AND ov_title.verification_category = 'title_document'
     LEFT JOIN vehicle_ownerships vo ON vo.vehicle_id = v.id AND vo.is_current = true AND vo.role = ANY (ARRAY['owner', 'verified_owner']);

CREATE TYPE public.transfer_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled', 'disputed', 'stalled');
CREATE TYPE public.milestone_status AS ENUM ('pending', 'in_progress', 'completed', 'skipped', 'blocked', 'overdue');
CREATE TABLE public.ownership_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, trigger_table text, trigger_id uuid,
  status public.transfer_status NOT NULL DEFAULT 'in_progress');
CREATE TABLE public.transfer_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id uuid NOT NULL REFERENCES public.ownership_transfers(id),
  milestone_type text NOT NULL, status public.milestone_status NOT NULL DEFAULT 'pending', notes text);
CREATE TABLE public.transfer_communications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id uuid NOT NULL REFERENCES public.ownership_transfers(id));

-- the migration applies twice
\ir ../migrations/20261020330000_ownership_periods_fold.sql
\ir ../migrations/20261020330000_ownership_periods_fold.sql

-- ---------------------------------------------------------------------------------------------------------------------
-- fixtures: uuids by number so a failure names its row
CREATE FUNCTION pg_temp.u(kind int, n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-' || lpad(kind::text, 4, '0') || '-' || lpad(n::text, 12, '0'))::uuid $$;
-- kind 1 vehicle, 2 identity, 3 lot, 4 profile
INSERT INTO public.profiles SELECT pg_temp.u(4, n) FROM generate_series(1, 3) n;
INSERT INTO public.vehicles (id, is_public) SELECT pg_temp.u(1, n), true FROM generate_series(1, 16) n;
INSERT INTO public.external_identities (id, platform, handle, claimed_by_user_id, claim_confidence)
SELECT pg_temp.u(2, n), 'bat', 'synthetic_handle_' || n, CASE WHEN n = 30 THEN pg_temp.u(4, 1) END, CASE WHEN n = 30 THEN 100 END
  FROM generate_series(1, 70) n;

CREATE FUNCTION pg_temp.lot(n int, veh int, url text, outcome text, ends text, seller int, winner int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.auction_events (id, vehicle_id, source, source_url, outcome, auction_end_date, seller_external_identity_id, winning_bidder_external_identity_id)
  VALUES (pg_temp.u(3, n), pg_temp.u(1, veh), 'bat', 'https://bringatrailer.com/listing/' || url || '/', outcome, ends::timestamptz,
          CASE WHEN seller IS NOT NULL THEN pg_temp.u(2, seller) END, CASE WHEN winner IS NOT NULL THEN pg_temp.u(2, winner) END) $$;

-- V1: three sold lots, the chain continues: S1 -> W2 (lot 1), W2 -> W3 (lot 2), W3 -> W4 (lot 3)
SELECT pg_temp.lot(1, 1, 'v1-a', 'sold', '2024-01-10 20:00+00', 1, 2);
SELECT pg_temp.lot(2, 1, 'v1-b', 'sold', '2024-06-10 20:00+00', 2, 3);
SELECT pg_temp.lot(3, 1, 'v1-c', 'sold', '2025-02-10 20:00+00', 3, 4);
-- V2: the next seller (X=9) is not the previous winner (W6): a gap; and a reserve-not-met lot that must be ignored
SELECT pg_temp.lot(4, 2, 'v2-a', 'sold', '2024-01-10 20:00+00', 5, 6);
SELECT pg_temp.lot(5, 2, 'v2-b', 'reserve_not_met', '2024-03-10 20:00+00', 7, NULL);
SELECT pg_temp.lot(6, 2, 'v2-c', 'sold', '2024-09-10 20:00+00', 9, 10);
-- V3: the only sold lot is followed by an unsold lot by a different seller: the unsold lot changes nothing
SELECT pg_temp.lot(7, 3, 'v3-a', 'sold', '2024-01-10 20:00+00', 11, 12);
SELECT pg_temp.lot(8, 3, 'v3-b', 'no_sale', '2024-05-10 20:00+00', 13, NULL);
-- V4: one lot twice with the same parties (URL differs by a query string): read once, flagged
SELECT pg_temp.lot(9, 4, 'v4-a', 'sold', '2024-01-10 20:00+00', 14, 15);
INSERT INTO public.auction_events (id, vehicle_id, source, source_url, outcome, auction_end_date, seller_external_identity_id, winning_bidder_external_identity_id)
VALUES (pg_temp.u(3, 10), pg_temp.u(1, 4), 'bat', 'https://bringatrailer.com/listing/v4-a/?utm=1', 'sold', '2024-01-10 20:00+00', pg_temp.u(2, 14), pg_temp.u(2, 15));
-- V5: one lot twice with different winners: the vehicle is not folded
SELECT pg_temp.lot(11, 5, 'v5-a', 'sold', '2024-01-10 20:00+00', 16, 17);
INSERT INTO public.auction_events (id, vehicle_id, source, source_url, outcome, auction_end_date, seller_external_identity_id, winning_bidder_external_identity_id)
VALUES (pg_temp.u(3, 12), pg_temp.u(1, 5), 'bat', 'https://bringatrailer.com/listing/v5-a/?utm=1', 'sold', '2024-01-10 20:00+00', pg_temp.u(2, 16), pg_temp.u(2, 18));
-- V6: two different lots on one clock: not folded
SELECT pg_temp.lot(13, 6, 'v6-a', 'sold', '2024-01-10 20:00+00', 19, 20);
SELECT pg_temp.lot(14, 6, 'v6-b', 'sold', '2024-01-10 20:00+00', 20, 21);
-- V7: no end date; vehicle_events.sold_at is the declared fallback clock. Winner 31, then a seller 31 continues the chain
SELECT pg_temp.lot(15, 7, 'v7-a', 'sold', NULL, 22, 31);
SELECT pg_temp.lot(16, 7, 'v7-b', 'sold', '2025-01-10 20:00+00', 31, 23);
INSERT INTO public.vehicle_events (source_url, sold_at, ended_at) VALUES ('https://bringatrailer.com/listing/v7-a/', '2024-02-02 19:00+00', '2024-02-02 20:00+00');
-- V8: a sold lot with no clock anywhere: the vehicle is not folded
SELECT pg_temp.lot(17, 8, 'v8-a', 'sold', NULL, 24, 25);
SELECT pg_temp.lot(18, 8, 'v8-b', 'sold', '2025-01-10 20:00+00', 25, 26);
-- V9: the winner is the claimed identity (30); a user-keyed current owner already holds the vehicle
SELECT pg_temp.lot(19, 9, 'v9-a', 'sold', '2024-04-04 20:00+00', 27, 30);
INSERT INTO public.vehicle_ownerships (vehicle_id, owner_profile_id, role, is_current, start_date, ownership_type)
VALUES (pg_temp.u(1, 9), pg_temp.u(4, 2), 'verified_owner', true, '2026-05-24', 'legal_title');
-- V10: the winner of the first lot is unknown to us (unkeyed), the next lot's seller is keyed; and a seller who also won
SELECT pg_temp.lot(20, 10, 'v10-a', 'sold', '2024-01-10 20:00+00', 32, NULL);
SELECT pg_temp.lot(21, 10, 'v10-b', 'sold', '2024-07-10 20:00+00', 33, 34);
SELECT pg_temp.lot(22, 10, 'v10-c', 'sold', '2024-12-10 20:00+00', 35, 35);
-- V12: the same seller lists it again after a sold lot, and nothing sold since: the sale did not hand it on
SELECT pg_temp.lot(40, 12, 'v12-a', 'sold', '2024-01-10 20:00+00', 41, 42);
SELECT pg_temp.lot(41, 12, 'v12-b', 'no_sale', '2024-03-10 20:00+00', 41, NULL);
-- V13: the same seller relists and then sells: the first sale did not hand it on
SELECT pg_temp.lot(42, 13, 'v13-a', 'sold', '2024-01-10 20:00+00', 43, 44);
SELECT pg_temp.lot(43, 13, 'v13-b', 'sold', '2024-05-10 20:00+00', 43, 45);
-- V14: the winner lists it next, unsold: the sale is confirmed
SELECT pg_temp.lot(44, 14, 'v14-a', 'sold', '2024-01-10 20:00+00', 46, 47);
SELECT pg_temp.lot(45, 14, 'v14-b', 'reserve_not_met', '2024-04-10 20:00+00', 47, NULL);
-- V15: a sale hands it on (48 -> 49), then another seller's sale (50 -> 51) is followed by the same seller 50 listing it again
SELECT pg_temp.lot(46, 15, 'v15-a', 'sold', '2024-01-10 20:00+00', 48, 49);
SELECT pg_temp.lot(47, 15, 'v15-b', 'sold', '2024-06-10 20:00+00', 50, 51);
SELECT pg_temp.lot(48, 15, 'v15-c', 'no_sale', '2024-08-10 20:00+00', 50, NULL);
-- V16: an unsold lot with no clock at all: listed, not used, and the vehicle still folds
SELECT pg_temp.lot(49, 16, 'v16-a', 'sold', '2024-01-10 20:00+00', 52, 53);
SELECT pg_temp.lot(50, 16, 'v16-b', 'bid_to', NULL, 54, NULL);
-- V11: another source with no parties at all: nothing to fold
INSERT INTO public.auction_events (vehicle_id, source, source_url, outcome, auction_end_date)
VALUES (pg_temp.u(1, 11), 'mecum', 'https://example.test/lot/11', 'sold', '2024-01-10 20:00+00');

-- ---------------------------------------------------------------------------------------------------------------------
-- dry run first: nothing is written
CREATE TEMP TABLE _dry AS SELECT public.fold_vehicle_ownership_periods(NULL, 100, false) AS r;
SELECT pg_temp.ok('a dry run reports periods and writes none',
  (SELECT (r ->> 'periods')::int > 0 AND (r ->> 'applied')::boolean IS FALSE FROM _dry)
  AND (SELECT count(*) FROM public.vehicle_ownerships WHERE basis IS NOT NULL) = 0
  AND (SELECT count(*) FROM public.ownership_fold_flags) = 0);
SELECT pg_temp.ok('a vehicle whose only sold lots name no party is not a candidate',
  (SELECT (r ->> 'vehicles')::int FROM _dry) = 15);

SELECT public.fold_vehicle_ownership_periods(NULL, 100, true);

-- how every lot links to the lot before it, reported and never stored
CREATE TEMP TABLE _links AS
  SELECT p.vehicle_id, p.flag_lot_id AS lot_id, p.flag_reason AS state
    FROM public.ownership_fold_plan(ARRAY(SELECT id FROM public.vehicles)) p WHERE p.kind = 'link';
SELECT pg_temp.ok('link states: a chain is first, continuity, continuity',
  (SELECT array_agg(state ORDER BY lot_id) FROM _links WHERE vehicle_id = pg_temp.u(1, 1)) = ARRAY['first', 'continuity', 'continuity']);
SELECT pg_temp.ok('link states: a different seller is a break, and the lot after an unsold lot is prev_not_sold',
  (SELECT array_agg(state ORDER BY lot_id) FROM _links WHERE vehicle_id = pg_temp.u(1, 2)) = ARRAY['first', 'break', 'prev_not_sold']);
SELECT pg_temp.ok('link states: the same seller again is relist_same_seller, a lot on one clock is date_error, no clock is undated, an unkeyed side is unkeyed',
  (SELECT state FROM _links WHERE lot_id = pg_temp.u(3, 41)) = 'relist_same_seller'
  AND (SELECT state FROM _links WHERE lot_id = pg_temp.u(3, 43)) = 'relist_same_seller'
  AND (SELECT state FROM _links WHERE lot_id = pg_temp.u(3, 14)) = 'date_error'
  AND (SELECT state FROM _links WHERE lot_id = pg_temp.u(3, 50)) = 'undated'
  AND (SELECT state FROM _links WHERE lot_id = pg_temp.u(3, 17)) = 'undated'
  AND (SELECT state FROM _links WHERE lot_id = pg_temp.u(3, 21)) = 'unkeyed');
SELECT pg_temp.ok('link states are not written anywhere', NOT EXISTS (SELECT 1 FROM public.ownership_fold_flags WHERE reason NOT IN ('duplicate_lot', 'duplicate_lot_conflict', 'no_event_clock', 'same_clock', 'seller_is_winner', 'relist_same_seller', 'unsold_lot_unordered')));

-- V1: the chain continues
SELECT pg_temp.ok('V1: four periods, one per party: the first seller (start unknown) and three winners',
  (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND basis IS NOT NULL) = 4);
SELECT pg_temp.ok('V1: the first seller has an unknown start and ends at lot 1, with no start date invented',
  EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND owner_identity_id = pg_temp.u(2, 1)
          AND start_unknown AND start_at IS NULL AND start_date IS NULL AND end_at = '2024-01-10 20:00+00'
          AND disposed_via_lot_id = pg_temp.u(3, 1) AND acquired_via_lot_id IS NULL AND chain_flag IS NULL));
SELECT pg_temp.ok('V1: each winner holds from its lot to the next lot, proved by both lots, with no flag',
  EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND owner_identity_id = pg_temp.u(2, 2)
          AND start_at = '2024-01-10 20:00+00' AND end_at = '2024-06-10 20:00+00' AND NOT start_unknown AND NOT end_unknown
          AND acquired_via_lot_id = pg_temp.u(3, 1) AND disposed_via_lot_id = pg_temp.u(3, 2) AND proof_event_id = pg_temp.u(3, 1)
          AND NOT is_current AND chain_flag IS NULL AND start_clock_source = 'auction_events.auction_end_date')
  AND EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND owner_identity_id = pg_temp.u(2, 3)
          AND start_at = '2024-06-10 20:00+00' AND end_at = '2025-02-10 20:00+00' AND chain_flag IS NULL));
SELECT pg_temp.ok('V1: the last winner is the one current period, open ended',
  (SELECT array_agg(owner_identity_id) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND is_current) = ARRAY[pg_temp.u(2, 4)]
  AND EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND is_current AND end_at IS NULL AND NOT end_unknown));
SELECT pg_temp.ok('V1: a winner whose seller is the next lot''s seller is confirmed_next_lot; the last winner is only recorded; a seller period has no confirmation',
  (SELECT sale_confirmation FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND owner_identity_id = pg_temp.u(2, 2)) = 'confirmed_next_lot'
  AND (SELECT sale_confirmation FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND owner_identity_id = pg_temp.u(2, 3)) = 'confirmed_next_lot'
  AND (SELECT sale_confirmation FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND owner_identity_id = pg_temp.u(2, 4)) = 'recorded'
  AND (SELECT sale_confirmation FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND owner_identity_id = pg_temp.u(2, 1)) IS NULL);
SELECT pg_temp.ok('V1: a fold row is low authority, unverified, and carries the vehicle''s role owner and its fold key',
  (SELECT bool_and(authority_score = 20 AND ownership_type = 'claimed_unverified' AND role = 'owner' AND owner_profile_id IS NULL
                   AND basis = 'auction_sale' AND fold_hash IS NOT NULL) FROM public.vehicle_ownerships WHERE basis IS NOT NULL)
  AND EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE fold_key = 'acq:' || pg_temp.u(3, 1) AND vehicle_id = pg_temp.u(1, 1)));

-- V2: the gap is marked, not bridged
SELECT pg_temp.ok('V2: a different seller on the next lot keeps both periods: S5, W6, X9, W10 (the unsold lot is not read)',
  (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 2) AND basis IS NOT NULL) = 4
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE owner_identity_id = pg_temp.u(2, 7)));
SELECT pg_temp.ok('V2: the earlier winner''s end is unknown and flagged with the next lot; the later seller''s start is unknown and flagged with the earlier lot',
  EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 2) AND owner_identity_id = pg_temp.u(2, 6)
          AND end_unknown AND end_at IS NULL AND end_date IS NULL AND NOT is_current AND disposed_via_lot_id IS NULL
          AND chain_flag = 'handover_unobserved' AND chain_peer_lot_id = pg_temp.u(3, 6))
  AND EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 2) AND owner_identity_id = pg_temp.u(2, 9)
          AND start_unknown AND end_at = '2024-09-10 20:00+00' AND chain_flag = 'handover_unobserved' AND chain_peer_lot_id = pg_temp.u(3, 4)));
SELECT pg_temp.ok('V2: the gap raised no refusal flag: the fold keeps what it knows',
  NOT EXISTS (SELECT 1 FROM public.ownership_fold_flags WHERE vehicle_id = pg_temp.u(1, 2)));

-- V3: unsold lots change nothing
SELECT pg_temp.ok('V3: an unsold lot by another seller is never read; the sold lot gives two periods, the winner current',
  (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 3) AND basis IS NOT NULL) = 2
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE owner_identity_id = pg_temp.u(2, 13))
  AND (SELECT owner_identity_id FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 3) AND is_current) = pg_temp.u(2, 12));

-- V4 / V5 / V6 / V8: what is refused
SELECT pg_temp.ok('V4: one lot recorded twice with the same parties is read once and flagged duplicate_lot',
  (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 4) AND basis IS NOT NULL) = 2
  AND EXISTS (SELECT 1 FROM public.ownership_fold_flags WHERE vehicle_id = pg_temp.u(1, 4) AND reason = 'duplicate_lot'
              AND auction_event_id = pg_temp.u(3, 10) AND resolved_at IS NULL AND (detail ->> 'kept_lot')::uuid = pg_temp.u(3, 9)));
SELECT pg_temp.ok('V5: one lot recorded twice with different winners: not folded, flagged duplicate_lot_conflict',
  NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 5))
  AND EXISTS (SELECT 1 FROM public.ownership_fold_flags WHERE vehicle_id = pg_temp.u(1, 5) AND reason = 'duplicate_lot_conflict'));
SELECT pg_temp.ok('V6: two lots on one clock: not folded, both lots flagged same_clock',
  NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 6))
  AND (SELECT count(*) FROM public.ownership_fold_flags WHERE vehicle_id = pg_temp.u(1, 6) AND reason = 'same_clock') = 2);
SELECT pg_temp.ok('V8: a sold lot with no clock anywhere: the vehicle is not folded, flagged no_event_clock',
  NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 8))
  AND EXISTS (SELECT 1 FROM public.ownership_fold_flags WHERE vehicle_id = pg_temp.u(1, 8) AND reason = 'no_event_clock' AND auction_event_id = pg_temp.u(3, 17)));

-- V7: the fallback clock
SELECT pg_temp.ok('V7: a lot without an end date takes vehicle_events.sold_at and names it; the chain still joins',
  EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 7) AND owner_identity_id = pg_temp.u(2, 31)
          AND start_at = '2024-02-02 19:00+00' AND start_clock_source = 'vehicle_events.sold_at'
          AND end_at = '2025-01-10 20:00+00' AND end_clock_source = 'auction_events.auction_end_date' AND chain_flag IS NULL));

-- V9: the claimed identity, and the user-keyed owner
SELECT pg_temp.ok('V9: the claimed identity resolves to its profile in the reader and never in the profile column',
  EXISTS (SELECT 1 FROM public.v_vehicle_owner_periods WHERE vehicle_id = pg_temp.u(1, 9) AND owner_identity_id = pg_temp.u(2, 30)
          AND resolved_profile_id = pg_temp.u(4, 1) AND owner_profile_id IS NULL AND claim_confidence = 100 AND owner_handle = 'synthetic_handle_30')
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE owner_profile_id = pg_temp.u(4, 1)));
SELECT pg_temp.ok('V9: an unclaimed identity resolves to no profile, and a user-keyed row resolves to itself',
  EXISTS (SELECT 1 FROM public.v_vehicle_owner_periods WHERE vehicle_id = pg_temp.u(1, 9) AND owner_identity_id = pg_temp.u(2, 27) AND resolved_profile_id IS NULL)
  AND EXISTS (SELECT 1 FROM public.v_vehicle_owner_periods WHERE vehicle_id = pg_temp.u(1, 9) AND owner_profile_id = pg_temp.u(4, 2) AND resolved_profile_id = pg_temp.u(4, 2)));
SELECT pg_temp.ok('V9: the fold did not end the user''s current ownership, and the status view still shows it',
  EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 9) AND owner_profile_id = pg_temp.u(4, 2) AND is_current AND end_date IS NULL)
  AND (SELECT count(*) FROM public.v_vehicle_ownership_status WHERE vehicle_id = pg_temp.u(1, 9)) = 1
  AND (SELECT current_owner_id FROM public.v_vehicle_ownership_status WHERE vehicle_id = pg_temp.u(1, 9)) = pg_temp.u(4, 2)
  AND (SELECT count(*) FROM public.v_vehicle_ownership_status WHERE vehicle_id = pg_temp.u(1, 1)) = 1
  AND (SELECT current_owner_id FROM public.v_vehicle_ownership_status WHERE vehicle_id = pg_temp.u(1, 1)) IS NULL);
INSERT INTO public.vehicle_ownerships (vehicle_id, owner_profile_id, role, is_current, start_date, ownership_type)
VALUES (pg_temp.u(1, 9), pg_temp.u(4, 3), 'verified_owner', true, '2026-06-01', 'legal_title');
SELECT pg_temp.ok('V9: a new user-keyed current owner ends the previous user-keyed one, not the fold''s current period',
  (SELECT is_current FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 9) AND owner_profile_id = pg_temp.u(4, 2)) IS FALSE
  AND (SELECT is_current FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 9) AND owner_identity_id = pg_temp.u(2, 30)) IS TRUE);

-- V10: unkeyed parties and a seller who also won
SELECT pg_temp.ok('V10: an unkeyed winner leaves no period for it; the next seller is flagged party_unkeyed with the earlier lot',
  NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 10) AND acquired_via_lot_id = pg_temp.u(3, 20))
  AND EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 10) AND owner_identity_id = pg_temp.u(2, 33)
              AND start_unknown AND chain_flag = 'party_unkeyed' AND chain_peer_lot_id = pg_temp.u(3, 20)));
SELECT pg_temp.ok('V10: a lot naming one identity on both sides is read as written and flagged seller_is_winner',
  EXISTS (SELECT 1 FROM public.ownership_fold_flags WHERE vehicle_id = pg_temp.u(1, 10) AND reason = 'seller_is_winner' AND auction_event_id = pg_temp.u(3, 22)));

-- V12 to V16: a sold lot is a recorded sale
SELECT pg_temp.ok('V12: the same seller listing again after the sale means the winner holds nothing; the seller holds it now, start unknown, proved by the sale lot',
  (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 12) AND basis IS NOT NULL) = 1
  AND EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 12) AND owner_identity_id = pg_temp.u(2, 41)
              AND fold_key = 'held:' || pg_temp.u(3, 40) AND is_current AND start_unknown AND NOT end_unknown AND listed_via_lot_id = pg_temp.u(3, 40)
              AND proof_event_id = pg_temp.u(3, 40) AND chain_flag IS NULL)
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE owner_identity_id = pg_temp.u(2, 42))
  AND EXISTS (SELECT 1 FROM public.ownership_fold_flags WHERE vehicle_id = pg_temp.u(1, 12) AND reason = 'relist_same_seller'
              AND auction_event_id = pg_temp.u(3, 40) AND (detail ->> 'next_lot')::uuid = pg_temp.u(3, 41) AND resolved_at IS NULL));
SELECT pg_temp.ok('V13: relist then sale: the first winner has no period, the seller''s period runs to the lot that handed the vehicle on',
  NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE owner_identity_id = pg_temp.u(2, 44))
  AND EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 13) AND owner_identity_id = pg_temp.u(2, 43)
              AND start_unknown AND end_at = '2024-05-10 20:00+00' AND disposed_via_lot_id = pg_temp.u(3, 43) AND chain_flag IS NULL)
  AND EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 13) AND owner_identity_id = pg_temp.u(2, 45) AND is_current AND sale_confirmation = 'recorded')
  AND (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 13) AND basis IS NOT NULL) = 2
  AND EXISTS (SELECT 1 FROM public.ownership_fold_flags WHERE reason = 'relist_same_seller' AND auction_event_id = pg_temp.u(3, 42)));
SELECT pg_temp.ok('V14: the winner listing the vehicle next, even unsold, confirms the sale',
  EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 14) AND owner_identity_id = pg_temp.u(2, 47) AND is_current AND sale_confirmation = 'confirmed_next_lot')
  AND (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 14) AND basis IS NOT NULL) = 2
  AND NOT EXISTS (SELECT 1 FROM public.ownership_fold_flags WHERE vehicle_id = pg_temp.u(1, 14)));
SELECT pg_temp.ok('V15: a relisted sale after an earlier effective sale: the earlier winner''s end is unknown, the relisting seller holds it now, each flagged with the other''s lot',
  EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 15) AND owner_identity_id = pg_temp.u(2, 49)
          AND end_unknown AND NOT is_current AND chain_flag = 'handover_unobserved' AND chain_peer_lot_id = pg_temp.u(3, 47))
  AND EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 15) AND owner_identity_id = pg_temp.u(2, 50)
              AND fold_key = 'held:' || pg_temp.u(3, 47) AND is_current AND start_unknown AND chain_flag = 'handover_unobserved' AND chain_peer_lot_id = pg_temp.u(3, 46))
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE owner_identity_id = pg_temp.u(2, 51))
  AND (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 15) AND is_current) = 1);
SELECT pg_temp.ok('V16: an unsold lot with no clock is listed, not used, and does not stop the vehicle folding',
  (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 16) AND basis IS NOT NULL) = 2
  AND EXISTS (SELECT 1 FROM public.ownership_fold_flags WHERE vehicle_id = pg_temp.u(1, 16) AND reason = 'unsold_lot_unordered'
              AND auction_event_id = pg_temp.u(3, 50) AND (detail ->> 'undated')::boolean));

-- V11 and the invariants over the whole table
SELECT pg_temp.ok('V11: a sold lot naming no party yields nothing',
  NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 11)));
SELECT pg_temp.ok('at most one open fold period per vehicle, and every fold row carries exactly one key',
  NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE basis IS NOT NULL AND is_current AND superseded_at IS NULL GROUP BY vehicle_id HAVING count(*) > 1)
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE num_nonnulls(owner_profile_id, owner_identity_id) <> 1));
SELECT pg_temp.fails('a fold row without its fold key is refused',
  format($s$INSERT INTO public.vehicle_ownerships (vehicle_id, owner_identity_id, basis) VALUES (%L, %L, 'auction_sale')$s$, pg_temp.u(1, 12), pg_temp.u(2, 1)));
SELECT pg_temp.fails('a row naming both a user and an identity is refused',
  format($s$INSERT INTO public.vehicle_ownerships (vehicle_id, owner_profile_id, owner_identity_id, basis, fold_key, fold_hash) VALUES (%L, %L, %L, 'auction_sale', 'x', 'x')$s$,
         pg_temp.u(1, 12), pg_temp.u(4, 1), pg_temp.u(2, 1)));

-- who can write a fold row
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
UPDATE public.vehicles SET uploaded_by = pg_temp.u(4, 1) WHERE id = pg_temp.u(1, 1);
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0004-000000000001';
SELECT pg_temp.fails('a signed-in uploader of the vehicle cannot insert a fold row',
  format($s$INSERT INTO public.vehicle_ownerships (vehicle_id, owner_identity_id, basis, fold_key, fold_hash, start_unknown, end_unknown, is_current)
            VALUES (%L, %L, 'auction_sale', 'acq:forged', 'x', true, false, false)$s$, pg_temp.u(1, 1), pg_temp.u(2, 1)));
CREATE TEMP TABLE _upd AS WITH u AS (UPDATE public.vehicle_ownerships SET authority_score = 100 WHERE vehicle_id = pg_temp.u(1, 1) RETURNING 1) SELECT count(*) AS n FROM u;
RESET ROLE;
SELECT pg_temp.ok('and cannot alter one',
  (SELECT n FROM _upd) = 0 AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE authority_score = 100));
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0004-000000000001';
INSERT INTO public.vehicle_ownerships (vehicle_id, owner_profile_id, role, is_current, ownership_type)
VALUES (pg_temp.u(1, 1), pg_temp.u(4, 1), 'owner', false, 'claimed_unverified');
RESET ROLE;
SELECT pg_temp.ok('the uploader still writes the user-keyed rows the policies always allowed',
  EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND owner_profile_id = pg_temp.u(4, 1)));
SELECT pg_temp.fails('anon and authenticated cannot run the writer',
  $s$SET ROLE authenticated; SELECT public.fold_vehicle_ownership_periods(NULL, 10, true)$s$);
RESET ROLE;

-- fold rows are private by default
CREATE TEMP TABLE _all_rows AS SELECT count(*) AS fold_rows, (SELECT count(*) FROM public.vehicle_ownerships WHERE owner_identity_id IS NULL) AS user_rows
  FROM public.vehicle_ownerships WHERE owner_identity_id IS NOT NULL;
GRANT SELECT ON _all_rows TO anon, authenticated;
SELECT pg_temp.ok('fold rows exist and so do user-keyed rows (the test below is not vacuous)',
  (SELECT fold_rows > 10 AND user_rows >= 3 FROM _all_rows));
SET ROLE anon;
CREATE TEMP TABLE _anon_seen AS SELECT count(*) FILTER (WHERE owner_identity_id IS NOT NULL OR basis IS NOT NULL) AS fold_seen,
  count(*) FILTER (WHERE owner_profile_id IS NOT NULL) AS user_seen FROM public.vehicle_ownerships;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0004-000000000001';
CREATE TEMP TABLE _auth_seen AS SELECT count(*) FILTER (WHERE owner_identity_id IS NOT NULL OR basis IS NOT NULL) AS fold_seen,
  count(*) FILTER (WHERE owner_profile_id IS NOT NULL) AS user_seen,
  count(*) FILTER (WHERE owner_identity_id IS NOT NULL AND vehicle_id = '00000000-0000-0000-0001-000000000001') AS own_vehicle_fold_seen FROM public.vehicle_ownerships;
RESET ROLE;
SELECT pg_temp.ok('anon reads no fold row and still reads the user-keyed rows of public vehicles',
  (SELECT fold_seen = 0 AND user_seen >= 3 FROM _anon_seen));
SELECT pg_temp.ok('a signed-in user reads no fold row, not even on a vehicle they uploaded, and still reads user-keyed rows',
  (SELECT fold_seen = 0 AND own_vehicle_fold_seen = 0 AND user_seen >= 3 FROM _auth_seen));
SELECT pg_temp.ok('the reader view, the flag table and the fold functions are not granted to anon or authenticated, and are to service_role',
  NOT has_table_privilege('anon', 'public.v_vehicle_owner_periods', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.v_vehicle_owner_periods', 'SELECT')
  AND has_table_privilege('service_role', 'public.v_vehicle_owner_periods', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.ownership_fold_flags', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.ownership_fold_flags', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.ownership_fold_flags', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.ownership_fold_flags', 'UPDATE')
  AND has_table_privilege('service_role', 'public.ownership_fold_flags', 'SELECT')
  AND NOT has_function_privilege('anon', 'public.fold_vehicle_ownership_periods(uuid,integer,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fold_vehicle_ownership_periods(uuid,integer,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.ownership_fold_plan(uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.ownership_fold_plan(uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.ownership_fold_party(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.ownership_fold_party(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.relabel_auction_transfers_recorded_unconfirmed(uuid,integer,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.relabel_auction_transfers_recorded_unconfirmed(uuid,integer,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.fold_vehicle_ownership_periods(uuid,integer,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.ownership_fold_plan(uuid[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.ownership_fold_party(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.relabel_auction_transfers_recorded_unconfirmed(uuid,integer,boolean)', 'EXECUTE'));
SELECT pg_temp.fails('anon cannot read the reader view', $s$SET ROLE anon; SELECT count(*) FROM public.v_vehicle_owner_periods$s$);
RESET ROLE;
SELECT pg_temp.fails('a signed-in user cannot read the reader view', $s$SET ROLE authenticated; SELECT count(*) FROM public.v_vehicle_owner_periods$s$);
RESET ROLE;
SELECT pg_temp.fails('anon cannot read the flag table', $s$SET ROLE anon; SELECT count(*) FROM public.ownership_fold_flags$s$);
RESET ROLE;
SELECT pg_temp.fails('a signed-in user cannot plan a fold', $s$SET ROLE authenticated; SELECT count(*) FROM public.ownership_fold_plan(ARRAY[gen_random_uuid()])$s$);
RESET ROLE;
DROP POLICY vehicle_ownerships_fold_rows_read_guard ON public.vehicle_ownerships;
SET ROLE anon;
CREATE TEMP TABLE _anon_open AS SELECT count(*) AS n FROM public.vehicle_ownerships WHERE owner_identity_id IS NOT NULL;
RESET ROLE;
SELECT pg_temp.ok('without the guard anon would read every live fold row of a public vehicle', (SELECT n > 10 FROM _anon_open));
\ir ../migrations/20261020330000_ownership_periods_fold.sql
SET ROLE anon;
SELECT pg_temp.ok('and re-applying the migration puts the guard back', (SELECT count(*) FROM public.vehicle_ownerships WHERE owner_identity_id IS NOT NULL) = 0);
RESET ROLE;

-- idempotence
CREATE TEMP TABLE _before AS SELECT id, fold_hash, superseded_at FROM public.vehicle_ownerships WHERE basis IS NOT NULL;
CREATE TEMP TABLE _flags_before AS SELECT id FROM public.ownership_fold_flags;
CREATE TEMP TABLE _rerun AS SELECT public.fold_vehicle_ownership_periods(NULL, 100, true) AS r;
SELECT pg_temp.ok('a re-run with the same inputs supersedes nothing and inserts nothing',
  (SELECT (r ->> 'would_insert')::int = 0 AND (r ->> 'would_supersede')::int = 0 AND (r ->> 'unchanged')::int = (r ->> 'periods')::int FROM _rerun)
  AND (SELECT count(*) FROM public.vehicle_ownerships WHERE basis IS NOT NULL) = (SELECT count(*) FROM _before)
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships v JOIN _before b USING (id) WHERE v.superseded_at IS DISTINCT FROM b.superseded_at)
  AND (SELECT count(*) FROM public.ownership_fold_flags) = (SELECT count(*) FROM _flags_before)
  AND NOT EXISTS (SELECT 1 FROM public.ownership_fold_flags WHERE resolved_at IS NOT NULL));

-- changed inputs: V1 gets a fourth lot (W4 sells to W8)
SELECT pg_temp.lot(30, 1, 'v1-d', 'sold', '2025-11-10 20:00+00', 4, 8);
CREATE TEMP TABLE _chg AS SELECT public.fold_vehicle_ownership_periods(NULL, 100, true) AS r;
SELECT pg_temp.ok('a new sold lot supersedes only the period it ends and adds the new winner',
  (SELECT (r ->> 'would_supersede')::int = 1 AND (r ->> 'would_insert')::int = 2 FROM _chg)
  AND (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND basis IS NOT NULL AND superseded_at IS NULL) = 5
  AND (SELECT owner_identity_id FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND is_current AND superseded_at IS NULL) = pg_temp.u(2, 8));
SELECT pg_temp.ok('the superseded period is kept, no longer current, points at its replacement, and says why',
  EXISTS (SELECT 1 FROM public.vehicle_ownerships o JOIN public.vehicle_ownerships n ON n.id = o.superseded_by
          WHERE o.vehicle_id = pg_temp.u(1, 1) AND o.owner_identity_id = pg_temp.u(2, 4) AND o.superseded_at IS NOT NULL
            AND NOT o.is_current AND o.end_at IS NULL AND o.superseded_reason = 'inputs_changed'
            AND n.superseded_at IS NULL AND n.end_at = '2025-11-10 20:00+00' AND n.fold_key = o.fold_key)
  AND (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND basis IS NOT NULL) = 6
  AND NOT EXISTS (SELECT 1 FROM _before b WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships v WHERE v.id = b.id)));
SELECT pg_temp.ok('the reader shows only the live periods, and one open period per vehicle remains',
  (SELECT count(*) FROM public.v_vehicle_owner_periods WHERE vehicle_id = pg_temp.u(1, 1)) = 6
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE basis IS NOT NULL AND is_current AND superseded_at IS NULL GROUP BY vehicle_id HAVING count(*) > 1));

-- a lot that stops being sold: its periods are superseded, nothing is deleted
UPDATE public.auction_events SET outcome = 'reserve_not_met' WHERE id = pg_temp.u(3, 30);
SELECT public.fold_vehicle_ownership_periods(NULL, 100, true);
SELECT pg_temp.ok('a lot that is no longer sold takes its periods back: the old rows are kept and the earlier winner is current again',
  (SELECT owner_identity_id FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND is_current AND superseded_at IS NULL) = pg_temp.u(2, 4)
  AND EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 1) AND owner_identity_id = pg_temp.u(2, 8)
              AND superseded_at IS NOT NULL AND superseded_reason = 'no_longer_derived' AND superseded_by IS NULL));

-- a flag that is no longer raised is resolved, not deleted
UPDATE public.auction_events SET outcome = 'no_sale' WHERE id = pg_temp.u(3, 10);
SELECT public.fold_vehicle_ownership_periods(NULL, 100, true);
SELECT pg_temp.ok('a flag no longer raised is resolved and kept',
  EXISTS (SELECT 1 FROM public.ownership_fold_flags WHERE vehicle_id = pg_temp.u(1, 4) AND reason = 'duplicate_lot' AND resolved_at IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.ownership_fold_flags WHERE vehicle_id = pg_temp.u(1, 4) AND resolved_at IS NULL));

-- the cursor pages through every vehicle and the pages add up to one run
CREATE TEMP TABLE _pages (r jsonb);
DO $$ DECLARE v_after uuid := NULL; v_r jsonb; BEGIN
  LOOP
    v_r := public.fold_vehicle_ownership_periods(v_after, 3, false);
    EXIT WHEN (v_r ->> 'done')::boolean;
    INSERT INTO _pages VALUES (v_r);
    v_after := (v_r ->> 'next_after')::uuid;
  END LOOP;
END $$;
SELECT pg_temp.ok('a dry run in pages of three covers every candidate vehicle once and its periods add up to the one-shot run',
  (SELECT sum((r ->> 'vehicles')::int) FROM _pages) = (SELECT (r ->> 'vehicles')::int FROM (SELECT public.fold_vehicle_ownership_periods(NULL, 100, false) AS r) x)
  AND (SELECT sum((r ->> 'periods')::int) FROM _pages) = (SELECT (r ->> 'periods')::int FROM (SELECT public.fold_vehicle_ownership_periods(NULL, 100, false) AS r) x)
  AND (SELECT count(*) FROM _pages) = 5);

-- the join point: a bridge between two handles of one party closes the chain
CREATE OR REPLACE FUNCTION public.ownership_fold_party(p_identity uuid) RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT CASE WHEN p_identity = '00000000-0000-0000-0002-000000000009'::uuid THEN '00000000-0000-0000-0002-000000000006'::uuid ELSE p_identity END $$;
CREATE TEMP TABLE _bridge AS SELECT public.fold_vehicle_ownership_periods(NULL, 100, true) AS r;
SELECT pg_temp.ok('when a bridge says handle 9 is handle 6, the gap closes: one period, no flag, and the old rows are kept',
  (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 2) AND basis IS NOT NULL AND superseded_at IS NULL) = 3
  AND EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 2) AND owner_identity_id = pg_temp.u(2, 6)
              AND superseded_at IS NULL AND end_at = '2024-09-10 20:00+00' AND NOT end_unknown AND chain_flag IS NULL)
  AND (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 2) AND basis IS NOT NULL AND superseded_at IS NOT NULL) >= 2);

-- ---------------------------------------------------------------------------------------------------------------------
-- transfers recorded from lots
INSERT INTO public.ownership_transfers (id, vehicle_id, trigger_table, status) VALUES
  (pg_temp.u(5, 1), pg_temp.u(1, 1), 'auction_events', 'in_progress'),   -- hammer only: relabelled
  (pg_temp.u(5, 2), pg_temp.u(1, 2), 'auction_events', 'in_progress'),   -- a deposit was observed: stays
  (pg_temp.u(5, 3), pg_temp.u(1, 3), 'auction_events', 'in_progress'),   -- a party was written to: stays
  (pg_temp.u(5, 4), pg_temp.u(1, 4), 'listing', 'in_progress'),          -- not seeded from a lot: stays
  (pg_temp.u(5, 5), pg_temp.u(1, 5), 'auction_events', 'completed'),     -- already closed: stays
  (pg_temp.u(5, 6), pg_temp.u(1, 6), 'auction_events', 'in_progress');   -- hammer only: relabelled
INSERT INTO public.ownership_transfers (id, vehicle_id, trigger_table, trigger_id, status) VALUES
  (pg_temp.u(5, 7), pg_temp.u(1, 12), 'auction_events', pg_temp.u(3, 40), 'in_progress'),  -- the seller relisted: held back
  (pg_temp.u(5, 8), pg_temp.u(1, 1), 'auction_events', pg_temp.u(3, 1), 'in_progress');    -- the winner listed it next: held back
INSERT INTO public.transfer_milestones (transfer_id, milestone_type, status)
SELECT t, m, CASE WHEN m = 'agreement_reached' THEN 'completed'::public.milestone_status ELSE 'pending' END
  FROM (VALUES (pg_temp.u(5, 7)), (pg_temp.u(5, 8))) t(t) CROSS JOIN (VALUES ('agreement_reached'), ('contact_exchanged')) m(m);
INSERT INTO public.transfer_milestones (transfer_id, milestone_type, status)
SELECT t, m, CASE WHEN m = 'agreement_reached' THEN 'completed'::public.milestone_status WHEN m = 'contact_exchanged' AND t = pg_temp.u(5, 6) THEN 'overdue' ELSE 'pending' END
  FROM (VALUES (pg_temp.u(5, 1)), (pg_temp.u(5, 2)), (pg_temp.u(5, 3)), (pg_temp.u(5, 4)), (pg_temp.u(5, 6))) t(t)
  CROSS JOIN (VALUES ('agreement_reached'), ('contact_exchanged'), ('deposit_sent'), ('title_received')) m(m);
UPDATE public.transfer_milestones SET status = 'completed' WHERE transfer_id = pg_temp.u(5, 2) AND milestone_type = 'deposit_sent';
INSERT INTO public.transfer_communications (transfer_id) VALUES (pg_temp.u(5, 3));

CREATE TEMP TABLE _rel_dry AS SELECT public.relabel_auction_transfers_recorded_unconfirmed(NULL, 100, false) AS r;
SELECT pg_temp.ok('the relabel dry run names the two transfers, holds back the relisted and the confirmed, and writes nothing',
  (SELECT (r ->> 'transfers')::int = 2 AND (r ->> 'milestones_closed')::int = 6
          AND (r ->> 'held_back_relisted')::int = 1 AND (r ->> 'held_back_confirmed')::int = 1 FROM _rel_dry)
  AND (SELECT count(*) FROM public.ownership_transfers WHERE status = 'in_progress') = 7);
SELECT public.relabel_auction_transfers_recorded_unconfirmed(NULL, 100, true);
SELECT pg_temp.ok('a transfer with only the hammer moves to recorded_unconfirmed; transfers with observed progress, a communication, another seed, a close, a relisted lot or a confirmed lot stay as they were',
  (SELECT array_agg(id ORDER BY id) FROM public.ownership_transfers WHERE status = 'recorded_unconfirmed') = ARRAY[pg_temp.u(5, 1), pg_temp.u(5, 6)]
  AND (SELECT status FROM public.ownership_transfers WHERE id = pg_temp.u(5, 2)) = 'in_progress'
  AND (SELECT status FROM public.ownership_transfers WHERE id = pg_temp.u(5, 3)) = 'in_progress'
  AND (SELECT status FROM public.ownership_transfers WHERE id = pg_temp.u(5, 4)) = 'in_progress'
  AND (SELECT status FROM public.ownership_transfers WHERE id = pg_temp.u(5, 5)) = 'completed'
  AND (SELECT status FROM public.ownership_transfers WHERE id = pg_temp.u(5, 7)) = 'in_progress'
  AND (SELECT status FROM public.ownership_transfers WHERE id = pg_temp.u(5, 8)) = 'in_progress');
SELECT pg_temp.ok('their open milestones are not_observable and the hammer stays completed; other transfers'' milestones are untouched',
  (SELECT count(*) FROM public.transfer_milestones WHERE transfer_id IN (pg_temp.u(5, 1), pg_temp.u(5, 6)) AND status = 'not_observable') = 6
  AND (SELECT count(*) FROM public.transfer_milestones WHERE transfer_id IN (pg_temp.u(5, 1), pg_temp.u(5, 6)) AND milestone_type = 'agreement_reached' AND status = 'completed') = 2
  AND (SELECT count(*) FROM public.transfer_milestones WHERE transfer_id = pg_temp.u(5, 2) AND status = 'not_observable') = 0
  AND (SELECT count(*) FROM public.transfer_milestones WHERE status = 'not_observable' AND notes LIKE '%cannot be observed%') = 6);
SELECT pg_temp.ok('a second relabel run finds nothing to do',
  (SELECT (public.relabel_auction_transfers_recorded_unconfirmed(NULL, 100, true) ->> 'transfers')::int = 0));
SELECT pg_temp.fails('anon cannot run the relabel',
  $s$SET ROLE anon; SELECT public.relabel_auction_transfers_recorded_unconfirmed(NULL, 10, true)$s$);
RESET ROLE;
