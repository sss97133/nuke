-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_identity_bridge -f this-file.sql
-- Contract for 20261020340000_identity_equivalence_bridge.sql. Synthetic rows and names only; never production.
--   * the migration applies twice;
--   * a break between a sold lot's winner and the next lot's seller is explained by a keyed fact (one organization's
--     monitors, one user's approved claims) and only by that, else it reads 'unexplained'; similar handles, a case-folded
--     monitor handle and pending claims are not evidence;
--   * a seller listing again is reported as its own state; a same-or-earlier end date is a data error, not a break;
--     lot rows repeating one slug fold into one; a missing end date is taken from vehicle_events;
--   * the writer is idempotent and its dry run writes nothing; a superseded row stops explaining;
--   * identity_equivalences is append-only (update, delete, truncate refused; superseding a row once is the one change);
--   * anon and authenticated read and run nothing; service_role reads and runs.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.external_identities') IS NOT NULL THEN
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
CREATE FUNCTION pg_temp.fails(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS % (%)', label, SQLERRM; RETURN; END;
  RAISE EXCEPTION 'Contract failed: % (statement succeeded)', label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(text, boolean), pg_temp.fails(text, text) TO anon, authenticated, service_role;

-- the reads, with the columns the migration uses and their live types (2026-10-20)
CREATE TABLE public.external_identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text NOT NULL,
  handle text NOT NULL, claimed_by_user_id uuid, UNIQUE (platform, handle));
CREATE TABLE public.account_link_claims (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, platform text,
  handle text, external_identity_id uuid, status text, reviewed_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.bat_seller_monitors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
  seller_username text, created_at timestamptz DEFAULT now());
CREATE TABLE public.bat_buyer_monitors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
  buyer_username text, created_at timestamptz DEFAULT now());
CREATE TABLE public.auction_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source text,
  source_url text, auction_end_date timestamptz, outcome text, winning_bidder_external_identity_id uuid,
  seller_external_identity_id uuid);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_platform text, source_url text,
  ended_at timestamptz, sold_at timestamptz);

\ir ../migrations/20261020340000_identity_equivalence_bridge.sql
\ir ../migrations/20261020340000_identity_equivalence_bridge.sql

-- identities (synthetic handles)
INSERT INTO public.external_identities (id, platform, handle) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'bat', 'synth_dealer_sell'),   -- seller handle of organization O
  ('00000000-0000-0000-0000-0000000000a2', 'bat', 'synth_dealer_buy'),    -- buyer handle of organization O
  ('00000000-0000-0000-0000-0000000000b1', 'bat', 'synth_person_one'),    -- approved for user U
  ('00000000-0000-0000-0000-0000000000b2', 'bat', 'synth_person_two'),    -- approved for user U
  ('00000000-0000-0000-0000-0000000000c1', 'bat', 'acme_synth'),          -- similar to c2, pending claims only
  ('00000000-0000-0000-0000-0000000000c2', 'bat', 'AcmeSynth'),
  ('00000000-0000-0000-0000-0000000000d1', 'bat', 'synth_relister'),
  ('00000000-0000-0000-0000-0000000000d2', 'bat', 'synth_buyer_gone'),
  ('00000000-0000-0000-0000-0000000000e1', 'bat', 'synth_other_seller'),
  ('00000000-0000-0000-0000-0000000000e2', 'bat', 'synth_other_buyer'),
  ('00000000-0000-0000-0000-0000000000f1', 'bat', 'zetacars'),            -- the monitor spells it differently
  ('00000000-0000-0000-0000-0000000000f2', 'bat', 'synth_zeta_buyer');
INSERT INTO public.bat_seller_monitors (organization_id, seller_username, created_at) VALUES
  ('00000000-0000-0000-0000-00000000aa01', 'synth_dealer_sell', '2026-01-01'),
  ('00000000-0000-0000-0000-00000000aa02', 'ZetaCars', '2026-01-01'),
  ('00000000-0000-0000-0000-00000000aa03', 'synth_unknown_handle', '2026-01-01');
INSERT INTO public.bat_buyer_monitors (organization_id, buyer_username, created_at) VALUES
  ('00000000-0000-0000-0000-00000000aa01', 'synth_dealer_buy', '2026-02-01'),
  ('00000000-0000-0000-0000-00000000aa02', 'synth_zeta_buyer', '2026-02-01'),
  (NULL, 'synth_person_one', '2026-02-01');
