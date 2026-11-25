-- Disposable PG17: 20261125084210. auction_events is built with every live column, NOT NULL, default, CHECK and its
-- primary key (read 2026-11-25, 87 columns) and carries all 13 live triggers, created with their live definitions in
-- live name order. The 8 other trigger functions are their live bodies (pg_get_functiondef, read 2026-11-25), with
-- the functions and tables they call stubbed to record each call; the deployed close_deal_on_sale body
-- (20261116063200) and the live transfer trigger body (20261016170000) are loaded from their migrations, with pg_net
-- stubbed to record each request. Covers: the deployed
-- body refuses a sold row; the fix closes an open consignment deal at the row's price and end date; no current-date or
-- high-bid guess (an unknown price or end date skips the deal with a deal_close_skips row; the final bid counts only
-- where auction_source_price_rules says it is the hammer); an older sale never closes a newer deal; every transfer
-- seeded while platform_config transfer_notifications is off, landing over an hour late, or with no end date is
-- suppressed; every NEW.<column> any of the 10 trigger functions reads exists on the table; the closure is keyed to its
-- event, which alone may correct it with an equal or better price class; the triggers after close_deal_on_sale run. Synthetic rows only.
-- guardrail-allow(center-key-fk): auction_events: disposable fixture mirroring the live columns; no vehicles table here
-- guardrail-allow(center-key-fk): deal_jackets: disposable fixture with the live columns the trigger reads; no vehicles table here
-- guardrail-allow(center-key-fk): vehicle_observations: disposable stub of a table a live trigger function writes; synthetic rows only
-- guardrail-allow(center-key-fk): auction_event_duplicate_mark: disposable stub of a table a live trigger function writes; synthetic rows only
-- guardrail-allow(center-key-fk): vehicle_listing_photo_summary_queue: disposable stub of a table a live trigger function writes; synthetic rows only
-- guardrail-allow(center-key-fk): external_auction_bids: disposable stub of a table a live trigger function writes; synthetic rows only
-- guardrail-allow(center-key-fk): model_fold_signal: disposable stub of a table a live trigger function writes; synthetic rows only
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.auction_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TYPE public.price_basis_t AS ENUM ('hammer', 'gross_incl_premium', 'net_to_owner', 'unknown');
CREATE TABLE public.auction_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  source text NOT NULL,
  source_url text,
  source_listing_id text,
  lot_number text,
  auction_start_date timestamp with time zone,
  auction_end_date timestamp with time zone,
  auction_duration_hours integer,
  outcome text NOT NULL,
  starting_bid numeric,
  reserve_price numeric,
  reserve_disclosed boolean DEFAULT false,
  high_bid numeric,
  winning_bid numeric,
  buy_it_now_price numeric,
  total_bids integer,
  unique_bidders integer,
  bid_history jsonb,
  high_bidder text,
  winning_bidder text,
  seller_name text,
  seller_type text,
  seller_location text,
  estimate_low numeric,
  estimate_high numeric,
  page_views integer,
  watchers integer,
  comments_count integer,
  market_insights jsonb,
  price_vs_estimate_pct numeric,
  reserve_gap_pct numeric,
  scraped_at timestamp with time zone DEFAULT now(),
  raw_data jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  receipt_data jsonb,
  ai_summary text,
  sentiment_arc jsonb,
  key_moments jsonb,
  top_contributors jsonb,
  broadcast_video_id text,
  broadcast_video_url text,
  broadcast_timestamp_start integer,
  broadcast_timestamp_end integer,
  broadcast_clip_url text,
  forensics_data jsonb,
  merged_from_vehicle_id uuid,
  winning_bidder_external_identity_id uuid,
  seller_external_identity_id uuid,
  broadcast_publisher_organization_id uuid,
  broadcast_evidence_state jsonb,
  broadcast_evidence_last_observation_id uuid,
  broadcast_evidence_dirty boolean NOT NULL DEFAULT false,
  currency_code text,
  currency_source text,
  price_basis price_basis_t,
  hammer_price numeric,
  hammer_price_source text,
  hammer_price_confidence text,
  buyer_premium_amount numeric,
  buyer_premium_rate numeric,
  buyer_premium_source text,
  buyer_premium_confidence text,
  gross_price numeric,
  gross_price_source text,
  gross_price_confidence text,
  seller_fee_amount numeric,
  seller_fee_source text,
  seller_fee_confidence text,
  net_to_owner numeric,
  net_to_owner_source text,
  net_to_owner_confidence text,
  price_basis_run_id text,
  fx_to_usd numeric,
  fx_to_usd_source text,
  price_basis_conflict boolean,
  price_kind text,
  price_kind_source text,
  lot_category text,
  lot_category_source text,
  sale_type text,
  sale_type_source text,
  charity_lot boolean,
  charity_lot_source text,
  canonical_listing_url text,
  duplicate_of uuid,
  CONSTRAINT auction_events_pkey PRIMARY KEY (id),
  CONSTRAINT auction_events_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
  CONSTRAINT auction_events_lot_category_check CHECK ((lot_category = ANY (ARRAY['car'::text, 'motorcycle'::text, 'minibike'::text, 'parts'::text, 'wheels'::text, 'atv'::text, 'go_kart'::text, 'tractor'::text, 'automobilia'::text, 'other'::text]))),
  CONSTRAINT auction_events_outcome_check CHECK ((outcome = ANY (ARRAY['sold'::text, 'reserve_not_met'::text, 'no_sale'::text, 'bid_to'::text, 'cancelled'::text, 'relisted'::text, 'pending'::text, 'live'::text]))),
  CONSTRAINT auction_events_preview_lot_sold_needs_price CHECK ((NOT ((outcome = 'sold'::text) AND (source_url ~* '/auction/[0-9]+/preview-lot/'::text) AND (COALESCE(winning_bid, (0)::numeric) < (100)::numeric)))),
  CONSTRAINT auction_events_price_kind_check CHECK ((price_kind = ANY (ARRAY['sale'::text, 'high_bid_unsold'::text, 'estimate'::text, 'unknown'::text]))),
  CONSTRAINT auction_events_sale_type_check CHECK ((sale_type = ANY (ARRAY['live'::text, 'online'::text, 'unknown'::text])))
);
SELECT count(*) = 87 AS all_live_columns FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auction_events' \gset
\if :all_live_columns
\else
  \echo 'FAIL: auction_events fixture is not the 87 live columns'
  SELECT 1/0;
