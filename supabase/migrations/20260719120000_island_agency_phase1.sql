-- ISLAND AGENCY PHASE 1 (2026-07-19)
-- Justification: lofficiel-concierge/docs/ISLAND_AGENCY.md + docs/FB_MARKETPLACE_PLACEMENT.md
-- (owner-approved Phase 1: sell ad placement on cited data; zero new Meta permissions).
-- Additive only. New tables are agency/ops ledgers (service-role only), NOT testimony tables.
-- Every measured/reported number carries (source, method, observed_at, trust).

-- 1. Targeting profiles: a target profile per (org x brand x product-set).
--    hard_controls BIND under Advantage+ (geo/language/age_min/exclusions); suggestions do not.
create table if not exists placement_target_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id),
  brand_name text,
  product_set_selector jsonb not null default '{}'::jsonb,
  hard_controls jsonb not null default '{}'::jsonb,
  suggestions jsonb not null default '{}'::jsonb,
  never_pair_rules jsonb not null default '[]'::jsonb,
  binding_mode text not null default 'advantage' check (binding_mode in ('advantage','original')),
  status text not null default 'draft' check (status in ('draft','armed','retired')),
  seeded_from jsonb not null default '{}'::jsonb,
  source text not null default 'agent',
  method text not null default 'profile_design',
  observed_at timestamptz not null default now(),
  trust text not null default 'internal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Placement orders: one row per flight (boutique x profile x budget window).
create table if not exists placement_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id),
  profile_id uuid references placement_target_profiles(id),
  connection_id uuid references concierge_partner_connections(id),
  agency_model text check (agency_model in ('publisher_identity','partner_access','media_kit')),
  identity_org_id uuid references organizations(id),
  partnership jsonb not null default '{}'::jsonb,
  objective text,
  budget_amount numeric,
  currency text not null default 'USD',
  starts_at date,
  ends_at date,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_ids jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','armed','live','paused','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Daily placement metrics: billing evidence + the Marketplace/IG-position benchmark
--    nobody publishes. method distinguishes 'ads_manager_export' (manual CSV era) from
--    'insights_api' (automation era) forever.
create table if not exists placement_metrics_daily (
  order_id uuid not null references placement_orders(id),
  date date not null,
  publisher_platform text not null,
  platform_position text not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  spend numeric not null default 0,
  reach bigint,
  actions jsonb not null default '{}'::jsonb,
  source text not null default 'ads_insights',
  method text not null,
  observed_at timestamptz not null default now(),
  trust text not null default 'measured',
  primary key (order_id, date, publisher_platform, platform_position)
);

-- 4. Partnership-ads permission + compliance ledger. Gate B refuses to arm a partnership
--    flight without an approved row here (French loi 2023-451 as amended + DSA).
create table if not exists partnership_ad_permissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id),
  brand_name text,
  ig_user_id text,
  handle text,
  permission_kind text not null check (permission_kind in ('post_tag_approval','ad_code','account_allowlist')),
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  granted_at timestamptz,
  expires_at timestamptz,
  ad_code text,
  contract_ref text,
  disclosure_in_creative boolean not null default false,
  dsa_payer text,
  dsa_beneficiary text,
  evidence jsonb not null default '{}'::jsonb,
  source text not null default 'agent',
  method text not null default 'manual_ledger',
  observed_at timestamptz not null default now(),
  trust text not null default 'internal',
  created_at timestamptz not null default now()
);

-- 5. Advertiser deal ledger: real deal history with provenance. Pricing tiers derive from
--    these rows, never from guesses. Founding rows are owner testimony (approximate figures).
create table if not exists advertiser_deals (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  org_id uuid references organizations(id),
  deal_kind text not null check (deal_kind in ('advertising_annual','activation','collab','placement_flight','managed_social','other')),
  amount numeric,
  currency text not null default 'USD',
  period text,
  season text,
  details jsonb not null default '{}'::jsonb,
  source text not null,
  method text not null,
  observed_at timestamptz not null default now(),
  trust text not null,
  created_at timestamptz not null default now()
);

