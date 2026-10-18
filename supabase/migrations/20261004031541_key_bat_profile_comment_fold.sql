-- C6: attach the existing BaT profile fold to its platform-qualified identity.
-- Live PG17.6, 2026-10-04 03:15Z: bat_user_profiles has no FK; an indexed
-- 1,000-profile username sample resolves 883 exact (platform='bat',handle)
-- identities and leaves 117 unobserved. All newest 1,000 comments are BaT and
-- have identity keys. The live trigger nevertheless accepts every platform,
-- misses the first bid, and overwrites last_seen with late-arriving event time.
-- Extend the existing INSERT fold; no new log, identity minting, schedule or
-- historical testimony/profile DML. Existing search-identities consumes this
-- UUID, with an explicit exact-BaT-handle fallback for unlinked older profiles.
-- Existing counters retain their historical defects until a separately assayed
-- replay. This cumulative current-state fold is not a historical as-of feature.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.bat_user_profiles ADD COLUMN external_identity_id uuid;
ALTER TABLE public.bat_user_profiles
  ADD CONSTRAINT bat_user_profiles_external_identity_id_fkey
  FOREIGN KEY (external_identity_id) REFERENCES public.external_identities(id)
  ON DELETE RESTRICT NOT VALID;

-- Initially empty because every historical profile has a NULL key. This scans
-- the profile heap once without constructing a 690K-entry index. Bounds above
-- abort the atomic migration rather than waiting behind hot comment ingestion.
CREATE UNIQUE INDEX idx_bat_user_profiles_external_identity
  ON public.bat_user_profiles (external_identity_id)
  WHERE external_identity_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_user_profile_from_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_identity_id uuid;
  v_bid_count integer;
BEGIN
  -- Same identifiable-author rule as the canonical BaT comment writer. A
  -- matching string on another platform is a different identity, and unknown
  -- source authors never become a shared synthetic participant.
  IF NEW.platform IS DISTINCT FROM 'bat'
     OR NEW.author_username IS NULL
     OR btrim(NEW.author_username) = ''
     OR NEW.author_username = 'Unknown'
     OR (lower(NEW.author_username) = 'anonymous'
         AND COALESCE(NEW.bat_author_id, 0) <= 0) THEN
    RETURN NEW;
  END IF;

  -- Unique (platform,handle) index, exact source spelling; no fuzzy match or
  -- author-supplied UUID trust. NULL means the canonical identity is unobserved.
  SELECT id INTO v_identity_id
  FROM public.external_identities
  WHERE platform = 'bat' AND handle = NEW.author_username;
  v_bid_count := CASE WHEN NEW.comment_type = 'bid' THEN 1 ELSE 0 END;

  INSERT INTO public.bat_user_profiles AS profile
    (username, external_identity_id, total_comments, total_bids,
     first_seen, last_seen, updated_at)
  VALUES
    (NEW.author_username, v_identity_id, 1, v_bid_count,
     NEW.posted_at, NEW.posted_at, now())
  ON CONFLICT (username) DO UPDATE SET
    external_identity_id = EXCLUDED.external_identity_id,
    total_comments = COALESCE(profile.total_comments, 0) + 1,
    total_bids = COALESCE(profile.total_bids, 0) + v_bid_count,
    first_seen = LEAST(profile.first_seen, EXCLUDED.first_seen),
    last_seen = GREATEST(profile.last_seen, EXCLUDED.last_seen),
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.bat_user_profiles.username IS
  'Grain: one cumulative BaT account profile per exact published author_username. Platform is BaT, not a person or cross-platform handle. Source: auction_comments.platform=bat.';
COMMENT ON COLUMN public.bat_user_profiles.external_identity_id IS
  'Derived identity edge, at most one BaT profile per canonical external identity; current INSERT fold resolves exact external_identities(platform=bat,handle=username). NULL means unresolved or not yet replayed. Historical profiles are not backfilled here.';
COMMENT ON COLUMN public.bat_user_profiles.total_comments IS
  'Count of accepted BaT comment INSERTs folded for this handle; source-key conflicts do not fire the INSERT trigger. Cumulative current state, not an as-of feature; historical counts are unrepaired.';
COMMENT ON COLUMN public.bat_user_profiles.total_bids IS
  'Count of BaT comments with comment_type=bid folded for this handle, including a first bid after this migration. Cumulative current state; historical first-bid omissions are unrepaired.';
COMMENT ON COLUMN public.bat_user_profiles.first_seen IS
  'Earliest observed event time, UTC timestamptz, from auction_comments.posted_at accepted by this fold. Late arrivals can move it earlier. NULL means event time unobserved; historical minima are unrepaired.';
COMMENT ON COLUMN public.bat_user_profiles.last_seen IS
  'Latest observed event time, UTC timestamptz, from auction_comments.posted_at accepted by this fold. Late arrivals cannot move it earlier. Historical clock regressions are unrepaired.';
COMMENT ON COLUMN public.bat_user_profiles.updated_at IS
  'Current-state refresh transaction time, UTC timestamptz. Not event time, source publication time, or a historical prediction cutoff; profiles are cumulative lifetime state.';
COMMENT ON CONSTRAINT bat_user_profiles_external_identity_id_fkey
  ON public.bat_user_profiles IS
  'C6: canonical profile identity edge. New non-NULL keys enforced immediately; historical validation intentionally deferred to a bounded follow-up. Existing RLS/grants unchanged.';
COMMENT ON FUNCTION public.update_user_profile_from_comment() IS
  'Canonical incremental BaT profile fold after a unique comment INSERT. Exact platform-qualified identity lookup; no identity minting. Preserves testimony; replay conflicts do not increment. Maintains event-time bounds and ingest/refresh time separately.';

INSERT INTO public.pipeline_registry
  (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES
  ('bat_user_profiles', 'external_identity_id', 'update_user_profile_from_comment',
   'Exact BaT profile-to-canonical-identity edge, NULL when unobserved; filled by the existing comment INSERT fold. No historical backfill.',
   true, 'auction_comments INSERT -> update_user_profile_from_comment')
ON CONFLICT (table_name, column_name) DO NOTHING;

COMMIT;