INSERT INTO public.account_link_claims (user_id, platform, handle, external_identity_id, status, reviewed_at) VALUES
  ('00000000-0000-0000-0000-00000000bb01', 'bat', 'synth_person_one', '00000000-0000-0000-0000-0000000000b1', 'approved', '2026-03-01'),
  ('00000000-0000-0000-0000-00000000bb01', 'bat', 'synth_person_two', '00000000-0000-0000-0000-0000000000b2', 'approved', '2026-04-01'),
  ('00000000-0000-0000-0000-00000000bb02', 'bat', 'acme_synth', '00000000-0000-0000-0000-0000000000c1', 'pending', NULL),
  ('00000000-0000-0000-0000-00000000bb02', 'bat', 'AcmeSynth', '00000000-0000-0000-0000-0000000000c2', 'pending', NULL);

-- vehicles. 1: monitor organization (break explained, then continuity, then an unexplained break). 2: approved claims.
-- 3: similar handles, no evidence. 4: same end date and a repeated lot slug. 5: the seller lists again.
-- 6: missing end date. 7: case-folded monitor handle. 8: previous lot not sold.
CREATE FUNCTION pg_temp.lot(veh int, slug text, ended timestamptz, outcome text, win text, sel text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.auction_events (vehicle_id, source, source_url, auction_end_date, outcome,
                                     winning_bidder_external_identity_id, seller_external_identity_id)
  VALUES (('90000000-0000-0000-0000-00000000000' || veh)::uuid, 'bat', 'https://bringatrailer.com/listing/' || slug || '/',
          ended, outcome, ('00000000-0000-0000-0000-0000000000' || win)::uuid,
          ('00000000-0000-0000-0000-0000000000' || sel)::uuid)
$$;
CREATE FUNCTION pg_temp.chain(veh int) RETURNS TABLE (seq integer, link text, evidence_kind text, same_lot_rows integer,
  ended_at_source text) LANGUAGE sql AS $$
  SELECT c.seq, c.link, c.evidence_kind, c.same_lot_rows, c.ended_at_source
    FROM public.vehicle_lot_chain(('90000000-0000-0000-0000-00000000000' || veh)::uuid) c ORDER BY c.seq $$;
CREATE FUNCTION pg_temp.links(veh int) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(link || coalesce(':' || evidence_kind, ''), ' > ' ORDER BY seq) FROM pg_temp.chain(veh) $$;

SELECT pg_temp.lot(1, 'v1-a', '2025-01-10', 'sold', 'a2', 'e1');   -- won under the dealer's buyer handle
SELECT pg_temp.lot(1, 'v1-b', '2025-03-01', 'sold', 'e2', 'a1');   -- sold under the dealer's seller handle
SELECT pg_temp.lot(1, 'v1-c', '2025-05-01', 'sold', 'e1', 'e2');   -- the winner sells: continuity
SELECT pg_temp.lot(1, 'v1-d', '2025-07-01', 'sold', 'e2', 'f2');   -- e1 won, f2 sells: nothing says they are one
SELECT pg_temp.lot(2, 'v2-a', '2025-01-10', 'sold', 'b1', 'e1');
SELECT pg_temp.lot(2, 'v2-b', '2025-04-10', 'sold', 'e1', 'b2');
SELECT pg_temp.lot(3, 'v3-a', '2025-01-10', 'sold', 'c1', 'e1');
SELECT pg_temp.lot(3, 'v3-b', '2025-04-10', 'sold', 'e1', 'c2');
SELECT pg_temp.lot(4, 'v4-a', '2025-01-10', 'sold', 'e2', 'e1');
SELECT pg_temp.lot(4, 'v4-a', '2025-01-10', 'sold', 'e2', 'e1');   -- the same lot captured twice
SELECT pg_temp.lot(4, 'v4-b', '2025-01-10', 'sold', 'e1', 'e2');   -- same end date as the lot before: a data error
SELECT pg_temp.lot(5, 'v5-a', '2025-01-10', 'sold', 'd2', 'd1');
SELECT pg_temp.lot(5, 'v5-b', '2025-06-10', 'sold', 'e2', 'd1');   -- the previous lot's seller lists it again
SELECT pg_temp.lot(6, 'v6-a', '2025-01-10', 'sold', 'e2', 'e1');
SELECT pg_temp.lot(6, 'v6-b', NULL, 'sold', 'e1', 'e2');           -- no end date; vehicle_events has one: continuity
INSERT INTO public.vehicle_events (source_platform, source_url, ended_at)
VALUES ('bat', 'https://bringatrailer.com/listing/v6-b/', '2025-02-01');
SELECT pg_temp.lot(7, 'v7-a', '2025-01-10', 'sold', 'f2', 'e1');
SELECT pg_temp.lot(7, 'v7-b', '2025-04-10', 'sold', 'e1', 'f1');   -- f1 is spelled in another case on the monitor
SELECT pg_temp.lot(8, 'v8-a', '2025-01-10', 'reserve_not_met', NULL, 'e1');
SELECT pg_temp.lot(8, 'v8-b', '2025-04-10', 'sold', 'e2', 'e2');

-- 1. before anything is recorded, every break is unexplained: nothing is guessed
SELECT pg_temp.ok('no evidence recorded: the dealer pair and the claimed pair read unexplained, not linked',
  pg_temp.links(1) = 'first > break:unexplained > continuity > break:unexplained'
  AND pg_temp.links(2) = 'first > break:unexplained' AND pg_temp.links(3) = 'first > break:unexplained');

-- 2. the writer: the dry run counts and writes nothing
SELECT pg_temp.ok('the dry run counts one monitor pair and one claimed pair and writes nothing',
  (SELECT r = '{"dry_run": true, "inserted": 0, "claimed_user_pairs": 1, "not_yet_recorded": 2, "monitor_organization_pairs": 1}'::jsonb
     FROM (SELECT public.record_identity_equivalences() r) q)
  AND (SELECT count(*) FROM public.identity_equivalences) = 0);
SELECT pg_temp.ok('a case-folded monitor handle, a null-organization monitor and pending claims make no pair',
  NOT EXISTS (SELECT 1 FROM public.identity_equivalence_candidates() c
               WHERE c.identity_a IN ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2',
                                      '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2')
                  OR c.identity_b IN ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2',
                                      '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2')));