\endif
CREATE TABLE public.deal_jackets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, deal_type text, sold_date date,
  sale_price_inc_doc numeric, updated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now());
CREATE TABLE public.deal_jacket_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deal_jacket_id uuid, role text, threshold_amount numeric,
  split_pct numeric, flat_fee numeric, commission_pct numeric, actual_amount numeric, actual_currency text);
CREATE TABLE public.platform_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_key text UNIQUE, config_value jsonb, description text,
  updated_at timestamptz DEFAULT now(), updated_by uuid);
CREATE FUNCTION public.assert_count(got int, want int, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL: % (% of %)', msg, got, want; END IF; END $$;
-- pg_net and the cron key, stubbed: each request is recorded.
CREATE SCHEMA net;
CREATE TABLE net.sent (id bigserial PRIMARY KEY, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000)
RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.sent (url, body) VALUES (url, body) RETURNING id $$;
CREATE FUNCTION public.get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$ SELECT 'test-key' $$;

-- What the other trigger functions call, stubbed: each call is logged.
CREATE TABLE public.trigger_calls (id bigserial PRIMARY KEY, fn text, arg text);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, make text, model text, vin text, year int);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid, extraction_method text);
CREATE TABLE public.auction_event_duplicate_mark (id bigserial PRIMARY KEY, event_id uuid, duplicate_of uuid, vehicle_id uuid,
  source text, canonical_listing_url text, run_id text, marked_at timestamptz DEFAULT now(), retired_at timestamptz,
  retired_reason text, retired_run_id text);