insert into advertiser_deals (brand_name, deal_kind, amount, currency, period, season, details, source, method, trust)
values
  ('Louis Vuitton','advertising_annual',30000,'USD','annual',null,
   '{"approximate":true,"asks":"minimal - pure association"}'::jsonb,
   'owner_testimony','session_2026-07-19','reported'),
  ('Dolce & Gabbana','activation',24000,'USD','5 days','high',
   '{"approximate":true,"format":"in-store collab at their boutique"}'::jsonb,
   'owner_testimony','session_2026-07-19','reported');

-- 6. Media-kit facts: every audience number the kit shows, as a cited row. trust='estimate'
--    rows must render labeled as estimates (never-show-an-undefendable-number law).
create table if not exists media_kit_facts (
  key text primary key,
  value_num numeric,
  value_text text,
  unit text,
  as_of date,
  source text not null,
  source_url text,
  method text not null,
  trust text not null,
  notes text
);

insert into media_kit_facts (key, value_num, unit, as_of, source, source_url, method, trust, notes) values
  ('bl_ig_accounts', 6700, 'accounts', '2026-06-01', 'NapoleonCat (Meta ads tools)', 'https://stats.napoleoncat.com/instagram-users-in-saint_barthelemy/2025/', 'ad_reach_estimate', 'measured', 'Low-season measurement; accounts, not people'),
  ('bl_fb_accounts', 14500, 'accounts', '2026-06-01', 'NapoleonCat (Meta ads tools)', 'https://stats.napoleoncat.com/facebook-users-in-saint_barthelemy/2025/', 'ad_reach_estimate', 'measured', 'Exceeds population - proves the recently-in tourist sweep'),
  ('bl_population', 11500, 'people', '2025-10-01', 'DataReportal Digital 2026 Saint Barthelemy', 'https://datareportal.com/reports/digital-2026-saint-barthelemy', 'published_report', 'measured', null),
  ('sxm_ig_accounts', 30800, 'accounts', '2026-06-01', 'NapoleonCat (Meta ads tools)', 'https://stats.napoleoncat.com/instagram-users-in-sint_maarten/2025/', 'ad_reach_estimate', 'measured', 'Arrival-corridor widener; primary staging point for SBH arrivals'),
  ('visitors_2024', 312793, 'visitors', '2024-12-31', 'CTTSB/IEDOM via Journal de Saint-Barth', 'https://www.journaldesaintbarth.com', 'official_tourism_stats', 'measured', 'Record year, +6.8% YoY'),
  ('airport_pax_2024', 203592, 'passengers', '2024-12-31', 'IEDOM via Journal de Saint-Barth', 'https://www.journaldesaintbarth.com', 'official_tourism_stats', 'measured', null),
  ('us_visitor_share_pct', 55.8, 'percent', '2024-12-31', 'CTTSB Observatoire via Journal de Saint-Barth', 'https://www.journaldesaintbarth.com', 'official_tourism_stats', 'measured', 'March peaks 73% American; August 47% French'),
  ('villa_share_pct', 45.3, 'percent', '2024-12-31', 'CTTSB Observatoire via Journal de Saint-Barth', 'https://www.journaldesaintbarth.com', 'official_tourism_stats', 'measured', 'Hotels 32%, friends/family 16%, Airbnb 6.6%'),
  ('season_cumulative_reach_low', 30000, 'accounts', '2026-07-19', 'Derived from visitor rotation math', null, 'derived_estimate', 'estimate', 'Deduplicated Meta accounts over a continuous Nov-Apr flight; pool refreshes ~every 10 days; recency window unpublished; accounts != people; NEVER present as instantaneous'),
  ('season_cumulative_reach_high', 60000, 'accounts', '2026-07-19', 'Derived from visitor rotation math', null, 'derived_estimate', 'estimate', 'Upper bound of the same estimate'),
  ('weekly_saturation_media_usd_low', 300, 'usd', '2026-07-19', 'Derived: ~30K impressions/wk at micro-geo CPM $10', null, 'derived_estimate', 'estimate', 'Island saturation weekly media cost, lower bound'),
  ('weekly_saturation_media_usd_high', 900, 'usd', '2026-07-19', 'Derived: ~30K impressions/wk at micro-geo CPM $30', null, 'derived_estimate', 'estimate', 'Upper bound; BL CPMs unbenchmarked until our own flights measure them');