CREATE TEMP TABLE first_write AS SELECT public.record_identity_equivalences(false) AS r;
SELECT pg_temp.ok('the write inserts two rows, in canonical pair order, with checkable evidence',
  (SELECT (r ->> 'inserted')::int = 2 FROM first_write)
  AND (SELECT count(*) FROM public.identity_equivalences WHERE identity_a < identity_b AND relation = 'same_party') = 2
  AND (SELECT evidence_ref_id = '00000000-0000-0000-0000-00000000aa01' AND evidence_ref_table = 'organizations'
            AND observed_at = '2026-02-01' AND asserted_by = 'record_identity_equivalences'
            AND jsonb_array_length(evidence_detail -> 'monitors') = 2
        FROM public.identity_equivalences WHERE evidence_kind = 'monitor_organization')
  AND (SELECT evidence_ref_id = '00000000-0000-0000-0000-00000000bb01' AND evidence_ref_table = 'users'
            AND observed_at = '2026-04-01' AND jsonb_array_length(evidence_detail -> 'claims') = 2
        FROM public.identity_equivalences WHERE evidence_kind = 'claimed_user'));
CREATE TEMP TABLE second_write AS SELECT public.record_identity_equivalences(false) AS r;
CREATE TEMP TABLE dry_after AS SELECT public.record_identity_equivalences() AS r;
SELECT pg_temp.ok('a second write inserts nothing, and the dry run then finds nothing left to record',
  (SELECT (r ->> 'inserted')::int = 0 FROM second_write)
  AND (SELECT (r ->> 'not_yet_recorded')::int = 0 FROM dry_after)
  AND (SELECT count(*) FROM public.identity_equivalences) = 2);

-- 3. the chain
SELECT pg_temp.ok('a break between a winner and a later seller on one organization is explained by monitor_organization',
  pg_temp.links(1) = 'first > break:monitor_organization > continuity > break:unexplained');
SELECT pg_temp.ok('a break between two identities approved for one user is explained by claimed_user',
  pg_temp.links(2) = 'first > break:claimed_user');