CREATE TABLE public.vehicle_listing_photo_summary_queue (vehicle_id uuid PRIMARY KEY, run_id text);
CREATE TABLE public.external_auction_bids (id bigserial PRIMARY KEY, auction_event_id uuid, vehicle_id uuid, updated_at timestamptz);
CREATE TABLE public.model_fold_signal (id bigserial PRIMARY KEY, vehicle_id uuid, reason text, origin_id uuid, priority smallint);
CREATE FUNCTION public.canonical_listing_url(u text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(rtrim(u, '/')) $$;
CREATE FUNCTION public.model_fold_config() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.model_fold_signals_on() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.model_fold_signal_priority(p_id uuid, p_make text, p_model text, p_vin text, p_year integer, p_max integer)
RETURNS smallint LANGUAGE sql AS $$ SELECT 1::smallint $$;
CREATE FUNCTION public.model_fold_signal_ids(p_ids uuid[], p_reason text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO public.trigger_calls (fn, arg) VALUES ('model_fold_signal_ids', p_reason) $$;
CREATE FUNCTION public.project_bat_result_to_vehicle(p_event_id uuid, p_apply boolean, p_asserted_by text) RETURNS jsonb LANGUAGE sql AS
$$ INSERT INTO public.trigger_calls (fn, arg) VALUES ('project_bat_result_to_vehicle', p_event_id::text) RETURNING '{}'::jsonb $$;
CREATE FUNCTION public.resolve_auction_event_identities(p_lot_id uuid, p_source text, p_winning_bidder text, p_winning_bid numeric,
  p_seller_name text, OUT winning_bidder_identity_id uuid, OUT winning_bidder_verdict text, OUT seller_identity_id uuid,
  OUT seller_verdict text) RETURNS record LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.trigger_calls (fn, arg) VALUES ('resolve_auction_event_identities', p_lot_id::text);
  winning_bidder_identity_id := NULL; seller_identity_id := NULL;
END $$;

-- The 8 other trigger functions on auction_events, live bodies (pg_get_functiondef, read 2026-11-25).
CREATE OR REPLACE FUNCTION public.auction_events_canonical_url_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_dup uuid;
begin
  NEW.canonical_listing_url := canonical_listing_url(NEW.source_url);
  if TG_OP = 'INSERT' and NEW.duplicate_of is null and NEW.vehicle_id is not null and NEW.canonical_listing_url is not null then
    select a.id into v_dup from auction_events a
     where a.vehicle_id = NEW.vehicle_id and a.duplicate_of is null and a.id <> NEW.id
       and canonical_listing_url(a.source_url) = NEW.canonical_listing_url
     order by a.created_at, a.id limit 1;
    if v_dup is not null then
      NEW.duplicate_of := v_dup;
      insert into auction_event_duplicate_mark (event_id, duplicate_of, vehicle_id, source, canonical_listing_url, run_id)
      values (NEW.id, v_dup, NEW.vehicle_id, NEW.source, NEW.canonical_listing_url, 'insert_trigger_v1');
    end if;
  end if;
  return NEW;
end $function$
;

CREATE OR REPLACE FUNCTION public.enqueue_listing_photo_summary_move()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
  select x.id, 'listing_photo_summary_trigger' from (values (OLD.vehicle_id), (NEW.vehicle_id)) x(id) where x.id is not null
  on conflict (vehicle_id) do nothing;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.enqueue_listing_photo_summary_rows()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if TG_OP in ('INSERT','UPDATE') then
    insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
    select distinct vehicle_id, 'listing_photo_summary_trigger' from new_rows where vehicle_id is not null
    on conflict (vehicle_id) do nothing;
  end if;
  if TG_OP in ('DELETE','UPDATE') then
    insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
    select distinct vehicle_id, 'listing_photo_summary_trigger' from old_rows where vehicle_id is not null
    on conflict (vehicle_id) do nothing;
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.external_auction_bids_follow_lot_vehicle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE external_auction_bids SET vehicle_id = NEW.vehicle_id, updated_at = now()
  WHERE auction_event_id = NEW.id AND vehicle_id IS DISTINCT FROM NEW.vehicle_id;
  RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.key_auction_event_identities_on_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_wb text;
  v_sn text;
  r record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- A key follows its text: when the text changed and this statement did not set the key, derive it again.
    IF NEW.winning_bidder IS DISTINCT FROM OLD.winning_bidder
       AND NEW.winning_bidder_external_identity_id IS NOT DISTINCT FROM OLD.winning_bidder_external_identity_id THEN
      NEW.winning_bidder_external_identity_id := NULL;
    END IF;
    IF NEW.seller_name IS DISTINCT FROM OLD.seller_name
       AND NEW.seller_external_identity_id IS NOT DISTINCT FROM OLD.seller_external_identity_id THEN
      NEW.seller_external_identity_id := NULL;
    END IF;
  END IF;

  -- Only a NULL key is filled; a key the writer passed, or one already set for an unchanged text, is kept.
  IF NEW.winning_bidder_external_identity_id IS NULL THEN v_wb := NEW.winning_bidder; END IF;
  IF NEW.seller_external_identity_id IS NULL THEN v_sn := NEW.seller_name; END IF;
  IF v_wb IS NOT NULL OR v_sn IS NOT NULL THEN
    SELECT * INTO r FROM public.resolve_auction_event_identities(NEW.id, NEW.source, v_wb, NEW.winning_bid, v_sn);
    IF v_wb IS NOT NULL THEN NEW.winning_bidder_external_identity_id := r.winning_bidder_identity_id; END IF;
    IF v_sn IS NOT NULL THEN NEW.seller_external_identity_id := r.seller_identity_id; END IF;
  END IF;
  RETURN NEW;
END
$function$
;

CREATE OR REPLACE FUNCTION public.model_fold_rows_signal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ids uuid[];
begin
  begin
    -- model_fold_signal_tiers_v1: no early return; model_fold_signal_ids stamps facet folds whether signals are on
    -- and checks signals_on itself before it inserts.
    -- Static SQL per branch: a branch is planned only when it runs, so new_rows/old_rows exist whenever referenced.
    if tg_op = 'INSERT' then
      select array_agg(distinct n.vehicle_id) into v_ids from new_rows n where n.vehicle_id is not null;
    elsif tg_op = 'DELETE' then
      select array_agg(distinct o.vehicle_id) into v_ids from old_rows o where o.vehicle_id is not null;
    elsif tg_table_name = 'auction_comments' then
      select array_agg(distinct x) into v_ids from (
        select unnest(array[o.vehicle_id, n.vehicle_id]) x from old_rows o join new_rows n on n.id = o.id
         where o.vehicle_id is distinct from n.vehicle_id or o.comment_text is distinct from n.comment_text
            or o.comment_type is distinct from n.comment_type or o.has_question is distinct from n.has_question) z
       where x is not null;
      -- An edited comment's readings carry no match text, so the fold needs to know which comments changed.
      if public.model_fold_signals_on() then
      insert into public.model_fold_signal (vehicle_id, reason, origin_id, priority) /* model_fold_signal_tiers_v1 */
      select n.vehicle_id, 'auction_comment_edit', n.id, p.pr
        from old_rows o join new_rows n on n.id = o.id join public.vehicles v on v.id = n.vehicle_id
        cross join lateral (select public.model_fold_signal_priority(v.id, v.make, v.model, v.vin, v.year,
          coalesce((public.model_fold_config() ->> 'signal_tiers_max')::int, 1)) as pr) p
       where o.comment_text is distinct from n.comment_text
         and p.pr is not null;
      end if;
    else
      select array_agg(distinct x) into v_ids from (
        select unnest(array[o.vehicle_id, n.vehicle_id]) x from old_rows o join new_rows n on n.id = o.id
         where o.vehicle_id is distinct from n.vehicle_id) z where x is not null;
    end if;
    perform public.model_fold_signal_ids(v_ids, tg_table_name || '_' || lower(tg_op));
  exception when others then
    raise warning 'model_fold signal skipped (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.preserve_bat_live_projection()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE old_data jsonb; new_data jsonb; old_live jsonb; new_live jsonb; old_at timestamptz; new_at timestamptz;
BEGIN
  old_data:=CASE WHEN TG_TABLE_NAME='vehicle_events' THEN to_jsonb(OLD)->'metadata' ELSE to_jsonb(OLD)->'raw_data' END;
  new_data:=CASE WHEN TG_TABLE_NAME='vehicle_events' THEN to_jsonb(NEW)->'metadata' ELSE to_jsonb(NEW)->'raw_data' END;
  old_live:=old_data->'live_stream'; new_live:=new_data->'live_stream';
  IF old_live IS NULL THEN RETURN NEW; END IF;
  -- Organization/image metadata maintenance does not rewrite an auction fact.
  IF old_live IS NOT DISTINCT FROM new_live AND
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(OLD)) WHERE key IN
      ('event_status','ended_at','sold_at','current_price','final_price','bid_count','view_count','watcher_count',
       'outcome','auction_end_date','high_bid','winning_bid','winning_bidder','total_bids','comments_count','page_views','watchers'))
    IS NOT DISTINCT FROM
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(NEW)) WHERE key IN
      ('event_status','ended_at','sold_at','current_price','final_price','bid_count','view_count','watcher_count',
       'outcome','auction_end_date','high_bid','winning_bid','winning_bidder','total_bids','comments_count','page_views','watchers'))
    THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.vehicle_observations o WHERE o.id=coalesce(new_live->>'last_observation_id',new_live->>'observation_id')::uuid
      AND o.vehicle_id=NEW.vehicle_id AND o.extraction_method='bat_public_live_v1'
      AND o.xmin=(pg_current_xact_id()::text::bigint % 4294967296)::text::xid) THEN RETURN NEW; END IF;
  old_at:=coalesce(old_live->>'last_frame_received_at',old_live->>'received_at')::timestamptz;
  new_at:=(new_data#>>'{source_read,at}')::timestamptz;
  IF new_at IS NULL OR (old_at IS NOT NULL AND new_at<=old_at) THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME='vehicle_events' THEN NEW.metadata:=NEW.metadata||jsonb_build_object('live_stream',old_live);
  ELSE NEW.raw_data:=NEW.raw_data||jsonb_build_object('live_stream',old_live); END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_project_bat_result_to_vehicle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  BEGIN
    PERFORM project_bat_result_to_vehicle(NEW.id, true, 'trg_project_bat_result_to_vehicle');
  EXCEPTION WHEN OTHERS THEN
    -- the result row stands whatever happens to its projection; the lag query finds a lot this missed
    RAISE WARNING 'project_bat_result_to_vehicle(%) failed: % (%)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$function$
;

-- The deployed bodies of the two this migration changes, from their migrations.
\set deployed_close `sed -n '/^CREATE OR REPLACE FUNCTION close_deal_on_sale()/,/^\$\$;/p' supabase/migrations/20261116063200_deal_jacket_parties_functions.sql`
\set deployed_transfer `sed -n '/^CREATE OR REPLACE FUNCTION public.auto_create_transfer_on_auction_close()/,/^\$function\$;/p' supabase/migrations/20261016170000_transfer_seed_recent_sales_only.sql`
:deployed_close
:deployed_transfer

-- All 13 live triggers, live definitions (pg_get_triggerdef, read 2026-11-25).
CREATE TRIGGER model_fold_signal_ins AFTER INSERT ON public.auction_events REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION model_fold_rows_signal();
CREATE TRIGGER model_fold_signal_upd AFTER UPDATE ON public.auction_events REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION model_fold_rows_signal();
CREATE TRIGGER preserve_bat_live_projection BEFORE UPDATE ON public.auction_events FOR EACH ROW EXECUTE FUNCTION preserve_bat_live_projection();
CREATE TRIGGER trg_auction_events_canonical_url BEFORE INSERT OR UPDATE OF source_url ON public.auction_events FOR EACH ROW EXECUTE FUNCTION auction_events_canonical_url_trg();
CREATE TRIGGER trg_auto_create_transfer_on_auction_close AFTER INSERT OR UPDATE OF outcome ON public.auction_events FOR EACH ROW EXECUTE FUNCTION auto_create_transfer_on_auction_close();
CREATE TRIGGER trg_close_deal_on_sale AFTER INSERT OR UPDATE ON public.auction_events FOR EACH ROW EXECUTE FUNCTION close_deal_on_sale();
CREATE TRIGGER trg_external_auction_bids_follow_lot_vehicle AFTER UPDATE OF vehicle_id ON public.auction_events FOR EACH ROW WHEN ((old.vehicle_id IS DISTINCT FROM new.vehicle_id)) EXECUTE FUNCTION external_auction_bids_follow_lot_vehicle();
CREATE TRIGGER trg_key_auction_event_identities_ins BEFORE INSERT ON public.auction_events FOR EACH ROW WHEN (((new.source = ANY (ARRAY['bat'::text, 'bringatrailer'::text])) AND (((new.winning_bidder IS NOT NULL) AND (new.winning_bidder_external_identity_id IS NULL)) OR ((new.seller_name IS NOT NULL) AND (new.seller_external_identity_id IS NULL))))) EXECUTE FUNCTION key_auction_event_identities_on_write();
CREATE TRIGGER trg_key_auction_event_identities_upd BEFORE UPDATE OF winning_bidder, seller_name ON public.auction_events FOR EACH ROW WHEN (((new.source = ANY (ARRAY['bat'::text, 'bringatrailer'::text])) AND ((new.winning_bidder IS DISTINCT FROM old.winning_bidder) OR (new.seller_name IS DISTINCT FROM old.seller_name) OR ((new.winning_bidder IS NOT NULL) AND (new.winning_bidder_external_identity_id IS NULL)) OR ((new.seller_name IS NOT NULL) AND (new.seller_external_identity_id IS NULL))))) EXECUTE FUNCTION key_auction_event_identities_on_write();
CREATE TRIGGER trg_listing_photo_summary_delete AFTER DELETE ON public.auction_events REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION enqueue_listing_photo_summary_rows();
CREATE TRIGGER trg_listing_photo_summary_insert AFTER INSERT ON public.auction_events REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION enqueue_listing_photo_summary_rows();
CREATE TRIGGER trg_listing_photo_summary_update AFTER UPDATE OF vehicle_id, source_url ON public.auction_events FOR EACH ROW WHEN (((old.vehicle_id IS DISTINCT FROM new.vehicle_id) OR (old.source_url IS DISTINCT FROM new.source_url))) EXECUTE FUNCTION enqueue_listing_photo_summary_move();
CREATE TRIGGER trg_project_bat_result_to_vehicle AFTER INSERT OR UPDATE OF outcome, winning_bid, high_bid ON public.auction_events FOR EACH ROW WHEN (((new.source = 'bat'::text) AND (new.outcome = ANY (ARRAY['sold'::text, 'reserve_not_met'::text])))) EXECUTE FUNCTION trg_project_bat_result_to_vehicle();
SELECT public.assert_count(count(*)::int, 13, 'live triggers installed') FROM pg_trigger
 WHERE tgrelid = 'public.auction_events'::regclass AND NOT tgisinternal;

DO $$ BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'close_deal_on_sale') NOT LIKE '%NEW.sale_price%' THEN
    RAISE EXCEPTION 'FAIL: deployed close_deal_on_sale body not loaded';
  END IF;
  BEGIN
    INSERT INTO public.auction_events (source, vehicle_id, outcome, high_bid) VALUES ('bat', gen_random_uuid(), 'sold', 1);
    RAISE EXCEPTION 'FAIL: the deployed body accepted a sold row';
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
END $$;

