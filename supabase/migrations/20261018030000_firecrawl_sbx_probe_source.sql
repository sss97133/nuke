-- 'sbx' (2026-10-15, owner-lead): probe, does SBX still run public auctions. sbxcars.com is a JS shell with no robots.txt or sitemap, its
-- title reads 'SBX Cars Private Sales', and nothing has landed in 14+ days. One rendered index read through the allowance decides retire
-- versus rank. Like ksl-search it has no lots to rank and carries fixed_credits = 2 per billing period, funded off the top as the cost of a measurement.
INSERT INTO public.firecrawl_source_params
  (source, firecrawl_dependent, credits_per_lot, cost_basis, supply_kind, vehicles_source, event_platforms, observed_on, snapshot_platforms, hosts, fixed_credits)
VALUES ('sbx', true, 1, 'probe: does SBX still run public auctions; one rendered index read; 0 lots by design', 'live',
        '{}', '{}', '2026-10-15', '{}', '{sbxcars.com}', 2)
ON CONFLICT (source) DO NOTHING;
