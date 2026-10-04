-- Disposable PG17 only:
-- psql -X -v ON_ERROR_STOP=1 -d dm_refinement_bat_profile -f this-file.sql
-- The stubs retain the live fields used by the unchanged trigger attachment.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.auction_comments') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable PG17 dm_refinement_* database';
  END IF;
END $$;

CREATE TABLE public.external_identities (
  id uuid PRIMARY KEY, platform text NOT NULL, handle text NOT NULL,
  metadata jsonb DEFAULT '{}', UNIQUE (platform, handle)
);
CREATE TABLE public.bat_user_profiles (
  username text PRIMARY KEY, total_comments integer DEFAULT 0,
  total_bids integer DEFAULT 0, total_wins integer DEFAULT 0,
  expertise_score numeric DEFAULT 0, community_trust_score numeric DEFAULT 0,
  first_seen timestamptz, last_seen timestamptz, updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.auction_comments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_key text UNIQUE NOT NULL, platform text, author_username text,
  external_identity_id uuid REFERENCES public.external_identities(id),
  bat_author_id bigint, comment_type text, posted_at timestamptz,
  created_at timestamptz DEFAULT now(), comment_text text
);
CREATE TABLE public.pipeline_registry (
  table_name text, column_name text, owned_by text, description text,
  do_not_write_directly boolean, write_via text, UNIQUE (table_name, column_name)
);
-- Live attachment remains unchanged by the migration.
CREATE FUNCTION public.update_user_profile_from_comment() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trigger_update_user_profile AFTER INSERT ON public.auction_comments
FOR EACH ROW EXECUTE FUNCTION public.update_user_profile_from_comment();

INSERT INTO public.external_identities (id, platform, handle, metadata) VALUES
 ('00000000-0000-0000-0000-000000000001', 'bat', 'shared', '{"keep":"source"}'),
 ('00000000-0000-0000-0000-000000000002', 'carsandbids', 'shared', '{}'),
 ('00000000-0000-0000-0000-000000000003', 'bat', 'legacy', '{}'),
 ('00000000-0000-0000-0000-000000000004', 'bat', 'Anonymous', '{}'),
 ('00000000-0000-0000-0000-000000000005', 'bat', 'legacy_null_counters', '{}');
INSERT INTO public.bat_user_profiles (username, total_comments, total_bids, total_wins)
VALUES ('legacy', 9, 2, 7), ('legacy_null_counters', NULL, NULL, 8);

\ir ../migrations/20261004031541_key_bat_profile_comment_fold.sql

BEGIN;
-- No backfill, new FK enforced immediately, unique identity index installed.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.bat_user_profiles WHERE external_identity_id IS NOT NULL)
     OR (SELECT convalidated FROM pg_constraint
       WHERE conname='bat_user_profiles_external_identity_id_fkey')
     OR NOT EXISTS (SELECT 1 FROM pg_index
       WHERE indexrelid='public.idx_bat_user_profiles_external_identity'::regclass AND indisunique) THEN
    RAISE EXCEPTION 'Historical state or identity-edge schema differs from contract';
  END IF;
  BEGIN
    UPDATE public.bat_user_profiles SET external_identity_id='ffffffff-ffff-ffff-ffff-ffffffffffff'
      WHERE username='legacy';
    RAISE EXCEPTION 'NOT VALID FK failed to enforce a new key';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

-- A first bid counts once and initializes both event-time bounds. A wrong
-- supplied source UUID cannot trick the exact platform-qualified resolver.
INSERT INTO public.auction_comments
 (source_key,platform,author_username,external_identity_id,comment_type,posted_at,comment_text)
VALUES ('first','bat','shared','00000000-0000-0000-0000-000000000002',
        'bid','2026-10-03T12:00:00Z','source testimony stays unchanged');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bat_user_profiles WHERE username='shared'
       AND total_comments=1 AND total_bids=1
       AND first_seen='2026-10-03T12:00:00Z' AND last_seen=first_seen
       AND external_identity_id='00000000-0000-0000-0000-000000000001')
     OR (SELECT external_identity_id FROM public.auction_comments WHERE source_key='first')
       <> '00000000-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION 'First event count, exact identity, clocks or source preservation failed';
  END IF;
END $$;

-- Replay conflicts produce no new INSERT and no extra profile increments.
INSERT INTO public.auction_comments
 (source_key,platform,author_username,comment_type,posted_at,comment_text)
VALUES ('first','bat','shared','bid','2026-10-04T12:00:00Z','replacement attempt')
ON CONFLICT (source_key) DO NOTHING;
DO $$ BEGIN
  IF (SELECT total_comments FROM public.bat_user_profiles WHERE username='shared') <> 1
     OR (SELECT comment_text FROM public.auction_comments WHERE source_key='first')
       <> 'source testimony stays unchanged' THEN
    RAISE EXCEPTION 'Replay changed counts or source testimony';
  END IF;