\i supabase/migrations/20261125084210_close_deal_on_sale_columns.sql
\i supabase/migrations/20261125084210_close_deal_on_sale_columns.sql

CREATE FUNCTION public.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;

-- Every NEW.<column> both trigger bodies read is a column of the live-shaped table.
SELECT public.assert(NOT EXISTS (
  SELECT 1 FROM pg_proc p, regexp_matches(p.prosrc, '\mNEW\.([A-Za-z_][A-Za-z0-9_]*)', 'g') m
   WHERE p.oid IN (SELECT tgfoid FROM pg_trigger WHERE tgrelid = 'public.auction_events'::regclass AND NOT tgisinternal)
     -- preserve_bat_live_projection names NEW.metadata only in its vehicle_events branch
     AND NOT (p.proname = 'preserve_bat_live_projection' AND lower(m[1]) = 'metadata')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public'
                        AND c.table_name = 'auction_events' AND c.column_name = lower(m[1]))),
  'a trigger function on auction_events reads a column the table lacks');
SELECT public.assert(config_value->>'enabled' = 'false', 'transfer notifications off by default')
  FROM public.platform_config WHERE config_key = 'transfer_notifications';

-- Deals.
INSERT INTO public.deal_jackets (id, vehicle_id, deal_type, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'consignment', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'consignment', now()),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a3', 'consignment', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a4', 'consignment', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000a5', 'consignment', '2026-01-01');
INSERT INTO public.deal_jacket_parties (deal_jacket_id, role, threshold_amount, split_pct) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'owner', 100, NULL),
  ('00000000-0000-0000-0000-0000000000d1', 'shop', NULL, 50);
