-- event_currency_rules can match on the sale code in source_url, for events with no venue text.
-- Each rule is cited to a lot page of that sale showing the sold or estimate currency (fetched 2026-10-24).
alter table public.event_currency_rules add column if not exists match_on text not null default 'venue'
  check (match_on in ('venue', 'source_url'));
alter table public.event_currency_rules drop constraint if exists event_currency_rules_source_platform_venue_pattern_key;
alter table public.event_currency_rules add constraint event_currency_rules_platform_match_pattern_key unique (source_platform, match_on, venue_pattern);

insert into public.event_currency_rules (source_platform, match_on, venue_pattern, currency_code, scope_note, source_url, source_quote, cited_on) values
 ('rm-sothebys','source_url','rmsothebys\.com/auctions/(mo|az|mi|cc)[0-9]{2}/','USD','RM US sales by code: mo Monterey, az Arizona, mi Miami, cc Cavallino Palm Beach',
  'https://rmsothebys.com/auctions/mo26/bidder-info/','Cars: 12% on a hammer price up to $250,000; lot pages name Monterey/Arizona/Miami/Cavallino Palm Beach','2026-10-24'),
 ('broad_arrow','source_url','broadarrowauctions\.com/vehicles/(am2[3-6]|jc2[2-5]|lv25|cm26|po2[3-5]|sf25|tj22|pb22)_','USD','Broad Arrow sales whose lot pages show Sold Price in USD',
  'https://www.broadarrowauctions.com/vehicles/sf25_r001/1957-ac-aceca','Sold Price: $95,200 USD (one lot per sale code checked: am23 $643,000 USD, jc22 $3,910,000 USD, po25 $1,006,000 USD, tj22 $549,500 USD, pb22 Estimate $100,000 - $120,000 USD)','2026-10-24'),
 ('broad_arrow','source_url','broadarrowauctions\.com/vehicles/gi26e_','EUR','Broad Arrow European sale gi26e',
  'https://www.broadarrowauctions.com/vehicles/gi26e_r0007/1965-ferrari-275-gts','Sold Price: €1.386.000 EUR','2026-10-24')
on conflict do nothing;
