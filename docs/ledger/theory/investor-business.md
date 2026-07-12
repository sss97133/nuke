# INVESTOR / BUSINESS — theory card

**The model:** This subsystem is market intelligence PROJECTED from live auction evidence, not a finance product. Every number is an aggregation computed server-side (SQL RPC or materialized view) over real auction/listing rows and rendered on demand — "label as projection of measurement": store evidence, project stats at read time, never bake categoricals or prices into schema. The investor-facing product (fractional shares, contracts, dashboards) was RETIRED; what survives is trends, treemaps, and org due-diligence.

**The invariant(s):**
- Never show a price/valuation you can't defend to evidence — block ("not priced yet"), never guess. Every value carries `(amount, source, method, observed_at, trust)`.
- No fabricated data in any surface, ever. `custom_investment_contracts` is a FABRICATED $150M demo — it is not substrate and must never be resurrected or cited.
- Aggregate in SQL, not in edge functions or the client (the canonical fns are thin wrappers over one RPC — see `auction-trends-stats/index.ts`: it only calls `get_auction_trends_v2(p_lookback_days)`).
- Investor portal is on the platform-hygiene DO-NOT-REBUILD list (`.claude/rules/platform-hygiene.md`).

**Canonical entrypoints:**
- Public market-trends API → `api-v1-market-trends` edge fn + `get_market_trends` RPC
- /trends dashboard stats → `auction-trends-stats` edge fn + `get_auction_trends_v2` RPC (all aggregation in the RPC)
- Treemap data (HomePage/BrowseVehicles/MarketMap) → `treemap_*` SQL routines (×11), THE treemap API, called via rpc
- Treemap backing data → `mv_treemap_*` materialized views (×9) — POPULATED but FROZEN (refresh cron inactive); reactivate, don't rebuild
- Treemap refresh → `treemap_refresh_all` routine — the ONE refresh path (dormant cron)
- Org due diligence → `generate-org-due-diligence` edge fn (⚠ CONTESTED deploy status — verify deployed before use)
- Admin BI surface → `BusinessIntelligence.tsx` (routed + nav-linked)
- Fractional offerings schema, IF ever revived → extend the `vehicle_offerings` + `share_holdings` + `market_orders` FK family (a product decision, not yours)

**Do NOT:** rebuild the investor portal (InvestorDashboard/InvestorOffering deleted); reference `investor_offerings` (NEVER existed — old map fiction); resurrect `custom_investment_contracts`/`contract_assets` (fabricated demo); revive `investor-portal-stats`, `treemap-data`, `source-census`, `daily-report`, or the census layer (`source_census`, `mv_vehicle_census`, `get_latest_census`, `record_census`) — all DEAD; write rows into `acquisition_pipeline` (0 rows ever — needs a product decision first); mint a parallel treemap/trends path when the mv_* views merely need their refresh cron reactivated.

**Before you build here:** read `docs/ledger/CAPABILITY_MAP.md` (INVESTOR / BUSINESS section) and check `docs/ledger/ledger.json` verdicts before minting ANY function/table/page; grep existing `treemap_*` routines and `get_*_trends*` RPCs first; if a number will be shown to a user, confirm it traces to auction evidence with source DNA or block the display.