-- Unsold: nothing.
INSERT INTO public.auction_events (source, vehicle_id, outcome, high_bid, auction_end_date)
VALUES ('bat', '00000000-0000-0000-0000-0000000000a1', 'reserve_not_met', 90, now() - interval '2 days');
SELECT public.assert(sold_date IS NULL, 'unsold row left the deal open') FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d1';
-- Sold with a gross price and an end date: closed at both.
INSERT INTO public.auction_events (source, vehicle_id, outcome, high_bid, hammer_price, gross_price, auction_end_date)
VALUES ('bat', '00000000-0000-0000-0000-0000000000a1', 'sold', 140, 150, 160, '2026-11-24 18:00Z');
SELECT public.assert(sale_price_inc_doc = 160 AND sold_date = DATE '2026-11-24', 'closed at gross and end date: ' || row_to_json(d)::text)
  FROM public.deal_jackets d WHERE id = '00000000-0000-0000-0000-0000000000d1';
SELECT public.assert((SELECT actual_amount FROM public.deal_jacket_parties WHERE role = 'owner') = 100
                     AND (SELECT actual_amount FROM public.deal_jacket_parties WHERE role = 'shop') = 30, 'party amounts');
-- An older sale does not close a newer deal.
INSERT INTO public.auction_events (source, vehicle_id, outcome, gross_price, auction_end_date)
VALUES ('bat', '00000000-0000-0000-0000-0000000000a2', 'sold', 500, now() - interval '10 days');
SELECT public.assert(sold_date IS NULL, 'older sale left the newer deal open') FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d2';
-- No end date: not closed, never dated today; a reason row.
INSERT INTO public.auction_events (source, vehicle_id, outcome, gross_price)
VALUES ('bat', '00000000-0000-0000-0000-0000000000a3', 'sold', 500);
SELECT public.assert(sold_date IS NULL AND sale_price_inc_doc IS NULL, 'no end date: deal open') FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d3';
SELECT public.assert(EXISTS (SELECT 1 FROM public.deal_close_skips WHERE deal_jacket_id = '00000000-0000-0000-0000-0000000000d3' AND reason = 'end_date_unknown'), 'end_date_unknown row');
-- A house with no price rule and only a final bid: price unknown, not the high bid.
INSERT INTO public.auction_events (source, vehicle_id, outcome, high_bid, winning_bid, auction_end_date)
VALUES ('somehouse', '00000000-0000-0000-0000-0000000000a4', 'sold', 700, 700, now() - interval '2 days');
SELECT public.assert(sold_date IS NULL AND sale_price_inc_doc IS NULL, 'high bid is not a price without a rule') FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d4';
SELECT public.assert(EXISTS (SELECT 1 FROM public.deal_close_skips WHERE deal_jacket_id = '00000000-0000-0000-0000-0000000000d4' AND reason = 'price_unknown'), 'price_unknown row');
-- BaT's rule row: the final bid is the hammer.
INSERT INTO public.auction_events (source, vehicle_id, outcome, high_bid, winning_bid, auction_end_date)
VALUES ('bat', '00000000-0000-0000-0000-0000000000a5', 'sold', 800, 810, '2026-11-20 18:00Z');
SELECT public.assert(sale_price_inc_doc = 810 AND sold_date = DATE '2026-11-20', 'bat final bid by rule: ' || row_to_json(d)::text)
  FROM public.deal_jackets d WHERE id = '00000000-0000-0000-0000-0000000000d5';
