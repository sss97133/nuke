# houselot v11 (attach routed events) + house routing v12 (cited conceptcarz auction pages)

## v11 — run agg_houselot_v11_20261024
The 425 events routed by v10 matched against their new house's lots (`cand11.sql`), v7 gates + engine rule v2 (`gate11.sql`).
16 attached same_lot to existing vehicles (guard 16/16), 3 sale-price marks. Engine words in NNN/HP form checked on the Mecum lot page
(Hudson 254, Ford Courier 312, Edsel 361 — all match). Held: 110 no lot at new house, 158 >1 lot, 10 non-body word missing,
3 lot claimed twice, 12 no cited lot number, 7 house not sold/no price, 109 price >20% apart.
Revert: `revert_v11_tx.sql` (backup `backup_agg_houselot_v11_20261024`); rolled-back test → 0 left, 0 live marks.

## v12 — run agg_houseroute_v12_20261024
`fetch.sh` read conceptcarz's public results page per auction id (`/events/auctionResults/auctionResults.aspx?eventID=N&reportID=1`, 3 s apart; 318 pages)
→ `agg_houseroute_v12_20261024_ccpage` (page title = house + sale, "Event Date" month).
Check: all 425 v10 routes agree with the page house and month. Routed the held events whose page names Leake (77), Kruse (70) or Carlisle (42) with
the event month inside the sale window: 189. Revert: `revert_route_v12.sql` (backup `backup_agg_houseroute_v12_20261024`); test 189 → 0.
No Leake/Kruse/Carlisle lot data exists in vehicle_events (0 real house URLs), so these cannot be attached yet.
