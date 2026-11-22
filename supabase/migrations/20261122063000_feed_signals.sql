-- Explore feed interaction signals: what each signed-in user saw, how long, how deep they swiped, what they opened,
-- what they asked for more or less of, and their Browse tuning changes. The iOS app (ExploreSignals.swift) queues these
-- on the phone and uploads batches through record_feed_signals. Owner approved 2026-11-21 22:24 PST (from draft #3699).
--
-- Why not user_interactions: it holds follow/view toggles behind record_interaction (live 2026-11-21: of its last 1,000
-- rows, 997 were web hover "view"s and 1 a follow), it has no idempotency key, so a retried upload would double-count.
--
-- Grain: one row per client event, keyed (user_id, id) so a retried batch is a no-op. Append-only: no UPDATE/DELETE
-- policy. Never carries seller or bidder names: the event shape has no free-text field except the filter names in tuned.
-- Idempotent: safe to replay.

CREATE TABLE IF NOT EXISTS public.feed_signals (
  id           uuid        NOT NULL,                       -- client event id (idempotency)
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id   uuid,
  at           timestamptz NOT NULL,                       -- when it happened on the phone
  received_at  timestamptz NOT NULL DEFAULT now(),         -- when Nuke learned it
  surface      text        NOT NULL DEFAULT 'explore_browse',
  item_id      text        NOT NULL CHECK (length(item_id) <= 120),   -- "ask:<id>" | "live:<id>" | "browse-tuning"
  vehicle_id   uuid,
  source       text        CHECK (length(source) <= 80),
  kind         text        NOT NULL CHECK (kind IN ('impression','dwell','page','photo','open_listing','open_profile',
                                                    'press','choice','follow','share','comment_open','tune')),
  page_kind    text        CHECK (page_kind IN ('photos','location','analytics','listing')),
  page_index   smallint    CHECK (page_index BETWEEN 0 AND 100),
  photo_index  smallint    CHECK (photo_index BETWEEN 0 AND 1000),
  dwell_ms     integer     CHECK (dwell_ms BETWEEN 0 AND 3600000),
  choice       text        CHECK (choice IN ('more','less','hide')),
  position     integer     CHECK (position BETWEEN 0 AND 100000),
  tuned        text        CHECK (tuned ~ '^[a-z,]{0,80}$'),     -- kind tune: names of the filters changed, never values
  client       text        NOT NULL DEFAULT 'ios',
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS feed_signals_user_at ON public.feed_signals (user_id, at DESC);
CREATE INDEX IF NOT EXISTS feed_signals_vehicle_kind ON public.feed_signals (vehicle_id, kind) WHERE vehicle_id IS NOT NULL;

ALTER TABLE public.feed_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feed_signals_read_own ON public.feed_signals;
CREATE POLICY feed_signals_read_own ON public.feed_signals
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS feed_signals_insert_own ON public.feed_signals;
CREATE POLICY feed_signals_insert_own ON public.feed_signals
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
-- No UPDATE or DELETE policy: append-only.

REVOKE ALL ON public.feed_signals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.feed_signals TO authenticated;

-- The phone's writer: a JSON array of at most 200 events, stamped with the caller, repeats ignored.
-- Answers {"ok":true,"accepted":n,"received":m}, or {"ok":false,"error":...} (the batch is refused whole and the
-- phone keeps it). SECURITY INVOKER: the insert policy above is what admits the rows.
CREATE OR REPLACE FUNCTION public.record_feed_signals(p_events jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_n int; v_ok int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'auth_required'); END IF;
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_an_array');
  END IF;
  v_n := jsonb_array_length(p_events);
  IF v_n > 200 THEN RETURN jsonb_build_object('ok', false, 'error', 'too_many', 'max', 200); END IF;

  INSERT INTO public.feed_signals (id, user_id, session_id, at, item_id, vehicle_id, source, kind, page_kind,
                                   page_index, photo_index, dwell_ms, choice, position, tuned)
  SELECT (e->>'id')::uuid, v_uid, nullif(e->>'session_id','')::uuid,
         least((e->>'at')::timestamptz, now() + interval '5 minutes'),
         e->>'item_id', nullif(e->>'vehicle_id','')::uuid, e->>'source', e->>'kind', e->>'page_kind',
         (e->>'page_index')::smallint, (e->>'photo_index')::smallint, (e->>'dwell_ms')::int, e->>'choice',
         (e->>'position')::int, e->>'tuned'
    FROM jsonb_array_elements(p_events) e
  ON CONFLICT (user_id, id) DO NOTHING;
  GET DIAGNOSTICS v_ok = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'accepted', v_ok, 'received', v_n);
EXCEPTION WHEN invalid_text_representation OR check_violation OR not_null_violation OR datetime_field_overflow
               OR numeric_value_out_of_range OR invalid_datetime_format THEN
  RETURN jsonb_build_object('ok', false, 'error', 'invalid_event', 'detail', SQLERRM);
END;
$fn$;

REVOKE ALL ON FUNCTION public.record_feed_signals(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_feed_signals(jsonb) TO authenticated;

COMMENT ON TABLE public.feed_signals IS
  'Explore feed interaction signals (impressions, dwell, swipe depth, opens, more/less/hide, tuning), one row per client event, append-only, owner-only. Written by record_feed_signals from the iOS app.';
COMMENT ON FUNCTION public.record_feed_signals(jsonb) IS
  'Appends up to 200 Explore feed events for the caller (auth.uid()); repeats by event id are ignored. {"ok":bool,...}.';