SELECT public.assert(closed_by_auction_event_id IS NOT NULL AND closed_price_basis = 'final_bid', 'closure keyed to its event')
  FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d5';

-- The freeze (skeptic2, 11-25): a sold row with only a final bid and no end date skips; the same event's later write
-- with a gross price and the end date closes the deal at those, not at the first values or today.
INSERT INTO public.deal_jackets (id, vehicle_id, deal_type, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000a6', 'consignment', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000a7', 'consignment', '2026-01-01');
INSERT INTO public.auction_events (id, source, vehicle_id, outcome, high_bid)
VALUES ('00000000-0000-0000-0000-0000000000e6', 'bat', '00000000-0000-0000-0000-0000000000a6', 'sold', 140);
SELECT public.assert(sold_date IS NULL, 'no end date: open') FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d6';
UPDATE public.auction_events SET gross_price = 160, auction_end_date = '2026-11-22 18:00Z' WHERE id = '00000000-0000-0000-0000-0000000000e6';
SELECT public.assert(sale_price_inc_doc = 160 AND sold_date = DATE '2026-11-22' AND closed_price_basis = 'gross'
                     AND closed_by_auction_event_id = '00000000-0000-0000-0000-0000000000e6', 'closed by the later write: ' || row_to_json(d)::text)
  FROM public.deal_jackets d WHERE id = '00000000-0000-0000-0000-0000000000d6';
