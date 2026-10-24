-- Unset fills made from these rules first (sql revert of the evcur run), then:
delete from public.event_currency_rules where match_on = 'source_url';
alter table public.event_currency_rules drop constraint if exists event_currency_rules_platform_match_pattern_key;
alter table public.event_currency_rules add constraint event_currency_rules_source_platform_venue_pattern_key unique (source_platform, venue_pattern);
alter table public.event_currency_rules drop column if exists match_on;