-- 7. Partner Seller API-shaped registry (sellers must be imported before items when the
--    partner door opens; also the seller-of-record object for ads attribution).
create table if not exists marketplace_partner_sellers (
  partner_seller_id uuid primary key references organizations(id),
  seller_name text not null,
  seller_review_count integer,
  seller_positive_ratings_pct numeric check (seller_positive_ratings_pct between 0 and 1),
  seller_member_since date,
  updated_at timestamptz not null default now()
);

-- 8. Advertiser roster view (brand-level substrate joins; print-footprint numbers come from
--    the mag RPCs at the API layer - the two RPCs disagree on counts, so the route labels
--    its methodology instead of baking one into SQL).
create or replace view v_ig_advertisers
with (security_invoker = on) as
select
  ob.brand_name,
  count(distinct ob.organization_id)                       as stockist_count,
  min(ob.authorization_level)                              as best_authorization,
  jsonb_agg(distinct jsonb_build_object(
    'org_id', o.id,
    'name', o.name,
    'authorization', ob.authorization_level,
    'territory', ob.territory,
    'ig_handle', s.instagram,
    'live_products', coalesce(p.cnt, 0),
    'connected_channels', coalesce(c.channels, '{}'::text[])
  ))                                                       as stockists,
  bool_or(coalesce(array_length(c.channels, 1), 0) > 0)    as any_connected
from organization_brands ob
join organizations o on o.id = ob.organization_id
left join concierge_supply_stbarth s on s.org_id = o.id
left join lateral (
  select count(*) cnt from concierge_products cp
  where cp.org_id = o.id and cp.status = 'live'
) p on true
left join lateral (
  select array_agg(distinct cc.channel) channels
  from concierge_partner_connections cc
  where cc.org_id = o.id and cc.status = 'connected'
) c on true
where ob.territory = 'BL' or (ob.territory is null and o.country = 'BL')
group by ob.brand_name;

-- 9. Feed contract view: the ONLY rows eligible for any Meta catalog feed. Normalizes both
--    media shapes (array of {url,...} and {images:[...]}). Rejected rows = everything else.
create or replace view v_feed_products
with (security_invoker = on) as
select
  cp.id,
  cp.org_id,
  o.name                                   as org_name,
  ob.brand_name,
  ob.authorization_level,
  cp.name                                  as title,
  coalesce(cp.description, cp.name)        as description,
  cp.price,
  cp.currency,
  cp.provenance->>'url'                    as link,
  case jsonb_typeof(cp.media)
    when 'array'  then cp.media->0->>'url'
    when 'object' then cp.media->'images'->>0
  end                                      as image_link,
  cp.structured_data->>'vendor'            as vendor,
  cp.structured_data->>'product_type'      as product_type,
  cp.provenance->>'shopify_product_id'     as item_group_id,
  cp.trust,
  cp.method,
  cp.observed_at
from concierge_products cp
join organizations o on o.id = cp.org_id
left join organization_brands ob on ob.organization_id = cp.org_id
where cp.status = 'live'
  and cp.price is not null
  and cp.provenance->>'url' is not null
  and (
    (jsonb_typeof(cp.media) = 'array'  and jsonb_array_length(cp.media) > 0)
    or (jsonb_typeof(cp.media) = 'object' and jsonb_array_length(cp.media->'images') > 0)
  );

-- 10. Attribution columns on inquiries (placement writes INTO demand tables).
alter table concierge_inquiries add column if not exists attribution jsonb;
alter table concierge_inquiries add column if not exists placement_order_id uuid references placement_orders(id);

-- RLS: agency ledgers are service-role only (no policies = deny anon/authenticated).
alter table placement_target_profiles enable row level security;
alter table placement_orders enable row level security;
alter table placement_metrics_daily enable row level security;
alter table partnership_ad_permissions enable row level security;
alter table advertiser_deals enable row level security;
alter table media_kit_facts enable row level security;
alter table marketplace_partner_sellers enable row level security;
