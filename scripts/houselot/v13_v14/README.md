# House routing v13 + tie-break attach v14 (2026-10-24)

**v13 (agg_houseroute_v13_20261024)**: held v10 events are routed to the house named on their cited conceptcarz results page (`auctionResults.aspx?eventID=N&reportID=1`), when the page's event month falls inside the sale window. The native currency of the sale goes in `metadata.house_route.native_currency`. Prices are unchanged.
- 666 routed from held, plus 19 corrected from carlisle to auctions-america (the "Auctions America - Fall Carlisle" pages), for 685 in total.
- Held:
  - 10 events whose page titles name no house (San Diego, Florida Collector Car Auction, Grand Palais, Spa Classic, Saragga).
  - 9 events on B-J sales missing from staging. They are listed in `agg_houseroute_v13_20261024_bjgap` and were not filled.

**v14 (agg_houselot_v14_20261024)**: the 158 v11 events held for matching more than one lot.
- Ties were broken only by cited evidence: an exact price on the house lot record, or title words found in only one lot's page URL. Each pick then ran through the full v11 gate.
- 3 attached; the other 155 stay held.

Revert with `route_v13_revert.sql` and `revert_v14.sql`. Nothing is deleted, and no vehicles are created or merged.