SELECT pg_temp.ok('similar handles with only pending claims stay unexplained', pg_temp.links(3) = 'first > break:unexplained');
SELECT pg_temp.ok('a same end date is a data error, and a lot captured twice folds into one row',
  pg_temp.links(4) = 'first > date_error' AND (SELECT max(same_lot_rows) FROM pg_temp.chain(4)) = 2 AND (SELECT count(*) FROM pg_temp.chain(4)) = 2);
SELECT pg_temp.ok('the previous lot''s seller listing again is its own state, not a bridge and not a guess',
  pg_temp.links(5) = 'first > relist_same_seller:same_seller_relist');
SELECT pg_temp.ok('a missing end date is read from vehicle_events and the chain orders by it',
  pg_temp.links(6) = 'first > continuity' AND (SELECT ended_at_source FROM pg_temp.chain(6) WHERE seq = 2) = 'vehicle_events');
SELECT pg_temp.ok('a monitor handle spelled in another case does not bridge', pg_temp.links(7) = 'first > break:unexplained');
SELECT pg_temp.ok('a lot after one that did not sell is not a break', pg_temp.links(8) = 'first > prev_not_sold');
SELECT pg_temp.ok('a vehicle with no lots has an empty chain',
  NOT EXISTS (SELECT 1 FROM public.vehicle_lot_chain('90000000-0000-0000-0000-000000000099')));

-- 4. rules of the table; supersession is the one change, once
INSERT INTO public.identity_equivalences (identity_a, identity_b, evidence_kind, evidence_ref_table, evidence_ref_id,
                                          observed_at, asserted_by)
VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'buyer_comment', 'auction_comments',
        gen_random_uuid(), '2026-05-01', 'test');
SELECT pg_temp.fails('the pair must be in canonical order',
  $s$INSERT INTO public.identity_equivalences (identity_a, identity_b, evidence_kind, evidence_ref_table, evidence_ref_id,
       observed_at, asserted_by)
     VALUES ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'lot_text_purchase',
             'auction_events', gen_random_uuid(), '2026-05-01', 'test')$s$);
SELECT pg_temp.fails('an evidence kind outside the declared set is refused',
  $s$INSERT INTO public.identity_equivalences (identity_a, identity_b, evidence_kind, evidence_ref_table, evidence_ref_id,
       observed_at, asserted_by)
     VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'similar_handle',
             'auction_events', gen_random_uuid(), '2026-05-01', 'test')$s$);
SELECT pg_temp.fails('a row with no asserting writer is refused',
  $s$INSERT INTO public.identity_equivalences (identity_a, identity_b, evidence_kind, evidence_ref_table, evidence_ref_id,
       observed_at, asserted_by)
     VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'lot_text_purchase',
             'auction_events', gen_random_uuid(), '2026-05-01', ' ')$s$);
SELECT pg_temp.fails('a second row for the same pair and kind is refused',
  $s$INSERT INTO public.identity_equivalences (identity_a, identity_b, evidence_kind, evidence_ref_table, evidence_ref_id,
       observed_at, asserted_by)
     VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'buyer_comment',
             'auction_comments', gen_random_uuid(), '2026-05-02', 'test')$s$);
SELECT pg_temp.fails('an update of an evidence field is refused',
  $s$UPDATE public.identity_equivalences SET evidence_kind = 'claimed_user' WHERE evidence_kind = 'buyer_comment'$s$);
SELECT pg_temp.fails('an update of the pair is refused',
  $s$UPDATE public.identity_equivalences SET identity_a = identity_b WHERE evidence_kind = 'claimed_user'$s$);
SELECT pg_temp.fails('a delete is refused', $s$DELETE FROM public.identity_equivalences$s$);
SELECT pg_temp.fails('a truncate is refused', $s$TRUNCATE public.identity_equivalences$s$);
SELECT pg_temp.fails('a row cannot be superseded by itself',
  $s$UPDATE public.identity_equivalences SET superseded_by = id WHERE evidence_kind = 'buyer_comment'$s$);
SELECT pg_temp.fails('a row cannot be superseded by a row of another pair',
  $s$UPDATE public.identity_equivalences
        SET superseded_by = (SELECT id FROM public.identity_equivalences WHERE evidence_kind = 'claimed_user')
      WHERE evidence_kind = 'buyer_comment'$s$);