-- The closing event corrects its own closure with an equal or better class, never a worse one; another event never.
INSERT INTO public.auction_events (id, source, vehicle_id, outcome, high_bid, auction_end_date)
VALUES ('00000000-0000-0000-0000-0000000000e7', 'bat', '00000000-0000-0000-0000-0000000000a7', 'sold', 800, '2026-11-20 18:00Z');
SELECT public.assert(sale_price_inc_doc = 800 AND closed_price_basis = 'final_bid', 'closed at final bid') FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d7';
UPDATE public.auction_events SET gross_price = 840 WHERE id = '00000000-0000-0000-0000-0000000000e7';
SELECT public.assert(sale_price_inc_doc = 840 AND closed_price_basis = 'gross', 'corrected to gross') FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d7';
UPDATE public.auction_events SET gross_price = NULL, hammer_price = 830 WHERE id = '00000000-0000-0000-0000-0000000000e7';
SELECT public.assert(sale_price_inc_doc = 840 AND closed_price_basis = 'gross', 'a worse class does not overwrite') FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d7';
INSERT INTO public.auction_events (source, vehicle_id, outcome, gross_price, auction_end_date)
VALUES ('bat', '00000000-0000-0000-0000-0000000000a7', 'sold', 999, '2026-11-23 18:00Z');
SELECT public.assert(sale_price_inc_doc = 840 AND closed_by_auction_event_id = '00000000-0000-0000-0000-0000000000e7', 'another event cannot change it')
  FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d7';

