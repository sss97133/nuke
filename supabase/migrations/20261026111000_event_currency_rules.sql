-- First-class house + venue -> currency rules, each cited to the house's own fee schedule / conditions of sale.
-- Used to fill vehicle_events.currency_code where it is null. A rule matches on source_platform and a venue regex
-- (case-insensitive) over the event's sale name/location; events no rule matches stay unset.
create table if not exists public.event_currency_rules (
  id bigint generated always as identity primary key,
  source_platform text not null,
  venue_pattern text not null,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  scope_note text not null,
  source_url text not null,
  source_quote text not null,
  cited_on date not null,
  created_at timestamptz not null default now(),
  unique (source_platform, venue_pattern)
);
alter table public.event_currency_rules enable row level security;
comment on table public.event_currency_rules is 'Cited house+venue currency rules for vehicle_events.currency_code fills; ambiguous venues have no rule.';

create or replace function public.event_venue_text(p_metadata jsonb)
returns text language sql immutable as $$
  select coalesce(p_metadata->>'sale_location', p_metadata->>'location', p_metadata->>'auction_location',
                  p_metadata->>'sale_venue', p_metadata->>'venue', p_metadata->>'auction_name')
$$;

insert into public.event_currency_rules (source_platform, venue_pattern, currency_code, scope_note, source_url, source_quote, cited_on) values
 ('gooding', '^(pebble beach|amelia island|scottsdale|palm beach)', 'USD', 'Gooding US live auctions (Pebble Beach, Amelia Island, Scottsdale, Palm Beach)',
  'https://bid.goodingco.com/conditions-of-sale', 'Live Auctions in the U.S.: 12% of the final bid price up to $250,000 ... 10% on the remainder', '2026-10-24'),
 ('mecum', '^(indy|kissimmee|houston|las vegas|kansas city|gone farmin)', 'USD', 'Mecum US venues',
  'https://www.mecum.com/faq/', 'Collector Cars/Motorcycles: In Person 10%, Telephone 12%, Internet 12%. Minimum Buyer Premium: Vehicles $1,000', '2026-10-24'),
 ('rm-sothebys', '^(monterey|arizona|miami|cavallino palm beach|the monterey auction)', 'USD', 'RM Sotheby''s US sales',
  'https://rmsothebys.com/auctions/mo26/bidder-info/', 'Cars: 12% on a hammer price up to $250,000 10% on any balance over $250,000', '2026-10-24'),
 ('broad_arrow', '^(the amelia auction|monterey jet center|west palm beach|the chattanooga auction|the audrain auction|the las vegas auction)', 'USD', 'Broad Arrow US venue sales',
  'https://fliphtml5.com/kfgkh/daup/Broad_Arrow_Auctions_-_Monterey_Jet_Center_2023_-_Friday_', 'standard Buyer''s Premium is: (i) if the Lot is a motor car, then the sum of twelve percent (12%) of the first $250,000', '2026-10-24'),
 ('pcarmarket', '.*', 'USD', 'PCARMARKET online platform; all bids and fees in US dollars regardless of seller location',
  'https://www.pcarmarket.com/buyer-agreement', '5% of the winning bid, $500 minimum, $7,500 maximum', '2026-10-24')
on conflict do nothing;