UPDATE public.identity_equivalences
   SET superseded_by = (SELECT id FROM public.identity_equivalences WHERE evidence_kind = 'monitor_organization')
 WHERE evidence_kind = 'buyer_comment';
SELECT pg_temp.ok('a row can be superseded by a row for the same pair',
  (SELECT superseded_by IS NOT NULL FROM public.identity_equivalences WHERE evidence_kind = 'buyer_comment')
  AND pg_temp.links(1) = 'first > break:monitor_organization > continuity > break:unexplained');
SELECT pg_temp.fails('a superseded row cannot be superseded again',
  $s$UPDATE public.identity_equivalences
        SET superseded_by = (SELECT id FROM public.identity_equivalences WHERE evidence_kind = 'monitor_organization')
      WHERE evidence_kind = 'buyer_comment'$s$);
-- a superseded row stops explaining: the claimed row is replaced by a text row, and the chain reads the live one
INSERT INTO public.identity_equivalences (identity_a, identity_b, evidence_kind, evidence_ref_table, evidence_ref_id,
                                          observed_at, asserted_by)
SELECT identity_a, identity_b, 'lot_text_purchase', 'auction_events', gen_random_uuid(), '2026-06-01', 'test'
  FROM public.identity_equivalences WHERE evidence_kind = 'claimed_user';
UPDATE public.identity_equivalences
   SET superseded_by = (SELECT id FROM public.identity_equivalences WHERE evidence_kind = 'lot_text_purchase')
 WHERE evidence_kind = 'claimed_user';
SELECT pg_temp.ok('once the claimed row is superseded, the pair reads by the live text row',
  pg_temp.links(2) = 'first > break:lot_text_purchase');

-- 5. privacy: the pairing of handles is private
SET ROLE anon;
SELECT pg_temp.fails('anon cannot read the table', $s$SELECT count(*) FROM public.identity_equivalences$s$);
SELECT pg_temp.fails('anon cannot run the chain', $s$SELECT * FROM public.vehicle_lot_chain('90000000-0000-0000-0000-000000000001')$s$);
SELECT pg_temp.fails('anon cannot run the writer', $s$SELECT public.record_identity_equivalences()$s$);
SELECT pg_temp.fails('anon cannot insert',
  $s$INSERT INTO public.identity_equivalences (identity_a, identity_b, evidence_kind, evidence_ref_table, evidence_ref_id,
       observed_at, asserted_by)
     VALUES (gen_random_uuid(), gen_random_uuid(), 'claimed_user', 'users', gen_random_uuid(), now(), 'anon')$s$);
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.fails('authenticated cannot read the table', $s$SELECT count(*) FROM public.identity_equivalences$s$);
SELECT pg_temp.fails('authenticated cannot run the chain', $s$SELECT * FROM public.vehicle_lot_chain('90000000-0000-0000-0000-000000000001')$s$);
SELECT pg_temp.fails('authenticated cannot read the candidates', $s$SELECT * FROM public.identity_equivalence_candidates()$s$);
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.ok('service_role reads the table and the chain',
  (SELECT count(*) FROM public.identity_equivalences) = 4
  AND (SELECT count(*) FROM public.vehicle_lot_chain('90000000-0000-0000-0000-000000000001')) = 4);
SELECT pg_temp.ok('service_role runs the writer as a dry run', (public.record_identity_equivalences() ->> 'dry_run')::boolean);
SELECT pg_temp.fails('service_role cannot edit rows', $s$UPDATE public.identity_equivalences SET asserted_by = 'x'$s$);
SELECT pg_temp.fails('service_role cannot insert directly, only through the writer',
  $s$INSERT INTO public.identity_equivalences (identity_a, identity_b, evidence_kind, evidence_ref_table, evidence_ref_id,
       observed_at, asserted_by)
     VALUES (gen_random_uuid(), gen_random_uuid(), 'claimed_user', 'users', gen_random_uuid(), now(), 'x')$s$);
RESET ROLE;
SELECT pg_temp.ok('the table has RLS on and no policy for anon or authenticated',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.identity_equivalences'::regclass)
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'identity_equivalences' AND NOT ('service_role' = ANY (roles))));
SELECT pg_temp.ok('no view reads the table',
  NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
               WHERE d.refobjid = 'public.identity_equivalences'::regclass AND d.classid = 'pg_rewrite'::regclass));