END $$;

-- Late arrival widens the earlier bound, newer event widens the later one,
-- and unknown time does not fabricate an event time from ingest time.
INSERT INTO public.auction_comments
 (source_key,platform,author_username,comment_type,posted_at) VALUES
 ('late','bat','shared','observation','2026-10-02T12:00:00Z'),
 ('newer','bat','shared','bid','2026-10-03T13:00:00Z'),
 ('unknown-time','bat','shared','observation',NULL),
 ('other-platform','carsandbids','shared','bid','2026-10-05T12:00:00Z'),
 ('null-platform',NULL,'shared','bid','2026-10-05T12:00:00Z'),
 ('null-handle','bat',NULL,'bid','2026-10-05T12:00:00Z'),
 ('blank-handle','bat','   ','bid','2026-10-05T12:00:00Z'),
 ('unknown-handle','bat','Unknown','bid','2026-10-05T12:00:00Z'),
 ('anonymous-handle','bat','Anonymous','bid','2026-10-05T12:00:00Z'),
 ('unresolved','bat','unresolved','bid','2026-10-05T12:00:00Z'),
 ('same-case-only','bat','Shared','bid','2026-10-05T12:00:00Z'),
 ('legacy-null','bat','legacy_null_counters','bid','2026-10-05T12:00:00Z');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bat_user_profiles WHERE username='shared'
       AND total_comments=4 AND total_bids=2
       AND first_seen='2026-10-02T12:00:00Z' AND last_seen='2026-10-03T13:00:00Z')
     OR EXISTS (SELECT 1 FROM public.bat_user_profiles WHERE username IN ('   ','Unknown','Anonymous'))
     OR NOT EXISTS (SELECT 1 FROM public.bat_user_profiles WHERE username='unresolved'
       AND external_identity_id IS NULL AND total_comments=1 AND total_bids=1)
     OR NOT EXISTS (SELECT 1 FROM public.bat_user_profiles WHERE username='Shared'
       AND external_identity_id IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.bat_user_profiles WHERE username='legacy_null_counters'
       AND total_comments=1 AND total_bids=1 AND total_wins=8
       AND external_identity_id='00000000-0000-0000-0000-000000000005') THEN
    RAISE EXCEPTION 'Platform/author isolation, null handling, counters or clock bounds failed';
  END IF;
END $$;

-- Explicit source author id makes BaT's Anonymous account distinguishable.
INSERT INTO public.auction_comments
 (source_key,platform,author_username,bat_author_id,comment_type,posted_at)
VALUES ('known-anonymous','bat','Anonymous',123,'bid','2026-10-03T12:00:00Z');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bat_user_profiles WHERE username='Anonymous'
       AND total_comments=1 AND external_identity_id='00000000-0000-0000-0000-000000000004')
     OR (SELECT metadata->>'keep' FROM public.external_identities
       WHERE id='00000000-0000-0000-0000-000000000001') <> 'source' THEN
    RAISE EXCEPTION 'Identifiable anonymous or preserved identity metadata failed';
  END IF;
END $$;

-- Reader contract: keyed UUID first; historical fallback only for NULL-keyed
-- exact BaT handles. The same handle on C&B receives no BaT profile.
DO $$ DECLARE v_rows integer; BEGIN
  SELECT count(*) INTO v_rows FROM public.external_identities e
  JOIN public.bat_user_profiles p ON e.platform='bat' AND
    (p.external_identity_id=e.id OR
     (p.external_identity_id IS NULL AND p.username=e.handle))
  WHERE e.handle IN ('shared','legacy');
  IF v_rows <> 2 THEN RAISE EXCEPTION 'Keyed/historical reader contract failed'; END IF;
END $$;

-- Mixed replay batch counts only newly inserted source keys.
INSERT INTO public.auction_comments
 (source_key,platform,author_username,comment_type,posted_at)
SELECT CASE WHEN i=0 THEN 'first' ELSE 'batch-'||i END,'bat','shared','bid',NULL
FROM generate_series(0,100) i ON CONFLICT (source_key) DO NOTHING;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bat_user_profiles WHERE username='shared'
       AND total_comments=104 AND total_bids=102
       AND first_seen='2026-10-02T12:00:00Z' AND last_seen='2026-10-03T13:00:00Z') THEN
    RAISE EXCEPTION 'Mixed batch replay or clock preservation failed';
  END IF;
END $$;
ROLLBACK;
SELECT 'PASS: exact identity, first bid, replay, late clocks, platform/author isolation and reader contract' AS result;
