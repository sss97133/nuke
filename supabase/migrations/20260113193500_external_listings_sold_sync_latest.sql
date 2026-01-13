-- ============================================================================
-- EXTERNAL LISTINGS SOLD SYNC: MULTI-AUCTION SAFE "LATEST WINS"
-- ============================================================================
-- Problem:
-- - A vehicle can have multiple sold auction events (relist / resale).
-- - The existing trigger only writes vehicles.* when sale_status != 'sold',
--   which freezes caches on the first sale and causes mixed/incorrect UI state.
--
-- Fix:
-- - Update vehicles.* caches when a SOLD listing is newer than the cached sale_date.
-- - For BaT, also keep vehicles.bat_* cache fields in sync with the latest SOLD listing.
-- - Backfill existing vehicles from the latest SOLD external_listings row.
--
-- Date: 2026-01-13
-- ============================================================================

begin;

create or replace function public.auto_mark_vehicle_sold_from_external_listing()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  affected_rows integer;
  sale_amount numeric;
  new_sale_date date;
begin
  -- Only process when listing_status is sold
  if new.listing_status = 'sold' and new.vehicle_id is not null then
    affected_rows := 0;
    sale_amount := coalesce(new.final_price, new.current_bid);
    new_sale_date := coalesce(new.sold_at::date, new.end_date::date, current_date);

    -- Update organization_vehicles for this vehicle and organization (best-effort)
    if new.organization_id is not null and to_regclass('public.organization_vehicles') is not null then
      insert into organization_vehicles (
        organization_id,
        vehicle_id,
        relationship_type,
        listing_status,
        sale_date,
        sale_price,
        status,
        updated_at
      )
      values (
        new.organization_id,
        new.vehicle_id,
        'sold_by',
        'sold',
        new_sale_date,
        sale_amount,
        'past',
        now()
      )
      on conflict (organization_id, vehicle_id, relationship_type)
      do update set
        listing_status = 'sold',
        -- Only advance the sale_date (guarded by the WHERE clause below)
        sale_date = coalesce(excluded.sale_date, organization_vehicles.sale_date),
        sale_price = coalesce(sale_amount, organization_vehicles.sale_price),
        status = 'past',
        updated_at = now()
      where organization_vehicles.sale_date is null or excluded.sale_date >= organization_vehicles.sale_date;
    end if;

    -- Update vehicles table sale fields + auction bid semantics
    update vehicles
    set
      sale_price = coalesce(sale_amount, vehicles.sale_price),
      sale_date = coalesce(new_sale_date, vehicles.sale_date),
      sale_status = 'sold',
      auction_outcome = 'sold',
      winning_bid = coalesce(sale_amount, vehicles.winning_bid),
      high_bid = coalesce(sale_amount, vehicles.high_bid),
      bid_count = coalesce(new.bid_count, vehicles.bid_count),
      auction_source = coalesce(new.platform, vehicles.auction_source),
      -- Keep legacy string cache aligned for older UI paths
      auction_end_date = coalesce(new.end_date::date::text, vehicles.auction_end_date),
      -- BaT cache fields (latest SOLD listing)
      bat_auction_url = case when new.platform = 'bat' then coalesce(new.listing_url, vehicles.bat_auction_url) else vehicles.bat_auction_url end,
      bat_lot_number = case when new.platform = 'bat' then coalesce(new.metadata->>'lot_number', vehicles.bat_lot_number) else vehicles.bat_lot_number end,
      bat_seller = case when new.platform = 'bat' then coalesce(new.metadata->>'seller_username', vehicles.bat_seller) else vehicles.bat_seller end,
      bat_buyer = case when new.platform = 'bat' then coalesce(new.metadata->>'buyer_username', vehicles.bat_buyer) else vehicles.bat_buyer end,
      reserve_status = case when new.platform = 'bat' then coalesce(new.metadata->>'reserve_status', vehicles.reserve_status) else vehicles.reserve_status end,
      bat_bids = case when new.platform = 'bat' then coalesce(new.bid_count, vehicles.bat_bids) else vehicles.bat_bids end,
      bat_views = case when new.platform = 'bat' then coalesce(new.view_count, vehicles.bat_views) else vehicles.bat_views end,
      bat_watchers = case when new.platform = 'bat' then coalesce(new.watcher_count, vehicles.bat_watchers) else vehicles.bat_watchers end,
      updated_at = now()
    where
      id = new.vehicle_id
      and (vehicles.sale_date is null or new_sale_date >= vehicles.sale_date);

    get diagnostics affected_rows = row_count;
    if affected_rows > 0 then
      raise notice 'Updated vehicle % sold cache from external listing % (platform=%)', new.vehicle_id, new.id, new.platform;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.auto_mark_vehicle_sold_from_external_listing is
  'Marks vehicles as sold when external_listings are sold; multi-auction safe (latest sale_date wins). Updates BaT cache fields when platform=bat.';