-- The triggers after close_deal_on_sale ran on sold rows (they had not completed on one in production since 11-13).
SELECT public.assert(EXISTS (SELECT 1 FROM public.trigger_calls WHERE fn = 'project_bat_result_to_vehicle' AND arg = '00000000-0000-0000-0000-0000000000e7'), 'project_bat_result_to_vehicle ran');
SELECT public.assert(EXISTS (SELECT 1 FROM public.trigger_calls WHERE fn = 'model_fold_signal_ids' AND arg = 'auction_events_insert'), 'model fold signal ran');
SELECT public.assert(EXISTS (SELECT 1 FROM public.vehicle_listing_photo_summary_queue WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a7'), 'photo summary queued');
INSERT INTO public.auction_events (id, source, vehicle_id, outcome, gross_price, auction_end_date, winning_bidder, source_url)
VALUES ('00000000-0000-0000-0000-0000000000e8', 'bat', '00000000-0000-0000-0000-0000000000a8', 'sold', 50, now() - interval '2 days', 'bidder_x', 'https://example.test/listing/x/');
SELECT public.assert(EXISTS (SELECT 1 FROM public.trigger_calls WHERE fn = 'resolve_auction_event_identities' AND arg = '00000000-0000-0000-0000-0000000000e8'), 'identities resolved');
SELECT public.assert(canonical_listing_url = 'https://example.test/listing/x', 'canonical url set') FROM public.auction_events WHERE id = '00000000-0000-0000-0000-0000000000e8';
INSERT INTO public.external_auction_bids (auction_event_id, vehicle_id) VALUES ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000a8');
UPDATE public.auction_events SET vehicle_id = '00000000-0000-0000-0000-0000000000a9' WHERE id = '00000000-0000-0000-0000-0000000000e8';
SELECT public.assert(vehicle_id = '00000000-0000-0000-0000-0000000000a9', 'bids follow the lot') FROM public.external_auction_bids WHERE auction_event_id = '00000000-0000-0000-0000-0000000000e8';
SELECT public.assert(EXISTS (SELECT 1 FROM public.vehicle_listing_photo_summary_queue WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a9'), 'photo summary move queued');

-- Transfers: every request so far was suppressed (config off).
SELECT public.assert(count(*) > 0 AND bool_and((body->>'suppress_notifications')::boolean), 'all suppressed while off: ' || coalesce(string_agg(body::text, ' | '), 'none'))
  FROM net.sent WHERE body->>'action' = 'seed_from_auction';
-- Turned on: a fresh result may notify; a backfilled one may not; a NULL end date seeds nothing at all.
UPDATE public.platform_config SET config_value = '{"enabled": true}' WHERE config_key = 'transfer_notifications';
TRUNCATE net.sent;
INSERT INTO public.auction_events (source, vehicle_id, outcome, gross_price, auction_end_date) VALUES ('bat', gen_random_uuid(), 'sold', 10, now() - interval '5 minutes');
SELECT public.assert((body->>'suppress_notifications')::boolean = false, 'fresh result notifies when on') FROM net.sent;
TRUNCATE net.sent;
INSERT INTO public.auction_events (source, vehicle_id, outcome, gross_price, auction_end_date) VALUES ('bat', gen_random_uuid(), 'sold', 10, now() - interval '3 days');
SELECT public.assert((body->>'suppress_notifications')::boolean = true, 'backfill suppressed even when on') FROM net.sent;
TRUNCATE net.sent;
INSERT INTO public.auction_events (source, vehicle_id, outcome, gross_price) VALUES ('bat', gen_random_uuid(), 'sold', 10);
SELECT public.assert(NOT EXISTS (SELECT 1 FROM net.sent WHERE coalesce((body->>'suppress_notifications')::boolean, false) = false),
                     'no unsuppressed request for a NULL end date');
-- A config row that is missing reads as off.
DELETE FROM public.platform_config WHERE config_key = 'transfer_notifications';
TRUNCATE net.sent;
INSERT INTO public.auction_events (source, vehicle_id, outcome, gross_price, auction_end_date) VALUES ('bat', gen_random_uuid(), 'sold', 10, now() - interval '5 minutes');
SELECT public.assert((body->>'suppress_notifications')::boolean = true, 'missing config row reads off') FROM net.sent;

SELECT public.assert(NOT has_function_privilege('anon', 'public.close_deal_on_sale()', 'EXECUTE'), 'anon cannot execute');
SELECT public.assert(NOT has_table_privilege('anon', 'public.deal_close_skips', 'SELECT'), 'anon cannot read skips');
\echo 'test_close_deal_on_sale_columns: PASS'
