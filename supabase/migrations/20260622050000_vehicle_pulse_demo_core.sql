-- 20260622050000_vehicle_pulse_demo_core.sql
-- Applied to prod 2026-06-22. This is the DEPLOYED DEMO-SAFE CORE of the vehicle_pulse
-- live-signal system: the canonical one-row-per-vehicle pulse table, the arbiter that
-- recomputes a row from vehicle_events, the read accessor, RLS mirroring vehicles
-- visibility, and the realtime publication add (so the iOS living header can subscribe).
--
-- DELIBERATELY OMITTED here vs the full spec at 20260622000000_vehicle_pulse_arbiter.sql:
--   * NO trigger on vehicle_events (hot write-path — deferred to go-live)
--   * NO trigger on bid_events
--   * NO pg_cron schedule
-- The full verified arbiter (with those hot-path hooks) lives in 20260622000000 and is
-- NOT deployed. This file mirrors exactly what IS live. Idempotent (IF NOT EXISTS /
-- CREATE OR REPLACE / guarded policy + publication adds).
--
-- New table justification (platform-hygiene): vehicle_pulse is the single canonical
-- live-signal row per vehicle — the arbitrated projection of the latest auction/listing
-- event into a render-ready shape (mode, headline, liveness, urgency cadence, monotonic
-- live_bid). It exists so realtime subscribers read one stable row instead of re-deriving
-- from the vehicle_events hot path on every tick.

-- ── Table ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_pulse (
  vehicle_id       uuid        NOT NULL,
  mode             text        NOT NULL DEFAULT 'dormant'::text,
  headline_kind    text,
  headline_label   text,
  headline_amount  numeric,
  is_live          boolean     NOT NULL DEFAULT false,
  live_state       text        NOT NULL DEFAULT 'dormant'::text,
  liveness         numeric     NOT NULL DEFAULT 0,
  urgency_pulse_ms integer,
  ends_at          timestamptz,
  live_bid         numeric,
  bid_count        integer     NOT NULL DEFAULT 0,
  source_platform  text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_pulse_pkey PRIMARY KEY (vehicle_id),
  CONSTRAINT vehicle_pulse_vehicle_id_fkey FOREIGN KEY (vehicle_id)
    REFERENCES public.vehicles(id) ON DELETE CASCADE
);

-- ── Arbiter (demo-safe: callable, but NOT wired to any hot-path trigger/cron) ─
CREATE OR REPLACE FUNCTION public.arbitrate_vehicle_pulse(p_vehicle_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; v_now timestamptz := now(); v_secs numeric; v_live boolean;
begin
  if p_vehicle_id is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('vehicle_pulse:' || p_vehicle_id::text));
  select ve.* into r from public.vehicle_events ve
   where ve.vehicle_id = p_vehicle_id and ve.event_type in ('auction','listing')
   order by (ve.event_status in ('active','live','bid-goes-on')) desc,
            coalesce(ve.ended_at, ve.sold_at, ve.created_at) desc
   limit 1;
  if r.id is null then return; end if;

  v_live := (r.event_status in ('active','live','bid-goes-on')
             and coalesce(r.ended_at, r.sold_at) >= v_now - interval '2 seconds');
  v_secs := greatest(1, extract(epoch from (coalesce(r.ended_at, r.sold_at) - v_now)));

  insert into public.vehicle_pulse as vp (
    vehicle_id, mode, headline_kind, headline_label, headline_amount,
    is_live, live_state, liveness, urgency_pulse_ms, ends_at, live_bid, bid_count, source_platform, updated_at)
  values (
    p_vehicle_id,
    case when v_live then 'auction_live' when r.event_status='sold' then 'sold'
         when r.event_type='listing' then 'listed' else 'sold' end,
    case when v_live then 'live_bid' when r.event_status='sold' then 'sale' else 'asking' end,
    case when v_live then 'Current Bid' when r.event_status='sold' then 'Sold' else 'Asking' end,
    coalesce(r.current_price, r.final_price, r.buy_now_price, r.starting_price),
    v_live,
    case when v_live then 'live' else 'ended' end,
    case when v_live then least(greatest(1 - ln(v_secs)/ln(86400), 0.30), 1.0) else 0 end,
    case when not v_live then null when v_secs<=30 then 500 when v_secs<=300 then 900
         when v_secs<=3600 then 1600 when v_secs<=86400 then 2800 else 4200 end,
    coalesce(r.ended_at, r.sold_at),
    case when v_live then r.current_price end,
    coalesce(r.bid_count, 0),
    r.source_platform,
    v_now)
  on conflict (vehicle_id) do update set
    mode=excluded.mode, headline_kind=excluded.headline_kind, headline_label=excluded.headline_label,
    headline_amount=excluded.headline_amount, is_live=excluded.is_live, live_state=excluded.live_state,
    liveness=excluded.liveness, urgency_pulse_ms=excluded.urgency_pulse_ms, ends_at=excluded.ends_at,
    live_bid=greatest(coalesce(vp.live_bid,0), coalesce(excluded.live_bid,0)),   -- monotonic
    bid_count=greatest(vp.bid_count, excluded.bid_count),
    source_platform=excluded.source_platform, updated_at=now();
end; $function$;

-- ── Read accessor ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_vehicle_pulse(p_vehicle_id uuid)
 RETURNS public.vehicle_pulse
 LANGUAGE sql
 STABLE
AS $function$
  select * from public.vehicle_pulse where vehicle_id = p_vehicle_id;
$function$;

-- ── RLS (mirrors vehicles visibility: public OR owner) ───────────────────────
ALTER TABLE public.vehicle_pulse ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_pulse_read ON public.vehicle_pulse;
CREATE POLICY vehicle_pulse_read ON public.vehicle_pulse
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id = vehicle_pulse.vehicle_id
      AND (v.is_public = true OR v.user_id = auth.uid() OR v.owner_id = auth.uid())
  ));

-- ── Realtime publication (so the iOS living header can subscribe) ─────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'vehicle_pulse'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_pulse;
  END IF;
END $$;