-- Ensure trigger exists (safe recreate)
drop trigger if exists trigger_auto_mark_vehicle_sold on public.external_listings;
create trigger trigger_auto_mark_vehicle_sold
  after insert or update of listing_status, final_price, sold_at, end_date
  on public.external_listings
  for each row
  when (new.listing_status = 'sold')
  execute function public.auto_mark_vehicle_sold_from_external_listing();

-- Backfill: sync vehicles from latest SOLD external_listings
with latest_sold as (
  select distinct on (vehicle_id)
    vehicle_id,
    platform,
    listing_url,
    bid_count,
    view_count,
    watcher_count,
    final_price,
    current_bid,
    end_date,
    sold_at,
    metadata
  from public.external_listings
  where listing_status = 'sold'
    and vehicle_id is not null
  order by
    vehicle_id,
    coalesce(sold_at, end_date) desc nulls last,
    coalesce(updated_at, created_at) desc
)
update public.vehicles v
set
  sale_price = coalesce(coalesce(ls.final_price, ls.current_bid)::integer, v.sale_price),
  sale_date = coalesce(coalesce(ls.sold_at::date, ls.end_date::date), v.sale_date),
  sale_status = 'sold',
  auction_outcome = 'sold',
  winning_bid = coalesce(coalesce(ls.final_price, ls.current_bid)::integer, v.winning_bid),
  high_bid = coalesce(coalesce(ls.final_price, ls.current_bid)::integer, v.high_bid),
  bid_count = coalesce(ls.bid_count, v.bid_count),
  auction_source = coalesce(ls.platform, v.auction_source),
  auction_end_date = coalesce(ls.end_date::date::text, v.auction_end_date),
  bat_auction_url = case when ls.platform = 'bat' then coalesce(ls.listing_url, v.bat_auction_url) else v.bat_auction_url end,
  bat_lot_number = case when ls.platform = 'bat' then coalesce(ls.metadata->>'lot_number', v.bat_lot_number) else v.bat_lot_number end,
  bat_seller = case when ls.platform = 'bat' then coalesce(ls.metadata->>'seller_username', v.bat_seller) else v.bat_seller end,
  bat_buyer = case when ls.platform = 'bat' then coalesce(ls.metadata->>'buyer_username', v.bat_buyer) else v.bat_buyer end,
  reserve_status = case when ls.platform = 'bat' then coalesce(ls.metadata->>'reserve_status', v.reserve_status) else v.reserve_status end,
  bat_bids = case when ls.platform = 'bat' then coalesce(ls.bid_count, v.bat_bids) else v.bat_bids end,
  bat_views = case when ls.platform = 'bat' then coalesce(ls.view_count, v.bat_views) else v.bat_views end,
  bat_watchers = case when ls.platform = 'bat' then coalesce(ls.watcher_count, v.bat_watchers) else v.bat_watchers end,
  updated_at = now()
from latest_sold ls
where v.id = ls.vehicle_id
  and (v.sale_date is null or coalesce(ls.sold_at::date, ls.end_date::date) >= v.sale_date);

-- Backfill: keep auction_events aligned with external_listings for BaT (best-effort)
update public.auction_events ae
set
  winning_bid = coalesce(el.final_price, ae.winning_bid),
  high_bid = coalesce(el.final_price, ae.high_bid),
  total_bids = coalesce(el.bid_count, ae.total_bids),
  page_views = coalesce(el.view_count, ae.page_views),
  watchers = coalesce(el.watcher_count, ae.watchers),
  comments_count = coalesce((el.metadata->>'comment_count')::int, ae.comments_count),
  updated_at = now()
from public.external_listings el
where ae.source = 'bat'
  and el.platform = 'bat'
  and el.listing_url = ae.source_url
  and el.listing_status = 'sold'
  and el.final_price is not null;

commit;

